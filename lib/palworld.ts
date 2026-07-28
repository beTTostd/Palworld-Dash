import { readFile } from "node:fs/promises";

const CONFIG_PATH = "/palworld/PalWorldSettings.ini";
const API_URL = process.env.PALWORLD_API_URL ?? "http://host.docker.internal:8212";
const CACHE_TTL_MS = 10_000;

type RawPlayer = { name?: string; accountName?: string; level?: number; ping?: number };
export type DashboardSnapshot = {
  info: { version?: string; servername?: string; description?: string };
  metrics: { currentplayernum?: number; maxplayernum?: number; serverfps?: number; serverfpsaverage?: number; serverframetime?: number; days?: number; basecampnum?: number; uptime?: number };
  players: RawPlayer[];
};

let cached: { value: DashboardSnapshot; expiresAt: number } | null = null;
let pending: Promise<DashboardSnapshot> | null = null;

async function password() {
  const config = await readFile(CONFIG_PATH, "utf8");
  const match = config.match(/AdminPassword="([^"]+)"/);
  if (!match?.[1]) throw new Error("Palworld admin password is not configured");
  return match[1];
}

async function get<T>(path: string, authorization: string) {
  const response = await fetch(`${API_URL}/v1/api/${path}`, { headers: { Authorization: authorization, Accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(5_000) });
  if (!response.ok) throw new Error(`Palworld API returned ${response.status}`);
  return (await response.json()) as T;
}

export async function getDashboardSnapshot() {
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  if (!pending) {
    pending = (async () => {
      const authorization = `Basic ${Buffer.from(`admin:${await password()}`).toString("base64")}`;
      const [info, metrics, players] = await Promise.all([
        get<DashboardSnapshot["info"]>("info", authorization),
        get<DashboardSnapshot["metrics"]>("metrics", authorization),
        get<{ players?: RawPlayer[] }>("players", authorization),
      ]);
      const value = { info, metrics, players: players.players ?? [] };
      cached = { value, expiresAt: Date.now() + CACHE_TTL_MS };
      return value;
    })().finally(() => { pending = null; });
  }
  return pending;
}

export const dashboardCacheSeconds = CACHE_TTL_MS / 1_000;
