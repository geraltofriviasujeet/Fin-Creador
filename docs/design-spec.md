# FinCreador — Design Spec (from Figma Make)

Source: Figma Make file key `41Qwiv2PRe3Q0mCbGUcIK4` ("Finance Tracker App").
Reference screenshots: `docs/design/` (desktop dashboard, desktop lower half, Add expense modal, mobile dashboard; Income page top and bottom, Add income modal, Add bank account modal).
This file is the visual source of truth for web and mobile. Financial rules stay in CLAUDE.md. Where this file and CLAUDE.md conflict on money logic, CLAUDE.md wins.

## 1. Brand

- Wordmark: `Fin` + `Creador` (the name is written "FinCreador"); on dark, `Fin` white and `Creador` lime (changed from the lowercase Figma wordmark on 2026-10-26), Manrope 700, letter-spacing -0.6px, 20px. Lime only on dark backgrounds; on light backgrounds both parts are ink. Screen readers hear "FinCreador" (visually hidden text); the styled wordmark is hidden from them. Page titles, email subjects and body text use "FinCreador".
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

- Sidebar: fixed, 248px, background nav. Items: Overview, Income, Recurring, Transactions, Goals, Investments (Goals holds planned expenses and monthly budgets, one route `/goals`). Bottom: Settings, then profile row (avatar initials, name, email, more). Active item: lime background, dark bold text.
- Topbar: sticky, 76px, white 82% with blur, bottom border. Left: search "Search transactions..." (330px). Right: bell with unread dot, dark primary "+ Add transaction" button.
- Content: max-width 1510px, padding 33px 34px.
- Welcome row: eyebrow (date, uppercase, letter-spaced), H1 "Good morning, {first name}", subtitle, period switcher Week / Month / Year (pill group).
- Summary grid (4 cards): Total balance (dark green card with mini bar sparkline), Income, Expenses, Savings rate (with progress bar). Each: icon chip, label, more menu, big number, trend badge "+x% from last month", footer.
- Dashboard grid (1.75fr / .75fr): Spending overview (area chart, y-axis labels, x-axis dates, month selector) and Monthly budget (donut with % used, spent / of total, tip box).
- Bottom grid (1.35fr / .65fr): Recent transactions (icon tile, merchant, category - date, signed amount, more menu, "View all") and Your goals (icon, name, saved of target, progress bar, % and time left, + button).
- Tablet <= 1100px: summary 2 columns, panels stack to 1 column.

## 5. Mobile web and Expo app

- <= 760px web: sidebar hidden; topbar shows logo mark + wordmark, bell, icon-only "+" button; search hidden.
- Bottom tab bar (66px): Overview, Activity (Transactions), Goals, Investments. Income is reached from an Income card on Overview (and Add income from the header +), Settings from the header.
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
| 2 | Income page (accounts live here; no separate Accounts page), Add income modal / sheet, Add bank / cash / other account, Add source (§9) |
| 3 | Add expense and transfer in the transaction modal / sheet, Transactions list, search and filters |
| 4 | Recurring items, mark received/paid |
| 5 | Dashboard: summary cards, spending chart, budget donut, recent transactions |
| 6 | Goals page: Planned expenses and Monthly budgets |
| 7 | Investments page |
| 10 | Notification and reminder settings |

Do not build later-sprint screens early. A dev-only `/dev/design` page showing the shared primitives and sample cards with demo data is allowed in Sprint 1 so the look can be reviewed.

## 9. Income page and account screens (Sprint 2)

Reference: `docs/design/Incometop.png`, `Incomebottom.png`, `Incomemodal1.png`, `Incomemodal2.png`. Layout as in the Figma; changes below are deliberate. All figures come from `packages/domain`; sample names and amounts in the screenshots are never shown as real data.

**Header.** Eyebrow "MONEY IN", H1 "Income", subtitle "See where your money comes from and where it is held." Actions: secondary "+ Add bank account", primary "+ Add income". The sidebar Income item becomes active. The topbar "+ Add transaction" opens Add income with the Expense segment shown as "Soon" until Sprint 3.

