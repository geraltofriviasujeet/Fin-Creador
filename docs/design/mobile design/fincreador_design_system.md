---
name: "FinCreador — Design System"
description: "Personal finance & wealth tracking design system for web, iOS, and Android built on deep forest-green surfaces, crisp hairline cards, and high-contrast lime accents."
---

## Overview

**FinCreador** is a calm, transparent personal finance and wealth-tracking system designed for desktop web, mobile web, and native iOS/Android apps. It replaces noisy, intimidating financial dashboards with an editorial, high-clarity **Tonal-Minimalist** aesthetic: a warm off-white canvas (`#f5f7f3`), crisp white hairline-bordered cards (`#ffffff`), a grounding deep forest-green navigation and hero surface (`#17251f` / `#263e31`), and a sharp lime highlight (`#b9f06b`) used with strict restraint for active navigation, brand mark, and key moments.

- **Brand Wordmark:** `Fin` + `Creador` (written as "FinCreador" in body copy and titles). On dark backgrounds, `Fin` is white (`#ffffff`) and `Creador` is lime (`#b9f06b`). On light backgrounds, both parts are `ink` (`#18251f`). Rendered in `Manrope` 700, `20px`, `-0.6px` letter-spacing. Screen readers receive a single `"FinCreador"` label.
- **Logo Mark:** A `28px × 28px` lime (`#b9f06b`) rounded square (`9px` radius), rotated `-6deg`, containing an open dark ring (`"C"` shape, `3px` stroke, left side open).
- **Accessibility Mandate:** Minimum text size is `12px` across all platforms. Never rely on color alone for financial direction—always pair semantic colors with explicit `+`/`-` signs and directional trend arrows (`↗` / `↘`). All interactive controls require visible keyboard focus rings (`#263e31`) and `aria-label`s on icon-only buttons.

## Colors

The palette anchors on deep forest green (`ink` / `nav` / `accent-deep`) and warm off-white (`canvas` / `surface`), punctuated by a high-visibility lime (`accent`) and soft pastel category chips (`mint`, `peach`, `lavender`, `blue`).

- **Primary & Ink:** `#18251f` (`ink` / `primary`) powers primary text and primary action buttons (`+ Add transaction`, `Save income`, `Add card`).
- **Navigation & Hero Surfaces:** `#17251f` (`nav`) grounds the desktop sidebar and toasts; `#263e31` (`accent-deep`) highlights the Total Balance hero card and focus rings.
- **Accent:** `#b9f06b` (`accent`) is reserved for the active sidebar item (paired with dark `ink` text), the rotated logo mark, and key positive highlights.
- **Category & Status Tints:** Soft pastel containers (`mint` for income/positive, `peach` for expenses/validation alerts, `lavender` for savings, `blue` for goals/holdings) paired with accessible dark foregrounds (`success` `#20805a`, `danger` `#b95d4a`, `chart` `#5b59df`).

```yaml
colors:
  ink: "#18251f"
  muted: "#53625a"
  line: "#e3e9e5"
  canvas: "#f5f7f3"
  surface: "#ffffff"
  on-surface: "#18251f"
  surface-container-low: "#f9fdf8"
  surface-container: "#f5f7f3"
  surface-container-high: "#edf2ed"
  nav: "#17251f"
  on-nav: "#ffffff"
  primary: "#18251f"
  on-primary: "#ffffff"
  secondary: "#263e31"
  on-secondary: "#ffffff"
  accent: "#b9f06b"
  on-accent: "#18251f"
  accent-deep: "#263e31"
  on-accent-deep: "#ffffff"
  mint: "#dff6dc"
  on-mint: "#18251f"
  peach: "#fee5d9"
  on-peach: "#7b2e1f"
  lavender: "#e8e6ff"
  on-lavender: "#18251f"
  blue: "#ddecf8"
  on-blue: "#18251f"
  chart: "#5b59df"
  on-chart: "#ffffff"
  success: "#20805a"
  on-success: "#ffffff"
  danger: "#b95d4a"
  on-danger: "#080808"
  outline: "#53625a"
  outline-variant: "#e3e9e5"
```

