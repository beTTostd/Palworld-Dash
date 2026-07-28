#!/usr/bin/env python3
"""Collect privacy-safe Palworld telemetry into SQLite."""
from __future__ import annotations
import base64, hashlib, json, os, re, sqlite3, time, urllib.request
from pathlib import Path
from typing import Any

CONFIG_PATH = Path(os.environ.get("PALWORLD_CONFIG_PATH", "/palworld/PalWorldSettings.ini"))
DATABASE_PATH = Path(os.environ.get("PALWORLD_DATABASE_PATH", "/data/palworld.db"))
API_URL = os.environ.get("PALWORLD_API_URL", "http://host.docker.internal:8212").rstrip("/")
INTERVAL_SECONDS = int(os.environ.get("COLLECTION_INTERVAL_SECONDS", "300"))
RAW_RETENTION_DAYS = int(os.environ.get("RAW_RETENTION_DAYS", "30"))


def read_admin_password() -> str:
    match = re.search(r'AdminPassword="([^"]+)"', CONFIG_PATH.read_text(encoding="utf-8"))
    if not match: raise RuntimeError("Palworld admin password is not configured")
    return match.group(1)

def api_get(path: str, authorization: str) -> dict[str, Any]:
    request = urllib.request.Request(f"{API_URL}/v1/api/{path}", headers={"Authorization": authorization, "Accept": "application/json", "User-Agent": "Palworld-Dash-Collector/1.1"})
    with urllib.request.urlopen(request, timeout=8) as response: return json.load(response)

def player_key(player: dict[str, Any]) -> str:
    source = player.get("userId") or player.get("playerId") or player.get("accountName") or player.get("name") or "unknown-player"
    return hashlib.sha256(str(source).encode("utf-8")).hexdigest()

