import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json(
    { ok: true, mode: "read-only" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