## Typography

FinCreador pairs **Manrope** (weights `600`, `700`) for headings, page titles, and large monetary figures with **DM Sans** (weights `400`, `500`, `600`, `700`) for body copy, form controls, navigation, and table data.

- **Tabular Figures:** All currency amounts, percentages, account numbers (`··4821`), and table metrics use `tabular-nums` (`fontFeature: '"tnum" 1'`) so columns align vertically.
- **Scale & Density:** Mobile keeps full token sizes (`14px` body, `12px` minimum label). Desktop web applies a tighter `14px` root scale (`28px` page titles, `18px` section headings, `12px`–`14px` UI copy) and never drops below `12px`.

```yaml
typography:
  display-lg:
    fontFamily: "Manrope"
    fontSize: 38px
    fontWeight: 700
    lineHeight: 44px
    letterSpacing: -0.8px
    fontFeature: '"tnum" 1'
  display-lg-mobile:
    fontFamily: "Manrope"
    fontSize: 30px
    fontWeight: 700
    lineHeight: 36px
    letterSpacing: -0.6px
    fontFeature: '"tnum" 1'
  headline-lg:
    fontFamily: "Manrope"
    fontSize: 28px
    fontWeight: 700
    lineHeight: 34px
    letterSpacing: -0.5px
    fontFeature: '"tnum" 1'
  headline-md:
    fontFamily: "Manrope"
    fontSize: 22px
    fontWeight: 700
    lineHeight: 28px
    letterSpacing: -0.3px
    fontFeature: '"tnum" 1'
  title-lg:
    fontFamily: "Manrope"
    fontSize: 18px
    fontWeight: 700
    lineHeight: 24px
    letterSpacing: -0.2px
  title-md:
    fontFamily: "DM Sans"
    fontSize: 16px
    fontWeight: 600
    lineHeight: 22px
  body-lg:
    fontFamily: "DM Sans"
    fontSize: 15px
    fontWeight: 400
    lineHeight: 22px
  body-md:
    fontFamily: "DM Sans"
    fontSize: 14px
    fontWeight: 400
    lineHeight: 20px
  label-lg:
    fontFamily: "DM Sans"
    fontSize: 14px
    fontWeight: 600
    lineHeight: 20px
  label-md:
    fontFamily: "DM Sans"
    fontSize: 13px
    fontWeight: 500
    lineHeight: 18px
  label-sm:
    fontFamily: "DM Sans"
    fontSize: 12px
    fontWeight: 600
    lineHeight: 16px
    letterSpacing: 0.4px
```

## Layout & Spacing

A disciplined `4px` / `8px` spacing scale governs both desktop web and native/mobile-web layouts:

- **Desktop (`>= 1100px`):** Fixed `232px` dark sidebar (`nav`), sticky `56px` translucent topbar (`rgba(255,255,255,0.82)` with backdrop blur and `1px` bottom border), and a `1510px` max-width content container with `32px` padding. Summary KPI grids use `4` columns; primary analytical panels use `1.75fr / 0.75fr` or `1.35fr / 0.65fr` asymmetric splits.
- **Tablet (`761px – 1099px`):** Summary grids collapse to `2` columns; analytical and list panels stack to `1` column.
- **Mobile (`<= 760px` & iOS/Android):** Sidebar is replaced by a `56px` compact topbar (logo mark + wordmark, notification bell, settings gear, dark `+` icon button) and a `66px` bottom tab bar (`Overview`, `Activity`, `Goals`, `Investments`, plus `More` popover for `Income`, `Recurring`, `Loans & Liabilities`, `Reports`). Summary cards become a horizontal scroll-snap row (`min-width: 245px`) or full-width stacked cards with `16px`–`20px` padding. Centered modals become native bottom sheets.

