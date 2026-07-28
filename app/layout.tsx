import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import "./globals.css";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#030507",
};

export async function generateMetadata(): Promise<Metadata> {
  const incomingHeaders = await headers();
  const host =
    incomingHeaders.get("x-forwarded-host") ??
    incomingHeaders.get("host") ??
    "localhost:3000";
  const protocol =
    incomingHeaders.get("x-forwarded-proto") ??
    (host.includes("localhost") ? "http" : "https");
  const metadataBase = new URL(`${protocol}://${host}`);
  const socialImage = new URL("/og-arcade.png", metadataBase).toString();

  return {
    metadataBase,
    title: "KNOPIK TAP",
    description:
      "Тапай Кнопика, рискуй и защищай монеты в сейфах.",
    applicationName: "Knopik Tap",
    manifest: "/manifest.webmanifest",
    formatDetection: { telephone: false },
    appleWebApp: {
      capable: true,
      statusBarStyle: "black-translucent",
      title: "Knopik",
    },
    icons: {
      icon: [{ url: "/knopik-calm.png", type: "image/png" }],
      apple: [{ url: "/knopik-calm.png", type: "image/png" }],
    },
    openGraph: {
      title: "KNOPIK TAP",
      description: "Тапай, рискуй и защищай монеты в сейфах.",
      type: "website",
      locale: "ru_RU",
      images: [{ url: socialImage, width: 1536, height: 1024, alt: "KNOPIK TAP" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "KNOPIK TAP",
      description: "Тапай, рискуй и защищай монеты в сейфах.",
      images: [socialImage],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
