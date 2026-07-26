import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const execFileAsync = promisify(execFile);
const DATABASE_PATH = "file:/data/palworld.db?mode=ro&immutable=1";
const PLAYER_QUERY = `
  SELECT
    name,
    account_name AS accountName,
    level,
    ROUND(play_seconds / 3600.0, 2) AS hoursPlayed,
    first_seen AS firstSeen,
    last_seen AS lastSeen
  FROM players
  ORDER BY level DESC, play_seconds DESC, name COLLATE NOCASE
  LIMIT 100;
`;
const PROGRESS_QUERY = `
  WITH server_deltas AS (
    SELECT
      sampled_at,
      CASE
        WHEN LAG(sampled_at) OVER (ORDER BY sampled_at) IS NULL THEN 0
        ELSE MIN(
          MAX(
            sampled_at - LAG(sampled_at) OVER (ORDER BY sampled_at),
            0
          ),
          600
        )
      END AS credited_seconds
    FROM server_samples
  ),
  progress AS (
    SELECT
      sample.player_key,
      sample.sampled_at,
      sample.level,
      SUM(delta.credited_seconds) OVER (
        PARTITION BY sample.player_key
        ORDER BY sample.sampled_at
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      ) AS observed_seconds
    FROM player_samples AS sample
    INNER JOIN server_deltas AS delta
      ON delta.sampled_at = sample.sampled_at
  )
  SELECT *
  FROM (
    SELECT
      player.name,
      player.account_name AS accountName,
      progress.sampled_at AS sampledAt,
      progress.level,
      ROUND(progress.observed_seconds / 3600.0, 4) AS hoursPlayed
    FROM progress
    INNER JOIN players AS player
      ON player.player_key = progress.player_key
    ORDER BY progress.sampled_at DESC, player.name COLLATE NOCASE
    LIMIT 10000
  )
  ORDER BY sampledAt ASC, name COLLATE NOCASE;
`;

type PlayerRow = {
  name?: string;
  accountName?: string;
  level?: number;
  hoursPlayed?: number;
  firstSeen?: number;
  lastSeen?: number;
};

type ProgressRow = {
  name?: string;
  accountName?: string;
  sampledAt?: number;
  level?: number;
  hoursPlayed?: number;
};

export async function GET() {
  try {
    const [playerResult, progressResult] = await Promise.all([
      execFileAsync(
        "sqlite3",
        ["-readonly", "-json", DATABASE_PATH, PLAYER_QUERY],
        {
          timeout: 3_000,
          maxBuffer: 512 * 1024,
          encoding: "utf8",
        },
      ),
      execFileAsync(
        "sqlite3",
        ["-readonly", "-json", DATABASE_PATH, PROGRESS_QUERY],
        {
          timeout: 3_000,
          maxBuffer: 2 * 1024 * 1024,
          encoding: "utf8",
        },
      ),
    ]);

    const rows = (
      JSON.parse(playerResult.stdout || "[]") as PlayerRow[]
    ).map((row) => ({
      name: row.name?.trim() || "Jogador",
      accountName: row.accountName?.trim() || "",
      level: Math.max(0, Math.round(row.level ?? 0)),
      hoursPlayed: Math.max(0, Number((row.hoursPlayed ?? 0).toFixed(2))),
      firstSeen: row.firstSeen ?? 0,
      lastSeen: row.lastSeen ?? 0,
    }));
    const progress = (
      JSON.parse(progressResult.stdout || "[]") as ProgressRow[]
    ).map((row) => ({
      name: row.name?.trim() || "Jogador",
      accountName: row.accountName?.trim() || "",
      sampledAt: Math.max(0, Math.round(row.sampledAt ?? 0)),
      level: Math.max(0, Math.round(row.level ?? 0)),
      hoursPlayed: Math.max(0, Number((row.hoursPlayed ?? 0).toFixed(4))),
    }));
    const timestamps = rows.flatMap((row) => [row.firstSeen, row.lastSeen]);
    const validTimestamps = timestamps.filter((value) => value > 0);

    return NextResponse.json(
      {
        players: rows,
        progress,
        trackingSince: validTimestamps.length
          ? new Date(Math.min(...validTimestamps) * 1_000).toISOString()
          : null,
        collectedAt: validTimestamps.length
          ? new Date(Math.max(...validTimestamps) * 1_000).toISOString()
          : null,
        sampleIntervalMinutes: 5,
      },
      { headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  } catch {
    return NextResponse.json(
      {
        players: [],
        progress: [],
        trackingSince: null,
        collectedAt: null,
        sampleIntervalMinutes: 5,
        warmingUp: true,
      },
      { headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  }
}
