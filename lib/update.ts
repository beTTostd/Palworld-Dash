const CACHE_MS = 5 * 60 * 1_000;

type UpdateStatus = {
  installedBuild: string | null;
  latestBuild: string | null;
  updateAvailable: boolean;
  checkedAt: string;
  cacheExpiresAt: string;
  updateEnabled: boolean;
};

let cachedStatus: UpdateStatus | null = null;
let cacheValidUntil = 0;

export async function getUpdateStatus(force = false): Promise<UpdateStatus> {
  if (!force && cachedStatus && Date.now() < cacheValidUntil) return cachedStatus;
  const updaterUrl = process.env.UPDATE_AGENT_URL || "http://host.docker.internal:3010";
  const response = await fetch(`${updaterUrl}/status`, { cache: "no-store", signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error("Não foi possível consultar a Steam.");
  const payload = (await response.json()) as { installedBuild?: string; latestBuild?: string };
  const now = Date.now();
  cachedStatus = {
    installedBuild: payload.installedBuild ?? null,
    latestBuild: payload.latestBuild ?? null,
    updateAvailable: Boolean(payload.installedBuild && payload.latestBuild && payload.installedBuild !== payload.latestBuild),
    checkedAt: new Date(now).toISOString(),
    cacheExpiresAt: new Date(now + CACHE_MS).toISOString(),
    updateEnabled: Boolean(process.env.UPDATER_TOKEN),
  };
  cacheValidUntil = now + CACHE_MS;
  return cachedStatus;
}
