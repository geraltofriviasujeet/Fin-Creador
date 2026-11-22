// Writes the PWA icons and the offline page's fonts (Sprint 12b). Run from the repo root with
// `npm run pwa:assets -w @fin-creador/web` (Node strips the TS types) after changing the logo
// tokens or the font packages; the output is committed.
//
// One SVG source: public/icons/icon.svg, the logo mark (design-tokens `logo`, lime on nav
// green) on a full-bleed nav-green square. Every PNG is rendered from it with sharp:
//   icon-192.png, icon-512.png       manifest "any" icons
//   icon-maskable-512.png            the same SVG at 80% on nav green, so the mark sits inside
//                                    the maskable safe zone (a circle of 40% radius)
//   apple-touch-icon.png (180)       iOS rounds the corners itself
//   favicon 16/32/48                 packed into app/favicon.ico (PNG entries)
// Fonts: the latin and latin-ext variable files of Manrope and DM Sans are copied to
// public/fonts/ under stable names, for the offline page (it can't use the hashed app CSS).
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import sharp from "sharp"
import { colors, logo, logoRingPath } from "@fin-creador/design-tokens"

const root = fileURLToPath(new URL("..", import.meta.url))
const icons = join(root, "public/icons")
const fonts = join(root, "public/fonts")
mkdirSync(icons, { recursive: true })
mkdirSync(fonts, { recursive: true })

/** The mark fills MARK_SHARE of the icon's width. */
const MARK_SHARE = 0.6
const VIEW = logo.size / MARK_SHARE
const offset = (VIEW - logo.size) / 2
const c = logo.size / 2

const ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIEW.toFixed(3)} ${VIEW.toFixed(3)}">
  <rect width="${VIEW.toFixed(3)}" height="${VIEW.toFixed(3)}" fill="${colors.nav}"/>
  <g transform="translate(${offset.toFixed(3)} ${offset.toFixed(3)}) rotate(${logo.rotationDeg} ${c} ${c})">
    <rect width="${logo.size}" height="${logo.size}" rx="${logo.cornerRadius}" fill="${colors.accent}"/>
    <path d="${logoRingPath()}" fill="none" stroke="${colors.ink}" stroke-width="${logo.ringStroke}" stroke-linecap="round"/>
  </g>
</svg>
`

writeFileSync(join(icons, "icon.svg"), ICON_SVG)
const source = Buffer.from(ICON_SVG)
const png = (size: number) => sharp(source, { density: 72 * (size / VIEW) * 2 }).resize(size, size).png({ compressionLevel: 9 }).toBuffer()

for (const size of [192, 512]) writeFileSync(join(icons, `icon-${size}.png`), await png(size))
writeFileSync(join(icons, "apple-touch-icon.png"), await png(180))

// Maskable: the same icon at 80%, centred on nav green (the outer 10% may be cropped).
const inner = Math.round(512 * 0.8)
const maskable = await sharp({ create: { width: 512, height: 512, channels: 4, background: colors.nav } })
  .composite([{ input: await png(inner), gravity: "centre" }])
  .png({ compressionLevel: 9 })
  .toBuffer()
writeFileSync(join(icons, "icon-maskable-512.png"), maskable)

// favicon.ico: an ICO directory with PNG entries (supported by every current browser).
const sizes = [16, 32, 48]
const pngs = await Promise.all(sizes.map(png))
const header = Buffer.alloc(6 + 16 * sizes.length)
header.writeUInt16LE(0, 0)
header.writeUInt16LE(1, 2)
header.writeUInt16LE(sizes.length, 4)
let at = header.length
sizes.forEach((size, i) => {
  const e = 6 + 16 * i
  header.writeUInt8(size, e)
  header.writeUInt8(size, e + 1)
  header.writeUInt8(0, e + 2)
  header.writeUInt8(0, e + 3)
  header.writeUInt16LE(1, e + 4)
  header.writeUInt16LE(32, e + 6)
  header.writeUInt32LE(pngs[i]!.length, e + 8)
  header.writeUInt32LE(at, e + 12)
  at += pngs[i]!.length
})
writeFileSync(join(root, "app/favicon.ico"), Buffer.concat([header, ...pngs]))

// Offline page fonts (SIL OFL 1.1, same files the app bundles).
const require = createRequire(import.meta.url)
const fontFiles = {
  "manrope-latin.woff2": "@fontsource-variable/manrope/files/manrope-latin-wght-normal.woff2",
  "manrope-latin-ext.woff2": "@fontsource-variable/manrope/files/manrope-latin-ext-wght-normal.woff2",
  "dm-sans-latin.woff2": "@fontsource-variable/dm-sans/files/dm-sans-latin-wght-normal.woff2",
  "dm-sans-latin-ext.woff2": "@fontsource-variable/dm-sans/files/dm-sans-latin-ext-wght-normal.woff2",
}
for (const [name, from] of Object.entries(fontFiles)) copyFileSync(require.resolve(from), join(fonts, name))
copyFileSync(join(dirname(require.resolve("@fontsource-variable/manrope/package.json")), "LICENSE"), join(fonts, "LICENSE-manrope.txt"))
copyFileSync(join(dirname(require.resolve("@fontsource-variable/dm-sans/package.json")), "LICENSE"), join(fonts, "LICENSE-dm-sans.txt"))

process.stdout.write(`Wrote icons to ${icons}, favicon.ico, and fonts to ${fonts}\n`)
