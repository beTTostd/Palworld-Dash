import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host =
    requestHeaders.get("x-forwarded-host") ??
    requestHeaders.get("host") ??
    "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? "http";
  const imageUrl = `${protocol}://${host}/og.png`;

  return {
    title: "Manapal — Palworld Server Monitor",
    description:
      "Status ao vivo, jogadores conectados e desempenho do servidor Manapal.",
    openGraph: {
      title: "Manapal — Palworld Server Monitor",
      description: "Telemetria ao vivo do servidor dedicado de Palworld.",
      type: "website",
      images: [{ url: imageUrl, width: 1728, height: 903, alt: "Manapal online" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "Manapal — Palworld Server Monitor",
      description: "Telemetria ao vivo do servidor dedicado de Palworld.",
      images: [imageUrl],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
