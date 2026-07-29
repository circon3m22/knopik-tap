import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import "./globals.css";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#1478ed",
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
  const socialImage = new URL("/og-minimal.png", metadataBase).toString();

  return {
    metadataBase,
    title: "KNOPIK TAP",
    description:
      "Тапай быстрее, заряжай ультра-тап и защищай половину монет в бесплатном сейфе.",
    applicationName: "Knopik Tap",
    manifest: "/manifest.webmanifest",
    formatDetection: { telephone: false },
    appleWebApp: {
      capable: true,
      statusBarStyle: "black-translucent",
      title: "Knopik",
    },
    icons: {
      icon: [
        { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
        { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
      ],
      apple: [
        { url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
      ],
    },
    openGraph: {
      title: "KNOPIK TAP",
      description: "Тапай. Рискуй. Сохраняй.",
      type: "website",
      locale: "ru_RU",
      images: [{ url: socialImage, width: 1536, height: 1024, alt: "KNOPIK TAP" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "KNOPIK TAP",
      description: "Тапай. Рискуй. Сохраняй.",
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
      <head>
        <link rel="preload" href="/knopik-joy-sprite.png" as="image" type="image/png" fetchPriority="high" />
        <link rel="preload" href="/knopik-rage-sprite.png" as="image" type="image/png" fetchPriority="high" />
      </head>
      <body>{children}</body>
    </html>
  );
}
