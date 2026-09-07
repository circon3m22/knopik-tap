/**
 * Only the portrait pieces required for the first playable frame.
 *
 * Keep this list in sync with the image sources in `page.tsx`. It is imported by
 * the root layout for browser preload hints. Secondary moods, inventory and
 * clothing load normally after the profile is ready.
 */
export const BOOT_IMAGE_ASSETS = [
  "/knopik-calm-earless.webp",
  "/knopik-ear-left.png",
  "/knopik-ear-right.png",
] as const;

export function bootImageMimeType(path: string) {
  return path.endsWith(".webp") ? "image/webp" : "image/png";
}
