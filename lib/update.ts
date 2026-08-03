import { readFile } from "node:fs/promises";

const CACHE_MS = 5 * 60 * 1_000;
const REPOSITORY = "beTTostd/Palworld-Dash";

type UpdateStatus = {
  deployedCommit: string | null;
  latestCommit: string | null;
  updateAvailable: boolean;
  checkedAt: string;
  cacheExpiresAt: string;
  updateEnabled: boolean;
};

let cachedStatus: UpdateStatus | null = null;
let cacheValidUntil = 0;

async function deployedCommit() {
  try {
    return (await readFile("/app/DEPLOYED_COMMIT", "utf8")).trim() || null;
  } catch {
    return process.env.DEPLOYED_COMMIT?.trim() || null;
  }
}

export async function getUpdateStatus(force = false): Promise<UpdateStatus> {
  if (!force && cachedStatus && Date.now() < cacheValidUntil) return cachedStatus;

  const response = await fetch(
    `https://api.github.com/repos/${REPOSITORY}/commits/main`,
    { headers: { Accept: "application/vnd.github+json" }, cache: "no-store" },
  );
  if (!response.ok) throw new Error("Não foi possível consultar o GitHub.");

  const payload = (await response.json()) as { sha?: string };
  const deployed = await deployedCommit();
  const now = Date.now();
  cachedStatus = {
    deployedCommit: deployed,
    latestCommit: payload.sha ?? null,
    updateAvailable: Boolean(payload.sha && deployed && payload.sha !== deployed),
    checkedAt: new Date(now).toISOString(),
    cacheExpiresAt: new Date(now + CACHE_MS).toISOString(),
    updateEnabled: Boolean(process.env.UPDATER_TOKEN),
  };
  cacheValidUntil = now + CACHE_MS;
  return cachedStatus;
}
