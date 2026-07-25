import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CONFIG_PATH = "/palworld/PalWorldSettings.ini";
const API_URL =
  process.env.PALWORLD_API_URL ?? "http://host.docker.internal:8212";

type RawPlayer = {
  name?: string;
  accountName?: string;
  level?: number;
  ping?: number;
};

async function getAdminPassword() {
  const config = await readFile(CONFIG_PATH, "utf8");
  const match = config.match(/AdminPassword="([^"]+)"/);
  if (!match?.[1]) {
    throw new Error("Palworld admin password is not configured");
  }
  return match[1];
}

async function apiGet<T>(path: string, authorization: string): Promise<T> {
  const response = await fetch(`${API_URL}/v1/api/${path}`, {
    method: "GET",
    headers: {
      Authorization: authorization,
      Accept: "application/json",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(5_000),
  });

  if (!response.ok) {
    throw new Error(`Palworld API returned ${response.status}`);
  }

  return (await response.json()) as T;
}

export async function GET() {
  const checkedAt = new Date().toISOString();

  try {
    const password = await getAdminPassword();
    const authorization = `Basic ${Buffer.from(`admin:${password}`).toString("base64")}`;

    const [info, metrics, playerData] = await Promise.all([
      apiGet<{
        version?: string;
        servername?: string;
        description?: string;
      }>("info", authorization),
      apiGet<{
        currentplayernum?: number;
        maxplayernum?: number;
        serverfps?: number;
        serverfpsaverage?: number;
        serverframetime?: number;
        days?: number;
        basecampnum?: number;
        uptime?: number;
      }>("metrics", authorization),
      apiGet<{ players?: RawPlayer[] }>("players", authorization),
    ]);

    const players = (playerData.players ?? []).map((player) => ({
      name: player.name?.trim() || "Jogador",
      accountName: player.accountName?.trim() || "",
      level: Math.max(0, Math.round(player.level ?? 0)),
      ping: Math.max(0, Math.round(player.ping ?? 0)),
    }));

    return NextResponse.json(
      {
        online: true,
        checkedAt,
        info: {
          version: info.version || "desconhecida",
          serverName: info.servername || "Palworld Server",
          description: info.description || "Servidor dedicado de Palworld",
        },
        metrics: {
          currentPlayers: metrics.currentplayernum ?? players.length,
          maxPlayers: metrics.maxplayernum ?? 0,
          serverFps: Math.round(metrics.serverfps ?? 0),
          averageFps: Number((metrics.serverfpsaverage ?? 0).toFixed(1)),
          frameTime: Number((metrics.serverframetime ?? 0).toFixed(1)),
          worldDays: metrics.days ?? 0,
          baseCamps: metrics.basecampnum ?? 0,
          uptimeSeconds: metrics.uptime ?? 0,
        },
        players,
      },
      {
        headers: {
          "Cache-Control": "no-store, max-age=0",
        },
      },
    );
  } catch {
    return NextResponse.json(
      {
        online: false,
        checkedAt,
        error: "A telemetria do Palworld está temporariamente indisponível.",
      },
      {
        status: 503,
        headers: {
          "Cache-Control": "no-store, max-age=0",
        },
      },
    );
  }
}
