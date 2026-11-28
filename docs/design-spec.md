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

- Sidebar: fixed, 232px (nav items 40px), background nav. Items: Overview, Income, Recurring, Transactions, Goals, Investments (Goals holds planned expenses and monthly budgets, one route `/goals`). Bottom: Settings, then profile row (avatar initials, name, email, more). Active item: lime background, dark bold text.
- Topbar: sticky, 56px, white 82% with blur, bottom border. Left: search "Search transactions..." (330px). Right: bell with unread dot, dark primary "+ Add transaction" button.
- Web density (owner, 2026-10-26): 14px root on web (rem sizes 12.5% below the tokens), web type scale 12/13/14/16/18/22/28/32/38px (never below 12), radii 8/12/16, controls 36px (primary 40px), cards 16–20px padding, page title 28px, section titles 18px. Mobile keeps the token sizes.
- Content: max-width 1510px, padding 33px 34px.
- Welcome row: eyebrow (date, uppercase, letter-spaced), H1 "Good morning, {first name}", subtitle, period switcher Week / Month / Year (pill group).
- Summary grid (4 cards): Total balance (dark green card with mini bar sparkline), Income, Expenses, Savings rate (with progress bar). Each: icon chip, label, more menu, big number, trend badge "+x% from last month", footer.
- Dashboard grid (1.75fr / .75fr): Spending overview (area chart, y-axis labels, x-axis dates, month selector) and Monthly budget (donut with % used, spent / of total, tip box).
- Bottom grid (1.35fr / .65fr): Recent transactions (icon tile, merchant, category - date, signed amount, more menu, "View all") and Your goals (icon, name, saved of target, progress bar, % and time left, + button).
- Tablet <= 1100px: summary 2 columns, panels stack to 1 column.

## 5. Mobile app design (approved 22 Nov 2026, open to change)

Applies to the Expo app (Android and iOS). Built as a component set in
Sprint 12c and screen by screen in Sprints 13a–13d. Reference mockups:
Claude design canvas "FinCreador Mobile App Design" (the owner has the
link).

### Navigation

- Five tabs: Home · Activity · ＋ (centre, raised forest square with a
  lime plus, opens Add) · Plan · Roma.
- Accounts, investments detail, reports and settings sit behind the
  profile avatar (top-left of Home). Bell top-right of Home.

### Home

- Greeting and date.
- Forest hero card: "Safe to spend today ₹X a day, until <next income
  date>", a spent-today bar and three figures: At start of today, Bills
  due, For goals. Bills due is the sum of the Coming up rows as shown
  (each bill rounded up to a whole rupee), so they add up.
- Quick actions: Expense / Income / Import UPI / Transfer.
- "Coming up" list (date, name, account, amount; "Overdue" for an
  unpaid bill past its date, "Missed" only for income that didn't
  arrive), with a red warning
  banner when a bill would leave an account short ("Rent on 1 Dec leaves
  you ₹1,980 short in SBI").
- "Where it went": top categories with budget bars.
- "Your money": accounts with their total.
- Ask Roma shortcut card.

### Add

- Full screen. Expense / Income / Transfer segmented control.
- Large amount; 4×2 category tiles with icons (the person's order, last used first, then
  More).
- "Paid from" row showing the balance before → after; it opens an account picker with each
  balance. A red runs-short banner when the draft would leave the account short for a bill
  before the next income (information only).
- Today and Add a note; number keypad.
- One primary button: "Save ₹<amount> expense".

### Activity

- Month chips and a date picker; Money in / Money out tiles.
- Filters: All / Spent / Received / Transfers.
- Entries grouped by day with day totals, category icon tiles and an
  "Imported" tag; swipe to edit or void.
- Search and Import UPI in the header.

### Plan

- Budgets: total left, even-spend marker, per-category bars, orange when
  over 90%.
- Goals as progress rings with "Save ₹X a month to make it" and an Ask
  Roma what-if link.
- Loans & EMIs: next EMI, Pay button, EMIs paid bar.
- Bills that repeat as chips.
- Investments summary row.

### Roma

- Header "Roma · Your Intelligent Finance Agent" with History.
- Answers lead with a one-line verdict, then a short working table, tags
  "From your records" and the period, and "Information, not financial
  advice".
- Follow-up suggestion chips; input with a send button.

### Design system

- Colours: Forest #17251F (hero, nav, primary button), Lime #B9F06B
  (accent, primary button text), Canvas #F5F7F3, Ink #18251F, Money in
  #20805A, Warning #C2412D, Muted text #5F6E66, Line #E3E9E5. Category
  tints: Peach #FEE5D9, Mint #DFF6DC, Blue #DDECF8, Lavender #E8E6FF,
  Grey #F0F3F1. Values live in `packages/design-tokens` as the `mobile`
  object (Sprint 12c); components in `apps/mobile/src/components/ds`.
- Type: Manrope for amounts and titles (hero 44/800, screen title
  28/800, card title 18/700); DM Sans body 16, captions 13, never under
  12.
- Rules: 44×44 tap targets; Indian digit grouping, whole rupees on
  summaries; money out with a minus, money in with a plus and green,
  never colour alone; one primary action per screen; cards white,
  radius 22, padding 18, 16 apart, no shadows; plain words (At start of
  today, Bills due, Safe to spend); no ads. Tab screens pad their
  bottom just clear of the raised ＋ plus 24px (the tab bar sits below
  the screen and pads itself for the safe area).
- Warnings on the forest hero (the "₹X short before {date}" line) use
  `warningOnDark` (#ffa894, AA on forest) with the warning icon, never
  lime. The "Overdue" tag is red on peach, as on the web; "Missed"
  (income only) stays blue.
- React Native components only: do not import web components. Safe
  areas, expo-font for Manrope and DM Sans, native date picker.

### Phone web (≤ 760px)

Unchanged by this section (Sprint 12a): sidebar hidden; topbar with logo
mark and wordmark, bell and an icon-only "+" button; bottom tab bar;
summary cards in a horizontal scroll-snap row; dialogs as bottom sheets.

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

> **Redesigned 2026-11-21 (web).** The summary grid, the Income sources panel and the Where your money is panel below are replaced by two sections, each a horizontal bar chart above a table (cards at ≤640px): **Accounts** (Account, Type, Number "··last4" when stored, Balance, Total row; row menu Edit / Update amount, Import statement, Archive; Total available top-right; subtotals Money in banks and Cash in hand; Add cash / Update cash, Add other account, Show archived) and **Income by source** (period switch This month / This year / All time; Source with colour dot, Note, Last received, Repeats, Amount, Total row; Add source). Header actions: "+ Add bank account" and "+ Record income". Bar colours: accounts one colour (accent-deep), "Not in total" grey; sources the six chart series colours, then grey "Other". See `docs/sprint-plan.md` decisions (2026-11-21). The text below records the Sprint 2 layout.

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