def meta(connection: sqlite3.Connection, key: str, value: str) -> None:
    connection.execute("INSERT INTO metadata(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (key, value))

def initialize_schema(connection: sqlite3.Connection) -> None:
    connection.executescript("""
    CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS server_samples (sampled_at INTEGER PRIMARY KEY, current_players INTEGER NOT NULL, max_players INTEGER NOT NULL, server_fps REAL NOT NULL, average_fps REAL NOT NULL, frame_time REAL NOT NULL, world_days INTEGER NOT NULL, base_camps INTEGER NOT NULL, uptime_seconds INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS players (player_key TEXT PRIMARY KEY, name TEXT NOT NULL, account_name TEXT NOT NULL, level INTEGER NOT NULL, first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL, play_seconds INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS player_samples (sampled_at INTEGER NOT NULL, player_key TEXT NOT NULL, level INTEGER NOT NULL, ping INTEGER NOT NULL, play_seconds INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(sampled_at,player_key), FOREIGN KEY(player_key) REFERENCES players(player_key));
    CREATE TABLE IF NOT EXISTS daily_player_samples (sample_day INTEGER NOT NULL, player_key TEXT NOT NULL, sampled_at INTEGER NOT NULL, level INTEGER NOT NULL, play_seconds INTEGER NOT NULL, PRIMARY KEY(sample_day,player_key));
    CREATE TABLE IF NOT EXISTS player_events (occurred_at INTEGER NOT NULL, player_key TEXT NOT NULL, event_type TEXT NOT NULL, level INTEGER NOT NULL, previous_level INTEGER, PRIMARY KEY(occurred_at,player_key,event_type));
    CREATE INDEX IF NOT EXISTS players_level_idx ON players(level DESC, play_seconds DESC);
    CREATE INDEX IF NOT EXISTS player_samples_player_idx ON player_samples(player_key, sampled_at DESC);
    CREATE INDEX IF NOT EXISTS player_events_recent_idx ON player_events(occurred_at DESC);
    """)
    columns = {row[1] for row in connection.execute("PRAGMA table_info(player_samples)")}
    if "play_seconds" not in columns: connection.execute("ALTER TABLE player_samples ADD COLUMN play_seconds INTEGER NOT NULL DEFAULT 0")

def collect() -> dict[str, Any]:
    started_at = int(time.time())
    token = base64.b64encode(f"admin:{read_admin_password()}".encode()).decode("ascii")
    metrics, player_data = api_get("metrics", f"Basic {token}"), api_get("players", f"Basic {token}")
    players, sampled_at = player_data.get("players") or [], int(time.time())
    DATABASE_PATH.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(DATABASE_PATH, timeout=10) as connection:
        connection.execute("PRAGMA journal_mode=WAL"); connection.execute("PRAGMA synchronous=NORMAL"); connection.execute("PRAGMA foreign_keys=ON"); connection.execute("PRAGMA busy_timeout=5000")
        initialize_schema(connection)
        previous = connection.execute("SELECT value FROM metadata WHERE key=?", ("last_sample_at",)).fetchone()
        elapsed = sampled_at - int(previous[0]) if previous else 0
        observed_seconds = min(max(elapsed, 0), INTERVAL_SECONDS * 2)
        prior_online = {row[0] for row in connection.execute("SELECT player_key FROM player_samples WHERE sampled_at=(SELECT MAX(sampled_at) FROM player_samples)")}
        connection.execute("INSERT INTO server_samples VALUES (?,?,?,?,?,?,?,?,?)", (sampled_at, int(metrics.get("currentplayernum") or len(players)), int(metrics.get("maxplayernum") or 0), float(metrics.get("serverfps") or 0), float(metrics.get("serverfpsaverage") or 0), float(metrics.get("serverframetime") or 0), int(metrics.get("days") or 0), int(metrics.get("basecampnum") or 0), int(metrics.get("uptime") or 0)))
        seen: set[str] = set()
        for player in players:
            key, name = player_key(player), str(player.get("name") or "Jogador").strip()[:100]
            account, level, ping = str(player.get("accountName") or "").strip()[:100], max(0, int(player.get("level") or 0)), max(0, round(float(player.get("ping") or 0)))
            old = connection.execute("SELECT level FROM players WHERE player_key=?", (key,)).fetchone()
            connection.execute("INSERT INTO players(player_key,name,account_name,level,first_seen,last_seen,play_seconds) VALUES (?,?,?,?,?,?,?) ON CONFLICT(player_key) DO UPDATE SET name=excluded.name,account_name=excluded.account_name,level=excluded.level,last_seen=excluded.last_seen,play_seconds=players.play_seconds+excluded.play_seconds", (key,name,account,level,sampled_at,sampled_at,observed_seconds))
            play_seconds = connection.execute("SELECT play_seconds FROM players WHERE player_key=?", (key,)).fetchone()[0]
            connection.execute("INSERT OR REPLACE INTO player_samples(sampled_at,player_key,level,ping,play_seconds) VALUES (?,?,?,?,?)", (sampled_at,key,level,ping,play_seconds))
            connection.execute("INSERT OR REPLACE INTO daily_player_samples VALUES (?,?,?,?,?)", (sampled_at // 86400,key,sampled_at,level,play_seconds))
            if key not in prior_online: connection.execute("INSERT OR IGNORE INTO player_events VALUES (?,?,?,?,?)", (sampled_at,key,"joined",level,None))
            if old and level > old[0]: connection.execute("INSERT OR IGNORE INTO player_events VALUES (?,?,?,?,?)", (sampled_at,key,"level_up",level,old[0]))
            seen.add(key)
        for key in prior_online - seen:
            row = connection.execute("SELECT level FROM players WHERE player_key=?", (key,)).fetchone()
            if row: connection.execute("INSERT OR IGNORE INTO player_events VALUES (?,?,?,?,?)", (sampled_at,key,"left",row[0],None))
        cutoff = sampled_at - RAW_RETENTION_DAYS * 86400
        connection.execute("DELETE FROM player_samples WHERE sampled_at < ?", (cutoff,)); connection.execute("DELETE FROM server_samples WHERE sampled_at < ?", (cutoff,)); connection.execute("DELETE FROM player_events WHERE occurred_at < ?", (sampled_at - 90 * 86400,))
        meta(connection,"last_sample_at",str(sampled_at)); meta(connection,"last_collection_duration_ms",str((time.time_ns() // 1_000_000) - started_at)); meta(connection,"last_collection_error","")
        connection.commit()
    return {"sampledAt":sampled_at,"playersObserved":len(players),"secondsCredited":observed_seconds}

if __name__ == "__main__":
    try: print(json.dumps({"ok":True,**collect()},separators=(",",":")))
    except Exception as error: print(json.dumps({"ok":False,"error":type(error).__name__},separators=(",",":"))); raise SystemExit(1)
