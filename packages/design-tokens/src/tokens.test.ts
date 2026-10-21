import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { toCssVariables } from "./css.ts";
import { MIN_FONT_SIZE, colors, contrastPairs, fontSize, layout } from "./index.ts";

const pkgDir = fileURLToPath(new URL("..", import.meta.url));
const repoRoot = join(pkgDir, "..", "..");

// WCAG 2.x relative luminance / contrast ratio.
function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((c) =>
    c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
  ) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

describe("tokens.css", () => {
  it("is in sync with src/index.ts (run `npm run tokens` if this fails)", () => {
    const onDisk = readFileSync(join(pkgDir, "tokens.css"), "utf8");
    expect(onDisk).toBe(toCssVariables());
  });
});

describe("web breakpoints", () => {
  it("match layout tokens (CSS media queries cannot use variables)", () => {
    const css = readFileSync(join(repoRoot, "apps/web/app/globals.css"), "utf8");
    expect(css).toContain(`--breakpoint-md: ${layout.mobileMaxWidth + 1}px;`);
    expect(css).toContain(`--breakpoint-lg: ${layout.desktopMinWidth}px;`);
  });
});

describe("colour contrast", () => {
  it("computes known WCAG ratios", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrast("#777777", "#ffffff")).toBeCloseTo(4.48, 2);
  });

  it.each(contrastPairs)("$fg on $bg ≥ $min ($use)", ({ fg, bg, min }) => {
    expect(contrast(colors[fg], colors[bg])).toBeGreaterThanOrEqual(min);
  });
});

describe("minimum text size", () => {
  it("type scale starts at 12px", () => {
    expect(Math.min(...Object.values(fontSize))).toBeGreaterThanOrEqual(MIN_FONT_SIZE);
  });

  // Catches arbitrary sizes such as text-[10px], text-[0.6rem], fontSize: 9, font-size: 11px.
  it("no source file sets text below 12px", () => {
    const roots = ["apps/web/app", "apps/web/components", "apps/mobile"].map((p) =>
      join(repoRoot, p),
    );
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        if (["node_modules", ".next", ".expo"].includes(name)) continue;
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.(tsx?|css)$/.test(name)) files.push(path);
      }
    };
    roots.forEach(walk);

    const toPx = (value: number, unit: string) => (unit === "rem" || unit === "em" ? value * 16 : value);
    const patterns = [
      /text-\[(\d*\.?\d+)(px|rem|em)\]/g,
      /font-size:\s*(\d*\.?\d+)(px|rem|em)/g,
      /fontSize:\s*(\d*\.?\d+)()/g,
    ];
    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const pattern of patterns) {
        for (const m of source.matchAll(pattern)) {
          if (toPx(Number(m[1]), m[2] ?? "px") < MIN_FONT_SIZE) {
            offenders.push(`${relative(repoRoot, file)}: ${m[0]}`);
          }
        }
      }
    }
    expect(files.length).toBeGreaterThan(0);
    expect(offenders).toEqual([]);
  });
});
