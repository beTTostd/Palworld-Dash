import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { NextResponse } from "next/server";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const execFileAsync = promisify(execFile);
const db = "file:/data/palworld.db?mode=ro&immutable=1";
const query = `
WITH points AS (
 SELECT player_key,sampled_at,level,play_seconds FROM daily_player_samples WHERE sampled_at < strftime('%s','now') - 2592000
 UNION ALL SELECT player_key,sampled_at,level,play_seconds FROM player_samples
)
SELECT json_object('players',json((SELECT json_group_array(json_object('playerKey',player_key,'name',name,'accountName',account_name,'level',level,'hoursPlayed',ROUND(play_seconds/3600.0,2),'firstSeen',first_seen,'lastSeen',last_seen)) FROM (SELECT * FROM players ORDER BY level DESC,play_seconds DESC,name COLLATE NOCASE LIMIT 100))), 'progress',json((SELECT json_group_array(json_object('playerKey',p.player_key,'name',pl.name,'accountName',pl.account_name,'sampledAt',p.sampled_at,'level',p.level,'hoursPlayed',ROUND(p.play_seconds/3600.0,4))) FROM points p JOIN players pl ON pl.player_key=p.player_key ORDER BY p.sampled_at ASC)), 'events',json((SELECT json_group_array(json_object('occurredAt',e.occurred_at,'playerKey',e.player_key,'name',pl.name,'type',e.event_type,'level',e.level,'previousLevel',e.previous_level)) FROM (SELECT * FROM player_events ORDER BY occurred_at DESC LIMIT 30) e JOIN players pl ON pl.player_key=e.player_key)), 'metadata',(SELECT json_group_object(key,value) FROM metadata));`;
export async function GET() {
 try {
  const result = await execFileAsync("sqlite3", ["-readonly", "-json", db, query], { timeout: 3_000, maxBuffer: 2 * 1024 * 1024, encoding: "utf8" });
  const raw = JSON.parse(result.stdout || "[]")[0] ?? {};
  const players = raw.players ?? [], progress = raw.progress ?? [], events = raw.events ?? [], metadata = raw.metadata ?? {};
  const timestamps = players.flatMap((row: { firstSeen?: number; lastSeen?: number }) => [row.firstSeen ?? 0, row.lastSeen ?? 0]).filter(Boolean);
  return NextResponse.json({ players, progress, events, trackingSince: timestamps.length ? new Date(Math.min(...timestamps) * 1000).toISOString() : null, collectedAt: metadata.last_sample_at ? new Date(Number(metadata.last_sample_at) * 1000).toISOString() : null, collector: { lastSampleAt: Number(metadata.last_sample_at || 0) || null, durationMs: Number(metadata.last_collection_duration_ms || 0) || null, stale: !metadata.last_sample_at || Date.now() / 1000 - Number(metadata.last_sample_at) > 600 }, sampleIntervalMinutes: 5 }, { headers: { "Cache-Control": "no-store" } });
 } catch { return NextResponse.json({ players: [], progress: [], events: [], trackingSince: null, collectedAt: null, collector: { stale: true }, sampleIntervalMinutes: 5, warmingUp: true }, { headers: { "Cache-Control": "no-store" } }); }
}
