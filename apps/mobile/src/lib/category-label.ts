import { mobile } from "@fin-creador/design-tokens";

// The Add screen's category tiles are about 77pt wide inside at 390pt, four to a row. Labels wrap
// to two lines, which fits every built-in name at 12px except a single word of 12 or more
// letters ("Entertainment" is 82pt at 12px in DM Sans Medium): only those labels drop to 11px
// (owner, 13b PR 5: "shrink slightly if needed").
export const CATEGORY_LABEL_LONG_WORD = 12;
export const CATEGORY_LABEL_SMALL_SIZE = 11;

/** The tile label's font size: 12px, or 11px when one word is too long for the tile's width. */
export function categoryLabelSize(label: string): number {
  const longest = Math.max(0, ...label.split(/\s+/).map((w) => w.length));
  return longest >= CATEGORY_LABEL_LONG_WORD ? CATEGORY_LABEL_SMALL_SIZE : mobile.type.min.size;
}
