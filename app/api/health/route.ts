import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const execFileAsync = promisify(execFile);
const db = "file:/data/palworld.db?mode=ro&immutable=1";

export async function GET() {
  const now = Math.floor(Date.now() / 1_000);
  try {
    const result = await execFileAsync("sqlite3", ["-readonly", "-json", db, "SELECT key,value FROM metadata WHERE key IN ('last_sample_at','last_collection_duration_ms','last_collection_error');"], { timeout: 2_000, encoding: "utf8" });
    const metadata = Object.fromEntries((JSON.parse(result.stdout || "[]") as { key: string; value: string }[]).map((row) => [row.key, row.value]));
    const lastSampleAt = Number(metadata.last_sample_at || 0);
    const stale = !lastSampleAt || now - lastSampleAt > 600;
    return NextResponse.json({ ok: !stale, mode: "read-only", collector: { lastSampleAt: lastSampleAt || null, ageSeconds: lastSampleAt ? now - lastSampleAt : null, durationMs: Number(metadata.last_collection_duration_ms || 0) || null, error: metadata.last_collection_error || null, stale } }, { status: stale ? 503 : 200, headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ ok: false, mode: "read-only", collector: { stale: true } }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
