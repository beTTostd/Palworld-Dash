import { NextRequest, NextResponse } from "next/server";
import { allowAttempt, validUpdatePassword } from "@/lib/update-auth";
import { getUpdateStatus } from "@/lib/update";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const status = await getUpdateStatus();
    return NextResponse.json(status, { headers: { "Cache-Control": "private, max-age=300" } });
  } catch {
    return NextResponse.json({ error: "Não foi possível verificar atualizações." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (origin && origin !== request.nextUrl.origin) {
    return NextResponse.json({ error: "Origem não autorizada." }, { status: 403 });
  }
  const address = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!allowAttempt(address)) return NextResponse.json({ error: "Muitas tentativas. Aguarde 15 minutos." }, { status: 429 });

  const body = (await request.json().catch(() => null)) as { password?: unknown } | null;
  if (typeof body?.password !== "string" || !validUpdatePassword(body.password)) {
    return NextResponse.json({ error: "Senha inválida." }, { status: 401 });
  }

  try {
    const status = await getUpdateStatus(true);
    if (!status.updateAvailable || !status.latestCommit) return NextResponse.json({ ...status, started: false });
    const updaterUrl = process.env.UPDATE_AGENT_URL || "http://host.docker.internal:3010";
    const result = await fetch(`${updaterUrl}/deploy`, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.UPDATER_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ commit: status.latestCommit }),
      signal: AbortSignal.timeout(5_000),
    });
    if (!result.ok) throw new Error("O agente recusou a atualização.");
    return NextResponse.json({ ...status, started: true });
  } catch {
    return NextResponse.json({ error: "Não foi possível iniciar a atualização." }, { status: 503 });
  }
}
