// Single source of truth for FinCreador brand tokens (docs/design-spec.md §2).
// Plain values only, so web (CSS variables, generated into tokens.css) and
// mobile (React Native styles) consume the same numbers.
// After changing anything here run `npm run tokens` to regenerate tokens.css.

export const colors = {
  /** Primary text, primary buttons. */
  ink: "#18251f",
  /** Secondary text. Darkened from Figma #718078 to meet WCAG AA on canvas/surface. */
  muted: "#5f6e66",
  /** Figma muted, for icons and placeholders only (≥3:1, not for body text). */
  mutedSubtle: "#718078",
  /** Borders and dividers (decorative). */
  line: "#e3e9e5",
  /** Form control borders: 3:1 against surface so inputs are identifiable (WCAG 1.4.11). */
  lineStrong: "#86948c",
  /** Page background. */
  canvas: "#f5f7f3",
  /** Cards and modals. */
  surface: "#ffffff",
  /** Sidebar and toast background. */
  nav: "#17251f",
  /** Primary text on nav / dark surfaces. */
  navText: "#ffffff",
  /** Secondary text on nav / dark surfaces. */
  navMuted: "#a9b6af",
  /** Lime: active nav, logo, highlights. Fill only — never text on light surfaces. */
  accent: "#b9f06b",
  /** Balance card, donut fill, focus ring on light surfaces. */
  accentDeep: "#263e31",
  /** Income chip, positive badge. */
  mint: "#dff6dc",
  /** Expense chip, negative badge. */
  peach: "#fee5d9",
  /** Savings chip. */
  lavender: "#e8e6ff",
  /** Housing / goal chip. */
  blue: "#ddecf8",
  /** Spending chart line, savings progress. */
  chart: "#5b59df",
  /** Extra chart series (Income by source bars), with chart, accentDeep and dangerFill. */
  chartBlue: "#2f6fb0",
  chartAmber: "#a86a00",
  chartTeal: "#0e7c86",
  /** Positive amounts (text). Darkened from Figma #20805a to pass AA on mint. */
  success: "#1a6b4b",
  /** Figma success, for fills/icons. */
  successFill: "#20805a",
  /** Negative trend (text). Darkened from Figma #b95d4a to pass AA on peach. */
  danger: "#9a4636",
  /** Figma danger, for fills/icons. */
  dangerFill: "#b95d4a",
  /** Mobile warning (design-spec §5): over-budget bars, "leaves you short" banners. Text-safe on surface/canvas. */
  warning: "#c2412d",
  /** Warning text on forest (hero card shortfall line), with the warning icon. AA on nav and accentDeep. */
  warningOnDark: "#ffa894",
  /** Mobile neutral category tint (design-spec §5). */
  tintGrey: "#f0f3f1",
} as const;

export type ColorToken = keyof typeof colors;

