// Renders the onboarding carousel's pictures (scripts/onboarding/scenes.ts) to WebP in
// apps/web/public/onboarding/: <slug>-desktop.webp (1200 × 750) and <slug>-phone.webp (780 × 780).
// Re-run after changing a scene or the brand tokens:
//
//   node scripts/capture-onboarding.ts
//
// Needs only the installed Google Chrome (Playwright's "chrome" channel, as the E2E tests use):
// no app server, no database, no network. Fonts and tokens are read from node_modules and
// packages/design-tokens and inlined. Each file must come out under 100 KB; the WebP quality is
// lowered step by step until it does, and the script fails if it never does.

import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { type Page, chromium } from "@playwright/test"
import { SCENES, SIZES, type Variant, sceneHtml } from "./onboarding/scenes.ts"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const OUT = path.join(ROOT, "apps/web/public/onboarding")
const MAX_BYTES = 100 * 1024
const SCALE = 2

async function fontFace(family: string, file: string): Promise<string> {
  const data = await readFile(path.join(ROOT, "node_modules", file))
  return `@font-face{font-family:"${family}";src:url(data:font/woff2;base64,${data.toString("base64")}) format("woff2");font-weight:100 900;}`
}

async function main() {
  const fonts =
    (await fontFace("Manrope Variable", "@fontsource-variable/manrope/files/manrope-latin-wght-normal.woff2")) +
    (await fontFace("DM Sans Variable", "@fontsource-variable/dm-sans/files/dm-sans-latin-wght-normal.woff2"))
  const tokens = await readFile(path.join(ROOT, "packages/design-tokens/tokens.css"), "utf8")
  await mkdir(OUT, { recursive: true })

  const browser = await chromium.launch({ channel: "chrome" })
  try {
    for (const variant of Object.keys(SIZES) as Variant[]) {
      const { width, height } = SIZES[variant]
      const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: SCALE, offline: true })
      const page = await context.newPage()
      for (const scene of SCENES) {
        await page.setContent(sceneHtml(scene, variant, fonts, tokens), { waitUntil: "load" })
        await page.evaluate(() => document.fonts.ready)
        const png = await page.screenshot({ type: "png" })
        const webp = await toWebp(page, png)
        const file = path.join(OUT, `${scene.slug}-${variant}.webp`)
        await writeFile(file, webp)
        console.warn(`${path.relative(ROOT, file)}  ${width * SCALE}×${height * SCALE}  ${(webp.length / 1024).toFixed(1)} KB`)
      }
      await context.close()
    }
  } finally {
    await browser.close()
  }
}

/** Encodes in the browser (canvas), lowering the quality until the file is under the limit. */
async function toWebp(page: Page, png: Buffer): Promise<Buffer> {
  for (const quality of [0.86, 0.8, 0.74, 0.68, 0.6, 0.5]) {
    const base64 = await page.evaluate(
      async ({ src, q }) => {
        const img = new Image()
        img.src = src
        await img.decode()
        const canvas = document.createElement("canvas")
        canvas.width = img.naturalWidth
        canvas.height = img.naturalHeight
        canvas.getContext("2d")!.drawImage(img, 0, 0)
        const url = canvas.toDataURL("image/webp", q)
        if (!url.startsWith("data:image/webp")) throw new Error("This browser can't encode WebP")
        return url.slice(url.indexOf(",") + 1)
      },
      { src: `data:image/png;base64,${png.toString("base64")}`, q: quality }
    )
    const out = Buffer.from(base64, "base64")
    if (out.length < MAX_BYTES) return out
  }
  throw new Error("Couldn't get the picture under 100 KB; simplify the scene.")
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
