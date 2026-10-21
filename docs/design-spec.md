# Fin Creador — Design Spec (from Figma Make)

Source: Figma Make file key `41Qwiv2PRe3Q0mCbGUcIK4` ("Finance Tracker App").
Reference screenshots: `docs/design/` (desktop dashboard, desktop lower half, Add expense modal, mobile dashboard).
This file is the visual source of truth for web and mobile. Financial rules stay in CLAUDE.md. Where this file and CLAUDE.md conflict on money logic, CLAUDE.md wins.

## 1. Brand

- Wordmark: `fin` in white + `creador` in lime, Manrope 700, letter-spacing -0.6px, 20px.
- Logo mark: 28px lime rounded square (radius 9px), rotated -6deg, containing a dark open ring ("C" shape, 3px stroke, left side open).
- Palette direction: dark forest green + lime accent. This REPLACES the "emerald" accent in CLAUDE.md section 3 (update CLAUDE.md).

## 2. Design tokens

| Token | Value | Use |
|---|---|---|
| ink | #18251f | primary text, primary buttons |
| muted | #718078 | secondary text |
| line | #e3e9e5 | borders, dividers |
| canvas | #f5f7f3 | page background |
| surface | #ffffff | cards, modals |
| nav | #17251f | sidebar, toast |
| accent | #b9f06b | active nav, logo, highlights |
| accent-deep | #263e31 | balance card, donut fill |
| mint | #dff6dc | income chip, positive badge |
| peach | #fee5d9 | expense chip, negative badge |
| lavender | #e8e6ff | savings chip |
| blue | #ddecf8 | housing / goal chip |
| chart (purple) | #5b59df | spending chart line, savings progress |
| success | #20805a | positive amounts |
| danger | #b95d4a | negative trend |
| radius-lg / md | 20px / 14px | cards / inner blocks; buttons and inputs 10px |
| shadow | 0 14px 40px rgba(29,52,41,.07) | modal, hover |

Fonts: Manrope 600/700 (headings, big numbers), DM Sans 400/500/600/700 (body).
Put these in `packages/design-tokens` (single source) and map them into Tailwind theme / shadcn CSS variables on web and a tokens object on mobile. Do not duplicate values by hand.

## 3. Accessibility changes versus the Figma code

- Minimum text size 12px (Figma uses 8-10px in many labels). Body 14px, labels 12px.
- Visible keyboard focus ring on all interactive elements (accent-deep ring).
- Do not rely on color alone: keep +/- signs and arrows on amounts and trends.
- Respect prefers-reduced-motion (fade/slide animations, hover lift).
- Icon-only buttons need aria-labels.

## 4. Web layout (desktop >= 1100px)

- Sidebar: fixed, 248px, background nav. Items: Overview, Income, Transactions, Budgets, Investments, Goals. Bottom: Settings, then profile row (avatar initials, name, email, more). Active item: lime background, dark bold text.
- Topbar: sticky, 76px, white 82% with blur, bottom border. Left: search "Search transactions..." (330px). Right: bell with unread dot, dark primary "+ Add transaction" button.
- Content: max-width 1510px, padding 33px 34px.
- Welcome row: eyebrow (date, uppercase, letter-spaced), H1 "Good morning, {first name}", subtitle, period switcher Week / Month / Year (pill group).
- Summary grid (4 cards): Total balance (dark green card with mini bar sparkline), Income, Expenses, Savings rate (with progress bar). Each: icon chip, label, more menu, big number, trend badge "+x% from last month", footer.
- Dashboard grid (1.75fr / .75fr): Spending overview (area chart, y-axis labels, x-axis dates, month selector) and Monthly budget (donut with % used, spent / of total, tip box).
- Bottom grid (1.35fr / .65fr): Recent transactions (icon tile, merchant, category - date, signed amount, more menu, "View all") and Your goals (icon, name, saved of target, progress bar, % and time left, + button).
- Tablet <= 1100px: summary 2 columns, panels stack to 1 column.

## 5. Mobile web and Expo app

- <= 760px web: sidebar hidden; topbar shows logo mark + wordmark, bell, icon-only "+" button; search hidden.
- Bottom tab bar (66px): Overview, Activity (Transactions), Budgets, Investments, Goals. Income is reached from Overview / Activity filter, Settings from profile.
- Summary cards become a horizontal scroll-snap row (min-width 245px). Panels full width, 17px padding.
- Expo app mirrors this with React Native components: bottom tabs, safe areas, same tokens, expo-font for Manrope and DM Sans. Do not import web components. Use native date picker and bottom sheet instead of a centered modal for Add transaction.

## 6. Add transaction modal (web) / bottom sheet (mobile)

Eyebrow "NEW TRANSACTION", title "Add expense" / "Add income", close button. Segmented toggle Expense | Income. Fields: Amount (large, rupee prefix), Category + Date (two columns), Payment mode (UPI, Cash, Debit card, Credit card, Bank transfer) + Account (hidden for Cash), Note. Actions: Cancel, "Save expense/income". Success toast with lime check.
Account list and categories come from the database, never hard-coded.
Income categories in Figma: Salary, Freelance, Rental income, Interest, Other income.

## 7. Data rules for the port

- The Figma file contains sample data (Ananya Kapoor, August 2025 amounts). Never ship it as real data.
- Every screen needs loading, empty, error and success states. Empty first-run states replace the sample figures.
- Demo data only in a dev-only route or seed environment, clearly labeled "Demo data".
- Money shown with Intl formatting from the user's currency and locale (en-IN grouping for INR).
- Total Balance and all metrics follow CLAUDE.md section 5, calculated in packages/domain, not in components.

## 8. Which sprint builds what

| Sprint | Design work |
|---|---|
| 1 | Tokens, fonts, logo, app shell (sidebar, topbar, mobile tab bar), auth screens, profile and Settings, shared primitives (Button, Input, Card, Badge, Toast) |
| 2 | Accounts screens |
| 3 | Add transaction modal / sheet, Transactions list, search and filters |
| 4 | Income page |
| 5 | Dashboard: summary cards, spending chart, budget donut, recent transactions |
| 6 | Budgets and Goals pages |
| 7 | Investments page |
| 10 | Notification and reminder settings |

Do not build later-sprint screens early. A dev-only `/dev/design` page showing the shared primitives and sample cards with demo data is allowed in Sprint 1 so the look can be reviewed.
