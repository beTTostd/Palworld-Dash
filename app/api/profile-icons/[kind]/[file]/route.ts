import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const allowedKinds = new Set(["pals", "items"]);
const allowedFile = /^[A-Za-z0-9_.-]+\.webp$/;

export async function GET(
  _: Request,
  { params }: { params: Promise<{ kind: string; file: string }> },
) {
  const { kind, file } = await params;
  if (!allowedKinds.has(kind) || !allowedFile.test(file)) {
    return NextResponse.json({ error: "Imagem não encontrada" }, { status: 404 });
  }

  try {
    const data = await readFile(`/data/profile-icons/${kind}/${file}`);
    return new NextResponse(new Uint8Array(data), {
      headers: {
        "Content-Type": "image/webp",
        "Cache-Control": "public, max-age=86400, immutable",
      },
    });
  } catch {
    return NextResponse.json({ error: "Imagem não encontrada" }, { status: 404 });
  }
}
