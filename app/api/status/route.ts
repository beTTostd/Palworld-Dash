import { NextResponse } from "next/server";
import { dashboardCacheSeconds, getDashboardSnapshot } from "@/lib/palworld";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const checkedAt = new Date().toISOString();
  try {
    const { info, metrics, players: rawPlayers } = await getDashboardSnapshot();
    const players = rawPlayers.map((player) => ({ name: player.name?.trim() || "Jogador", accountName: player.accountName?.trim() || "", level: Math.max(0, Math.round(player.level ?? 0)), ping: Math.max(0, Math.round(player.ping ?? 0)) }));
    return NextResponse.json({
      online: true, checkedAt,
      info: { version: info.version || "desconhecida", serverName: info.servername || "Palworld Server", description: info.description || "Servidor dedicado de Palworld" },
      metrics: { currentPlayers: metrics.currentplayernum ?? players.length, maxPlayers: metrics.maxplayernum ?? 0, serverFps: Math.round(metrics.serverfps ?? 0), averageFps: Number((metrics.serverfpsaverage ?? 0).toFixed(1)), frameTime: Number((metrics.serverframetime ?? 0).toFixed(1)), worldDays: metrics.days ?? 0, baseCamps: metrics.basecampnum ?? 0, uptimeSeconds: metrics.uptime ?? 0 },
      players, cacheSeconds: dashboardCacheSeconds,
    }, { headers: { "Cache-Control": "private, max-age=5" } });
  } catch {
    return NextResponse.json({ online: false, checkedAt, error: "A telemetria do Palworld está temporariamente indisponível." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
