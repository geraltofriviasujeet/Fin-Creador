// Runs in Vitest (Node), not in the app. Every font the app loads must draw ₹ itself, so
// amounts look the same on every phone instead of falling back to a system font.
/// <reference types="node" />
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const RUPEE = 0x20b9;
// The fonts app/_layout.tsx loads (theme.ts imports React Native, which Vitest cannot parse).
const LOADED = [
  "Manrope_600SemiBold",
  "Manrope_700Bold",
  "Manrope_800ExtraBold",
  "DMSans_400Regular",
  "DMSans_500Medium",
  "DMSans_600SemiBold",
  "DMSans_700Bold",
];

/** The font file for a family name such as "DMSans_600SemiBold" (workspace or hoisted install). */
function fontPath(name: string): string {
  const [family = "", weight = ""] = name.split("_");
  const pkg = family === "DMSans" ? "dm-sans" : family.toLowerCase();
  const rel = `@expo-google-fonts/${pkg}/${weight}/${name}.ttf`;
  for (const base of ["../node_modules/", "../../../node_modules/"]) {
    const path = fileURLToPath(new URL(base + rel, import.meta.url));
    if (existsSync(path)) return path;
  }
  throw new Error(`Font file not found: ${rel}`);
}

/** True when the font's cmap (format 4 or 12) maps the code point. */
function hasGlyph(file: Buffer, codePoint: number): boolean {
  const tables = file.readUInt16BE(4);
  let cmap = -1;
  for (let i = 0; i < tables; i++) {
    const rec = 12 + i * 16;
    if (file.toString("latin1", rec, rec + 4) === "cmap") cmap = file.readUInt32BE(rec + 8);
  }
  if (cmap < 0) return false;
  for (let i = 0; i < file.readUInt16BE(cmap + 2); i++) {
    const sub = cmap + file.readUInt32BE(cmap + 4 + i * 8 + 4);
    const format = file.readUInt16BE(sub);
    if (format === 4) {
      const segX2 = file.readUInt16BE(sub + 6);
      const ends = sub + 14;
      const starts = ends + segX2 + 2;
      for (let s = 0; s < segX2 / 2; s++) {
        if (codePoint >= file.readUInt16BE(starts + 2 * s) && codePoint <= file.readUInt16BE(ends + 2 * s)) return true;
      }
    } else if (format === 12) {
      for (let g = 0; g < file.readUInt32BE(sub + 12); g++) {
        const rec = sub + 16 + g * 12;
        if (codePoint >= file.readUInt32BE(rec) && codePoint <= file.readUInt32BE(rec + 4)) return true;
      }
    }
  }
  return false;
}

describe("app fonts", () => {
  it.each(LOADED)("%s draws the rupee sign", (name) => {
    const file = readFileSync(fontPath(name));
    expect(hasGlyph(file, RUPEE)).toBe(true);
    expect(hasGlyph(file, 0x0915)).toBe(false); // control: Devanagari KA is not in these fonts
  });
});