/** Text/background pairs the UI relies on; enforced by tests (WCAG AA). */
export const contrastPairs: ReadonlyArray<{
  fg: ColorToken;
  bg: ColorToken;
  min: number;
  use: string;
}> = [
  { fg: "ink", bg: "canvas", min: 4.5, use: "body text on page" },
  { fg: "ink", bg: "surface", min: 4.5, use: "body text on cards" },
  { fg: "muted", bg: "canvas", min: 4.5, use: "secondary text on page" },
  { fg: "muted", bg: "surface", min: 4.5, use: "secondary text on cards" },
  { fg: "surface", bg: "ink", min: 4.5, use: "primary button label" },
  { fg: "ink", bg: "accent", min: 4.5, use: "active nav / brand button" },
  { fg: "navText", bg: "nav", min: 4.5, use: "sidebar text" },
  { fg: "navMuted", bg: "nav", min: 4.5, use: "sidebar secondary text" },
  { fg: "accent", bg: "nav", min: 4.5, use: "wordmark 'Creador' on nav" },
  { fg: "navText", bg: "accentDeep", min: 4.5, use: "balance card text" },
  { fg: "navMuted", bg: "accentDeep", min: 4.5, use: "balance card secondary" },
  { fg: "accent", bg: "accentDeep", min: 4.5, use: "badge on balance card" },
  { fg: "success", bg: "mint", min: 4.5, use: "positive badge" },
  { fg: "success", bg: "surface", min: 4.5, use: "positive amount" },
  { fg: "danger", bg: "peach", min: 4.5, use: "negative badge" },
  { fg: "danger", bg: "surface", min: 4.5, use: "error text" },
  { fg: "ink", bg: "mint", min: 4.5, use: "text on chip" },
  { fg: "ink", bg: "peach", min: 4.5, use: "text on chip" },
  { fg: "ink", bg: "lavender", min: 4.5, use: "text on chip" },
  { fg: "ink", bg: "blue", min: 4.5, use: "text on chip" },
  { fg: "chart", bg: "surface", min: 3, use: "chart line / progress (non-text)" },
  { fg: "chartBlue", bg: "surface", min: 3, use: "chart series (non-text)" },
  { fg: "chartAmber", bg: "surface", min: 3, use: "chart series (non-text)" },
  { fg: "chartTeal", bg: "surface", min: 3, use: "chart series (non-text)" },
  { fg: "dangerFill", bg: "surface", min: 3, use: "chart series (non-text)" },
  { fg: "lineStrong", bg: "surface", min: 3, use: "input border (non-text)" },
  { fg: "mutedSubtle", bg: "surface", min: 3, use: "icons (non-text)" },
  { fg: "accentDeep", bg: "surface", min: 3, use: "focus ring on light" },
  { fg: "accentDeep", bg: "canvas", min: 3, use: "focus ring on page" },
  { fg: "accent", bg: "nav", min: 3, use: "focus ring on nav" },
  { fg: "accent", bg: "accentDeep", min: 3, use: "focus ring on deep card" },
  // Mobile design system (design-spec §5).
  { fg: "successFill", bg: "surface", min: 4.5, use: "mobile Money in amount on cards" },
  { fg: "successFill", bg: "canvas", min: 4.5, use: "mobile Money in amount on page" },
  { fg: "warning", bg: "surface", min: 4.5, use: "mobile warning text on cards" },
  { fg: "warning", bg: "canvas", min: 4.5, use: "mobile warning text on page" },
  { fg: "surface", bg: "warning", min: 4.5, use: "text on warning fill" },
  { fg: "warning", bg: "peach", min: 3, use: "warning icon on banner (non-text)" },
  { fg: "ink", bg: "tintGrey", min: 4.5, use: "text on grey tint" },
  { fg: "muted", bg: "tintGrey", min: 4.5, use: "secondary text on grey tint" },
  { fg: "accent", bg: "nav", min: 4.5, use: "lime on forest (primary button label, + icon)" },
  { fg: "navText", bg: "nav", min: 4.5, use: "text on forest hero card" },
  { fg: "warningOnDark", bg: "nav", min: 4.5, use: "shortfall warning on the phone's forest hero" },
  { fg: "warningOnDark", bg: "accentDeep", min: 4.5, use: "shortfall warning on the web's deep hero" },
];

/** Radii in px. Cards 20, inner blocks 14, buttons/inputs 10. */
export const radius = {
  lg: 20,
  md: 14,
  control: 10,
  logo: 9,
  full: 9999,
} as const;

export const shadow = {
  /** Modal and hover lift (web CSS value). */
  raised: "0 14px 40px rgba(29, 52, 41, 0.07)",
} as const;

export const fonts = {
  /** Headings, big numbers. */
  heading: { family: "Manrope", weights: [600, 700, 800] },
  /** Body text. */
  body: { family: "DM Sans", weights: [400, 500, 600, 700] },
} as const;

/** Font sizes in px. Minimum 12px (design-spec §3). */
export const fontSize = {
  xs: 12,
  sm: 14,
  base: 16,
  lg: 18,
  xl: 20,
  "2xl": 24,
  "3xl": 30,
  "4xl": 36,
  "5xl": 44,
} as const;

export const MIN_FONT_SIZE = 12;

/** Letter spacing in px. */
export const letterSpacing = {
  wordmark: -0.6,
  heading: -0.5,
  eyebrow: 1.4,
} as const;

/** Spacing scale in px / density-independent px. */
export const spacing = {
  0: 0,
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  10: 40,
  12: 48,
} as const;

