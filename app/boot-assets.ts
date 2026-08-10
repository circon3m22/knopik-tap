/**
 * Images used by the initial game screen and its immediately available controls.
 *
 * Keep this list in sync with the image sources in `page.tsx`. It is imported by
 * the root layout for browser preload hints and by the client boot splash to wait
 * until the images have finished decoding.
 */
export const BOOT_IMAGE_ASSETS = [
  "/knopik-calm-earless.webp",
  "/knopik-joy-sprite-earless.webp",
  "/knopik-warning-earless.webp",
  "/knopik-rage-sprite-earless.webp",
  "/knopik-ear-left.png",
  "/knopik-ear-right.png",
  "/buffs/food.png",
  "/buffs/zhivchik.png",
  "/buffs/pitbull.png",
  "/buffs/cocoa-cola.png",
  "/buffs/bergamot-tea.png",
  "/buffs/pepsi.png",
  "/hasbik-tubeteika.png",
  "/knopik-mohawk-v2.png",
] as const;

export function bootImageMimeType(path: string) {
  return path.endsWith(".webp") ? "image/webp" : "image/png";
}
