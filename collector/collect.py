#!/usr/bin/env python3
"""Collect a privacy-safe Palworld snapshot into SQLite."""

from __future__ import annotations

import base64
import hashlib
import json
import os
import re
import sqlite3
import time
import urllib.request
from pathlib import Path
from typing import Any

CONFIG_PATH = Path(
    os.environ.get("PALWORLD_CONFIG_PATH", "/palworld/PalWorldSettings.ini")
)
DATABASE_PATH = Path(os.environ.get("PALWORLD_DATABASE_PATH", "/data/palworld.db"))
API_URL = os.environ.get(
    "PALWORLD_API_URL", "http://host.docker.internal:8212"
).rstrip("/")
INTERVAL_SECONDS = int(os.environ.get("COLLECTION_INTERVAL_SECONDS", "300"))


def read_admin_password() -> str:
    config = CONFIG_PATH.read_text(encoding="utf-8")
    match = re.search(r'AdminPassword="([^"]+)"', config)
    if not match:
        raise RuntimeError("Palworld admin password is not configured")
    return match.group(1)


def api_get(path: str, authorization: str) -> dict[str, Any]:
    request = urllib.request.Request(
        f"{API_URL}/v1/api/{path}",
        method="GET",
        headers={
            "Authorization": authorization,
            "Accept": "application/json",
            "User-Agent": "Palworld-Dash-Collector/1.0",
        },
    )
    with urllib.request.urlopen(request, timeout=8) as response:
        return json.load(response)


def player_key(player: dict[str, Any]) -> str:
    stable_source = (
        player.get("userId")
        or player.get("playerId")
        or player.get("accountName")
        or player.get("name")
        or "unknown-player"
    )
    return hashlib.sha256(str(stable_source).encode("utf-8")).hexdigest()


def initialize_schema(connection: sqlite3.Connection) -> None:
    connection.executescript(
        """
        CREATE TABLE IF NOT EXISTS metadata (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS server_samples (
          sampled_at INTEGER PRIMARY KEY,
          current_players INTEGER NOT NULL,
          max_players INTEGER NOT NULL,
          server_fps REAL NOT NULL,
          average_fps REAL NOT NULL,
          frame_time REAL NOT NULL,
          world_days INTEGER NOT NULL,
          base_camps INTEGER NOT NULL,
          uptime_seconds INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS players (
          player_key TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          account_name TEXT NOT NULL,
          level INTEGER NOT NULL,
          first_seen INTEGER NOT NULL,
          last_seen INTEGER NOT NULL,
          play_seconds INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS player_samples (
          sampled_at INTEGER NOT NULL,
          player_key TEXT NOT NULL,
          level INTEGER NOT NULL,
          ping INTEGER NOT NULL,
          PRIMARY KEY (sampled_at, player_key),
          FOREIGN KEY (player_key) REFERENCES players(player_key)
        );

        CREATE INDEX IF NOT EXISTS players_level_idx
          ON players(level DESC, play_seconds DESC);
        CREATE INDEX IF NOT EXISTS player_samples_player_idx
          ON player_samples(player_key, sampled_at DESC);
        """
    )


def collect() -> dict[str, Any]:
    password = read_admin_password()
    token = base64.b64encode(f"admin:{password}".encode("utf-8")).decode("ascii")
    authorization = f"Basic {token}"

    metrics = api_get("metrics", authorization)
    player_data = api_get("players", authorization)
    players = player_data.get("players") or []
    sampled_at = int(time.time())

    DATABASE_PATH.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(DATABASE_PATH, timeout=10) as connection:
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute("PRAGMA synchronous=NORMAL")
        connection.execute("PRAGMA foreign_keys=ON")
        connection.execute("PRAGMA busy_timeout=5000")
        initialize_schema(connection)

        previous = connection.execute(
            "SELECT value FROM metadata WHERE key = ?",
            ("last_sample_at",),
        ).fetchone()
        elapsed = sampled_at - int(previous[0]) if previous else 0
        observed_seconds = min(max(elapsed, 0), INTERVAL_SECONDS * 2)

        connection.execute(
            """
            INSERT INTO server_samples (
              sampled_at, current_players, max_players, server_fps,
              average_fps, frame_time, world_days, base_camps, uptime_seconds
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                sampled_at,
                int(metrics.get("currentplayernum") or len(players)),
                int(metrics.get("maxplayernum") or 0),
                float(metrics.get("serverfps") or 0),
                float(metrics.get("serverfpsaverage") or 0),
                float(metrics.get("serverframetime") or 0),
                int(metrics.get("days") or 0),
                int(metrics.get("basecampnum") or 0),
                int(metrics.get("uptime") or 0),
            ),
        )

        for player in players:
            key = player_key(player)
            name = str(player.get("name") or "Jogador").strip()[:100]
            account_name = str(player.get("accountName") or "").strip()[:100]
            level = max(0, int(player.get("level") or 0))
            ping = max(0, round(float(player.get("ping") or 0)))

            connection.execute(
                """
                INSERT INTO players (
                  player_key, name, account_name, level,
                  first_seen, last_seen, play_seconds
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(player_key) DO UPDATE SET
                  name = excluded.name,
                  account_name = excluded.account_name,
                  level = excluded.level,
                  last_seen = excluded.last_seen,
                  play_seconds = players.play_seconds + excluded.play_seconds
                """,
                (
                    key,
                    name,
                    account_name,
                    level,
                    sampled_at,
                    sampled_at,
                    observed_seconds,
                ),
            )
            connection.execute(
                """
                INSERT OR REPLACE INTO player_samples (
                  sampled_at, player_key, level, ping
                ) VALUES (?, ?, ?, ?)
                """,
                (sampled_at, key, level, ping),
            )

        connection.execute(
            """
            INSERT INTO metadata(key, value) VALUES (?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value
            """,
            ("last_sample_at", str(sampled_at)),
        )
        connection.commit()

    return {
        "sampledAt": sampled_at,
        "playersObserved": len(players),
        "secondsCredited": observed_seconds,
    }


if __name__ == "__main__":
    try:
        print(json.dumps({"ok": True, **collect()}, separators=(",", ":")))
    except Exception as error:
        print(
            json.dumps(
                {"ok": False, "error": type(error).__name__},
                separators=(",", ":"),
            )
        )
        raise SystemExit(1)
