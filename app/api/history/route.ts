import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const execFileAsync = promisify(execFile);
const DATABASE_PATH = "/data/palworld.db";
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

type PlayerRow = {
  name?: string;
  accountName?: string;
  level?: number;
  hoursPlayed?: number;
  firstSeen?: number;
  lastSeen?: number;
};

export async function GET() {
  try {
    const { stdout } = await execFileAsync(
      "sqlite3",
      ["-readonly", "-json", DATABASE_PATH, PLAYER_QUERY],
      {
        timeout: 3_000,
        maxBuffer: 512 * 1024,
        encoding: "utf8",
      },
    );

    const rows = (JSON.parse(stdout || "[]") as PlayerRow[]).map((row) => ({
      name: row.name?.trim() || "Jogador",
      accountName: row.accountName?.trim() || "",
      level: Math.max(0, Math.round(row.level ?? 0)),
      hoursPlayed: Math.max(0, Number((row.hoursPlayed ?? 0).toFixed(2))),
      firstSeen: row.firstSeen ?? 0,
      lastSeen: row.lastSeen ?? 0,
    }));
    const timestamps = rows.flatMap((row) => [row.firstSeen, row.lastSeen]);
    const validTimestamps = timestamps.filter((value) => value > 0);

    return NextResponse.json(
      {
        players: rows,
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
        trackingSince: null,
        collectedAt: null,
        sampleIntervalMinutes: 5,
        warmingUp: true,
      },
      { headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  }
}
