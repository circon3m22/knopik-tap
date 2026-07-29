import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import "./globals.css";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#f7f9fc",
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
  const socialImage = new URL("/og.png", metadataBase).toString();

  return {
    metadataBase,
    title: "KNOPIK TAP",
    description:
      "Тапай Кнопика, собирай монеты, покупай напитки и испытывай удачу в рулетке.",
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
        { url: "/icon-192-v2.png", sizes: "192x192", type: "image/png" },
        { url: "/icon-512-v2.png", sizes: "512x512", type: "image/png" },
      ],
      apple: [
        { url: "/apple-touch-icon-v2.png", sizes: "180x180", type: "image/png" },
      ],
    },
    openGraph: {
      title: "KNOPIK TAP",
      description: "Тапай. Покупай. Попади в выигрышный сектор.",
      type: "website",
      locale: "ru_RU",
      images: [{ url: socialImage, width: 1536, height: 1024, alt: "KNOPIK TAP" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "KNOPIK TAP",
      description: "Тапай. Покупай. Попади в выигрышный сектор.",
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
        <link rel="preload" href="/knopik-joy-sprite-earless.png" as="image" type="image/png" fetchPriority="high" />
        <link rel="preload" href="/knopik-rage-sprite-earless.png" as="image" type="image/png" fetchPriority="high" />
      </head>
      <body>{children}</body>
    </html>
  );
}
