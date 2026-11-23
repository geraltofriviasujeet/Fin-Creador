// Home's avatar initials. The hero wording (heroText, shortWarnings) is shared with the web
// Overview and lives in packages/api (home/text.ts).

/** "AR" from "Asha Rao", "A" from "Asha"; null without a name. */
export function initials(name: string | null): string | null {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  return words
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}
