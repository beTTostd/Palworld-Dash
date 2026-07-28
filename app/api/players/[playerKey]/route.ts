import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { NextResponse } from "next/server";
export const runtime = "nodejs";
const execFileAsync = promisify(execFile);
const db = "file:/data/palworld.db?mode=ro&immutable=1";
export async function GET(_: Request, { params }: { params: Promise<{ playerKey: string }> }) {
 const { playerKey } = await params;
 if (!/^[a-f0-9]{64}$/.test(playerKey)) return NextResponse.json({ error: "Jogador inválido" }, { status: 400 });
 try {
  const sql = `SELECT json_object('player',(SELECT json_object('name',name,'accountName',account_name,'level',level,'hoursPlayed',ROUND(play_seconds/3600.0,2),'firstSeen',first_seen,'lastSeen',last_seen) FROM players WHERE player_key='${playerKey}'),'events',(SELECT json_group_array(json_object('occurredAt',occurred_at,'type',event_type,'level',level,'previousLevel',previous_level)) FROM player_events WHERE player_key='${playerKey}' ORDER BY occurred_at DESC LIMIT 50),'progress',(SELECT json_group_array(json_object('sampledAt',sampled_at,'level',level,'hoursPlayed',ROUND(play_seconds/3600.0,4))) FROM player_samples WHERE player_key='${playerKey}' ORDER BY sampled_at ASC));`;
  const result = await execFileAsync("sqlite3", ["-readonly", "-json", db, sql], { timeout: 3_000, encoding: "utf8" });
  const payload = JSON.parse(result.stdout || "[]")[0]; return payload?.player ? NextResponse.json(payload) : NextResponse.json({ error: "Jogador não encontrado" }, { status: 404 });
 } catch { return NextResponse.json({ error: "Histórico indisponível" }, { status: 503 }); }
}