**Summary grid (3 × 2 cards, 2 columns on tablet, scroll-snap row on mobile web).**

| Card | Value | Footer |
|---|---|---|
| Income this month | non-voided income this calendar month (user's time zone) | "+x% from last month" (with sign and arrow); hidden when last month is 0 |
| Income this year | non-voided income this calendar year | "January – December {year}" |
| Bank accounts | count of active bank accounts | "{n} savings · {n} current" |
| Money in banks | sum of active bank account balances | "Across {n} bank accounts" (Figma said "linked"; we don't link banks) |
| Cash in hand | the active cash account's balance | "As of {date of latest change}" (Figma said "Updated today") |
| Rental income | rent-type sources this month | "{amount} this year"; with no rent source: ₹0 and "Add a rental source" |

**Income sources panel** ("Monthly and yearly earnings by source", link "Add source ›"). Row: icon tile (house for rent, briefcase otherwise) on mint, source name, linked account ("HDFC Bank ··4821", "Multiple accounts", or the default account), this month's amount (success colour) and "{amount} yearly" (this calendar year). Lists sources with income this year plus sources the user added. Empty: "No income recorded yet" with "Add income".

**Where your money is panel** ("Available balances"). One row per active account: name and "··last4", balance right-aligned. Row menu (keyboard reachable): Edit, Archive. Accounts in a currency other than the profile currency show their own currency and "Not in total". Footer block on accent-deep: "Total available" and the sum. "Show archived (n)" opens a list with Restore. Empty: "Add your first account" with Add bank account and Add cash buttons.

**Add income modal** (`Incomemodal1.png`, web; bottom sheet on mobile). Eyebrow "NEW TRANSACTION", title "Add income", segmented Expense (Soon) | Income. Fields: Amount (currency prefix from the chosen account), Category (income sources), Date (defaults to today in the user's time zone; no future dates), **Received into** (one account select: banks, cash, other; replaces Figma's "Received via" + "UPI bank account"), Note ("What was this for?"). Actions: Cancel, "Save income". If the date is before the account's opening-balance date, show a hint: "This counts as income, but not toward the balance (it's before the opening balance date)." Double submit is ignored.

**Add bank account modal** (`Incomemodal2.png`). Eyebrow "NEW ACCOUNT", title "Add bank account". Fields: Bank name (list of banks plus "Other bank" with a text field), Account type (Savings account / Current account), Last 4 digits (optional), **Opening balance** (replaces "Current balance"; may be negative for bank accounts) and **As of** date (defaults to today), Currency (defaults to the profile currency). Actions: Cancel, "Add account".

**Add cash.** One cash account per person, always named "Cash in hand". The first "Add cash" asks only for **Amount** (the cash held now, ≥ 0; as of today; profile currency), button "Add cash", no eyebrow. Once it exists, the button reads **"Update cash"** and opens **"Update cash in hand"**: "Now: ₹x", a "Cash you have now" amount ("This corrects the amount; it isn't counted as income"), button "Update cash in hand", and a link "Received cash as income? Add income" that opens Add income with Cash in hand pre-selected. The cash row's menu shows "Update amount".

**Add other account.** Name (e.g. "Paytm wallet"), optional provider, Opening balance (≥ 0), As of, Currency.

**Edit account** reuses the add form. Currency is locked once the account has income. **Archive** asks for confirmation: "{name} will leave your totals. Its income history stays."

**Add source.** Name, Type (Salary, Rent, Freelance, Business, Interest, Other), Default account (optional).

**Void income.** From the source's recent entries (Sprint 3 brings the full list): "Void this income?" with an optional reason. Voided entries show "Voided" and no longer count.

**States.** Every card and panel has loading (skeleton), empty, error (with retry) and success (toast) states. Text at least 12px; amounts keep their sign; AA contrast as in §3.

