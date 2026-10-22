import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

// Tailwind silently ignores responsive prefixes that the theme doesn't define. This
// project defines only the spec's breakpoints in app/globals.css (md = 761px, lg = 1100px),
// so a stray sm:, xl: or 2xl: would quietly break a layout. Fail on any of them.

const WEB = fileURLToPath(new URL("..", import.meta.url))
const css = readFileSync(join(WEB, "app/globals.css"), "utf8")
const DEFINED = new Set([...css.matchAll(/--breakpoint-([a-z0-9]+):\s*(?!initial)[^;]+;/g)].map((m) => m[1]))
const CANDIDATES = ["sm", "md", "lg", "xl", "2xl"]
// (max-|min-)? prefix, a breakpoint name, the variant colon, then directly a class name.
// The lookahead skips object keys such as the button's `sm: "h-9 …"` size option.
const PREFIX = new RegExp(`(?<![\\w-])(?:max-|min-)?(${CANDIDATES.join("|")}):(?=[\\w[(!@*-])`, "g")

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === "node_modules" || name.startsWith(".") ? [] : sourceFiles(path)
    return /\.(tsx?|css)$/.test(name) && !name.endsWith(".test.ts") ? [path] : []
  })
}

describe("responsive prefixes", () => {
  it("reads the project's breakpoints", () => {
    expect([...DEFINED].sort()).toEqual(["lg", "md"])
  })

  it("uses only breakpoints the project defines", () => {
    const problems: string[] = []
    for (const dir of ["app", "components", "lib"]) {
      for (const file of sourceFiles(join(WEB, dir))) {
        readFileSync(file, "utf8")
          .split("\n")
          .forEach((line, i) => {
            for (const m of line.matchAll(PREFIX)) {
              if (!DEFINED.has(m[1]!)) problems.push(`${file.slice(WEB.length)}:${i + 1} uses "${m[0]}"`)
            }
          })
      }
    }
    expect(problems).toEqual([])
  })
})
