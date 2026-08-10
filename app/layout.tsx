import type { Metadata, Viewport } from "next";
import { BOOT_IMAGE_ASSETS, bootImageMimeType } from "./boot-assets";
import "./globals.css";
import "./interface-v2.css";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH?.replace(/\/$/, "") ?? "";
const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ??
  "https://circon3m22.github.io/knopik-tap";
const publicAsset = (path: string) => `${basePath}${path}`;

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#f7f9fc",
};

export const metadata: Metadata = {
  metadataBase: new URL(new URL(siteUrl).origin),
  title: "KNOPIK TAP",
  description:
    "Тапай Кнопика, собирай монеты, покупай напитки и испытывай удачу в рулетке.",
  applicationName: "Knopik Tap",
  manifest: publicAsset("/manifest.webmanifest"),
  formatDetection: { telephone: false },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Knopik",
  },
  icons: {
    icon: [
      { url: publicAsset("/icon-192-v2.png"), sizes: "192x192", type: "image/png" },
      { url: publicAsset("/icon-512-v2.png"), sizes: "512x512", type: "image/png" },
    ],
    apple: [
      { url: publicAsset("/apple-touch-icon-v2.png"), sizes: "180x180", type: "image/png" },
    ],
  },
  openGraph: {
    title: "KNOPIK TAP",
    description: "Тапай. Покупай. Попади в выигрышный сектор.",
    type: "website",
    locale: "ru_RU",
    images: [{ url: publicAsset("/og.png"), width: 1536, height: 1024, alt: "KNOPIK TAP" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "KNOPIK TAP",
    description: "Тапай. Покупай. Попади в выигрышный сектор.",
    images: [publicAsset("/og.png")],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru">
      <head>
        {/* vinext сериализует viewport без viewport-fit — добавляем его
            в уже инжектированный meta, чтобы env(safe-area-inset-*) работали
            на iPhone в standalone-режиме. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){var m=document.querySelector('meta[name="viewport"]');if(m&&m.content.indexOf('viewport-fit')===-1){m.setAttribute('content','width=device-width, initial-scale=1, viewport-fit=cover');}})();`,
          }}
        />
        {BOOT_IMAGE_ASSETS.map((path, index) => (
          <link
            key={path}
            rel="preload"
            href={publicAsset(path)}
            as="image"
            type={bootImageMimeType(path)}
            fetchPriority={index === 0 ? "high" : "auto"}
          />
        ))}
      </head>
      <body>{children}</body>
    </html>
  );
}