/** Shell dimensions in px (design-spec §4–5). */
export const layout = {
  sidebarWidth: 232,
  topbarHeight: 56,
  tabBarHeight: 66,
  contentMaxWidth: 1510,
  searchWidth: 330,
  /** Mobile layout at and below this width. */
  mobileMaxWidth: 760,
  /** Desktop layout at and above this width. */
  desktopMinWidth: 1100,
} as const;

/** Logo mark geometry (design-spec §1). Rendered by web SVG and later react-native-svg. */
export const logo = {
  size: 28,
  cornerRadius: radius.logo,
  rotationDeg: -6,
  ringRadius: 7,
  ringStroke: 3,
  /** Angular size of the ring's opening, centred on the left side (180°). */
  ringGapDeg: 80,
  wordmark: { fontSize: 20, fontWeight: 700, letterSpacing: letterSpacing.wordmark },
} as const;

/**
 * SVG path for the logo's open "C" ring, in the mark's 0..size viewBox: an arc around the
 * centre with its gap centred on the left (180°). Shared by the web SVG and react-native-svg.
 */
export function logoRingPath(): string {
  const c = logo.size / 2;
  const r = logo.ringRadius;
  const half = logo.ringGapDeg / 2;
  const point = (deg: number) => {
    const rad = (deg * Math.PI) / 180;
    return `${(c + r * Math.cos(rad)).toFixed(3)} ${(c + r * Math.sin(rad)).toFixed(3)}`;
  };
  // From the upper end of the gap, clockwise the long way round to the lower end.
  return `M ${point(180 + half)} A ${r} ${r} 0 1 1 ${point(180 - half)}`;
}

/**
 * Mobile app design system (design-spec §5, approved 22 Nov 2026). React Native only; not
 * emitted to tokens.css, so web output is unchanged. Colours reuse the palette above.
 */
export const mobile = {
  colors: {
    /** Hero card, tab bar centre button, primary button. */
    forest: colors.nav,
    /** Accent, primary button label. Fill or text on forest only, never text on light. */
    lime: colors.accent,
    canvas: colors.canvas,
    surface: colors.surface,
    ink: colors.ink,
    /** Money in amounts (always with a + sign). */
    moneyIn: colors.successFill,
    warning: colors.warning,
    /** Warning tag text (Overdue) on peach: the web's negative badge colours. */
    danger: colors.danger,
    /** Warning text and icon on the forest hero. */
    warningOnForest: colors.warningOnDark,
    muted: colors.muted,
    /** Icons and placeholders only. */
    mutedSubtle: colors.mutedSubtle,
    line: colors.line,
    lineStrong: colors.lineStrong,
    onForest: colors.navText,
    onForestMuted: colors.navMuted,
    /** Bottom-sheet backdrop: forest at 45%. */
    scrim: "rgba(23, 37, 31, 0.45)",
  },
  /** Category icon-tile backgrounds. */
  categoryTints: {
    peach: colors.peach,
    mint: colors.mint,
    blue: colors.blue,
    lavender: colors.lavender,
    grey: colors.tintGrey,
  },
  /** Type scale in px: size / weight / line height. Never under MIN_FONT_SIZE. */
  type: {
    hero: { size: 44, weight: 800, lineHeight: 52 },
    screenTitle: { size: 28, weight: 800, lineHeight: 34 },
    cardTitle: { size: 18, weight: 700, lineHeight: 24 },
    body: { size: 16, weight: 400, lineHeight: 24 },
    caption: { size: 13, weight: 400, lineHeight: 18 },
    min: { size: MIN_FONT_SIZE, weight: 500, lineHeight: 16 },
  },
  radius: {
    card: 22,
    tileSm: 14,
    tile: 16,
    tileLg: 18,
    chip: 99,
  },
  /** Card layout: white, no shadow, padding 18, 16 apart. */
  card: { padding: 18, gap: 16 },
  /** Minimum tap target in px (44×44). */
  tapTarget: 44,
  tabBar: { height: layout.tabBarHeight, raisedButton: 56 },
} as const;

export type CategoryTint = keyof typeof mobile.categoryTints;