```yaml
spacing:
  xs: 4px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 20px
  2xl: 24px
  3xl: 32px
```

## Elevation & Depth

FinCreador relies on **Low-Contrast Outlines** and **Tonal Contrast** rather than heavy drop shadows:

- **Cards & Panels:** Flat `#ffffff` surfaces separated from the `#f5f7f3` canvas by `1px solid #e3e9e5` hairline borders.
- **Hero & Navigation Contrast:** High-contrast dark forest-green blocks (`#17251f` sidebar, `#263e31` Total Balance card) establish immediate hierarchy without elevation shadows.
- **Floating Surfaces:** Modals, bottom sheets, dropdown menus, and interactive hover lifts use a soft, tinted ambient shadow: `0 14px 40px rgba(29, 52, 41, 0.07)`.

## Shapes

Corners are friendly and structured, scaling proportionally with container size:

- **Inputs, Buttons & Segmented Controls:** `10px` (`DEFAULT`) on mobile/standard density (`8px` `sm` in compact web density).
- **Inner Blocks, Icon Tiles & Alert Banners:** `14px` (`md`).
- **Cards, Modals & Bottom Sheets:** `20px` (`lg`).
- **Period Switchers, Status Badges & Avatars:** `9999px` (`full`).

```yaml
rounded:
  sm: 8px
  DEFAULT: 10px
  md: 14px
  lg: 20px
  full: 9999px
```

## Motion & Micro-interaction

Motion is crisp, purposeful, and understated. Interactive state changes land immediately; modals and mobile bottom sheets decelerate smoothly into place. All animations honor `prefers-reduced-motion` and animate only `transform` and `opacity`.

```yaml
motion:
  state-change:
    duration: 120ms
    delay: 0ms
    timingFunction: ease-out
  surface-enter:
    duration: 220ms
    delay: 0ms
    timingFunction: cubic-bezier(0.2, 0, 0, 1)
  surface-exit:
    duration: 150ms
    delay: 0ms
    timingFunction: cubic-bezier(0.3, 0, 1, 1)
```

## Voice & Content Strategy

- **Tone:** Calm, direct, and grounded in the user's actual records. Avoid financial jargon, hype, or judgment.
- **Capitalisation & Labels:** Sentence case for all headings, navigation items, and buttons (`"Add bank account"`, `"Record income"`, `"Nothing recorded yet"`). Uppercase `label-sm` (`12px`, tracked) is reserved strictly for section eyebrows (`"MONEY IN"`, `"TRACK"`, `"OWE"`) and date headers (`"MONDAY, 26 OCTOBER"`).
- **Action Grammar:** Verb + object naming the outcome (`"Save income"`, `"Add card"`, `"Go to Income"`, `"Open Recurring"`).
- **States & Formatting:** Every view provides loading skeletons, helpful empty states with a primary next action, and inline validation errors (such as `"Please fix the highlighted fields."`). Currency values use `Intl` locale formatting (`en-IN` grouping for `₹`, e.g., `₹4,20,090.00`) and always include explicit `+` or `-` signs on income/expense deltas.

## Components

Component implementations live as individual HTML sticker sheet files in
`components/`. Each file contains the canonical, styled HTML components with
`<!-- COMPONENT: name -->` comment markers. Read each file before use.

- **Button** → `@components/button.html`: `button-primary`, `button-icon`, `button-with-icon`
- **Card** → `@components/card.html`: `card-elevated`, `card-action`, `card-interactive`, `card-interactive-2`
- **Input Field** → `@components/input-field.html`: `input-field-text`, `input-field-icon`
- **Tabs** → `@components/tabs.html`: `tabs-horizontal`, `tabs-with-icon`
- **Typography** → `@components/typography.html`: `typography-display`, `typography-body`, `typography-label`
