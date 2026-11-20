// The onboarding carousel's pictures (owner feedback 2026-11-20): one 3D-style scene per slide,
// drawn in HTML and CSS from the brand tokens, with made-up figures for a demo person ("Ravi").
// Never a real account, name, email or bank. Each scene mirrors the app screen the slide is about
// (Overview, accounts, Add expense and UPI import, Investments, a loan, a goal, Roma) as a tilted
// slab with a few floating props. scripts/capture-onboarding.ts renders them to WebP.
//
// Two layouts per scene: desktop (600 × 375 CSS px, saved at 2× as 1200 × 750) and phone
// (390 × 390, saved at 2× as 780 × 780). Props marked .d-only are left out on phones.

export type Variant = "desktop" | "phone"

export const SIZES: Record<Variant, { width: number; height: number }> = {
  desktop: { width: 600, height: 375 },
  phone: { width: 390, height: 390 },
}

export type Scene = { slug: string; body: string; css?: string }

const BASE_CSS = String.raw`
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { width: var(--w); height: var(--h); overflow: hidden; }
body {
  font-family: "DM Sans Variable", sans-serif; color: var(--fc-color-ink);
  -webkit-font-smoothing: antialiased; font-size: 10px;
}
h1, h2, h3, .num { font-family: "Manrope Variable", sans-serif; letter-spacing: -0.3px; }
.stage {
  position: relative; width: 100%; height: 100%; overflow: hidden; perspective: 1300px;
  background:
    radial-gradient(60% 70% at 12% 8%, rgba(185, 240, 107, 0.30), transparent 70%),
    radial-gradient(55% 65% at 92% 95%, rgba(232, 230, 255, 0.95), transparent 70%),
    radial-gradient(40% 50% at 95% 10%, rgba(221, 236, 248, 0.9), transparent 70%),
    var(--fc-color-canvas);
}
/* Soft contact shadow on the "floor" under the hero. */
.floor {
  position: absolute; left: 50%; top: 62%; width: 70%; height: 30%;
  transform: translate(-50%, 0); border-radius: 50%;
  background: radial-gradient(closest-side, rgba(24, 37, 31, 0.22), transparent);
  filter: blur(8px);
}
.world {
  position: absolute; inset: 0; transform-style: preserve-3d;
  transform: rotateX(20deg) rotateY(-16deg) rotateZ(5deg);
}
body.phone .world { transform: rotateX(18deg) rotateY(-12deg) rotateZ(4deg); }
.abs { position: absolute; transform-style: preserve-3d; }
/* A slab: white face, a stacked-shadow edge for thickness, a long soft shadow. */
.slab {
  background: var(--fc-color-surface); border-radius: 16px;
  box-shadow:
    0 1px 0 #f0f4f1, 0 2px 0 #e3e9e5, 0 3px 0 #dbe2dd, 0 4px 0 #d2dad5, 0 5px 0 #c9d2cc, 0 6px 0 #c2cbc5,
    0 28px 50px rgba(24, 37, 31, 0.20), 0 8px 16px rgba(24, 37, 31, 0.10);
}
.slab.dark {
  background: linear-gradient(160deg, #23382d, var(--fc-color-nav) 60%); color: #fff;
  box-shadow:
    0 1px 0 #101a15, 0 2px 0 #0e1813, 0 3px 0 #0c1511, 0 4px 0 #0b130f, 0 5px 0 #09110d,
    0 28px 50px rgba(24, 37, 31, 0.30), 0 8px 16px rgba(24, 37, 31, 0.15);
}
.slab.lime {
  background: linear-gradient(160deg, #cdf68f, var(--fc-color-accent) 60%);
  box-shadow:
    0 1px 0 #a6dc5c, 0 2px 0 #9dd353, 0 3px 0 #93c94b, 0 4px 0 #89bf43, 0 5px 0 #80b53c,
    0 24px 40px rgba(24, 37, 31, 0.20);
}
.pad { padding: 14px; }
.muted { color: var(--fc-color-muted); }
.eyebrow { font-size: 8px; font-weight: 600; letter-spacing: 1px; text-transform: uppercase; color: var(--fc-color-muted); }
.dark .eyebrow, .dark .muted { color: var(--fc-color-nav-muted); }
.num { font-weight: 700; }
.row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.chip { display: inline-flex; align-items: center; gap: 4px; border-radius: 999px; padding: 3px 8px; font-size: 8.5px; font-weight: 600; }
.mint { background: var(--fc-color-mint); } .peach { background: var(--fc-color-peach); }
.lav { background: var(--fc-color-lavender); } .blue { background: var(--fc-color-blue); }
.limebg { background: var(--fc-color-accent); }
.bar { height: 6px; border-radius: 99px; background: var(--fc-color-line); overflow: hidden; }
.bar > i { display: block; height: 100%; border-radius: 99px; background: var(--fc-color-accent-deep); }
.icon { width: 22px; height: 22px; border-radius: 7px; display: grid; place-items: center; font-size: 11px; font-weight: 700; flex: none; }
/* A 3D coin: lime face with a darker rim below. */
.coin {
  width: 46px; height: 46px; border-radius: 50%;
  background: radial-gradient(circle at 35% 30%, #e6ffbf, var(--fc-color-accent) 45%, #9ed456);
  box-shadow: 0 2px 0 #8cc447, 0 4px 0 #7fb63d, 0 6px 0 #72a834, 0 16px 22px rgba(24, 37, 31, 0.25);
  display: grid; place-items: center; font: 800 18px "Manrope Variable"; color: var(--fc-color-accent-deep);
}
.coin::after { content: ""; position: absolute; inset: 6px; border-radius: 50%; border: 1.5px solid rgba(38, 62, 49, 0.25); }
.coin { position: relative; }
.stack .coin { position: absolute; left: 0; }
/* A glossy sphere (Roma, goal markers). */
.orb {
  border-radius: 50%;
  background: radial-gradient(circle at 32% 28%, #ffffff 0, #e7ffc4 12%, var(--fc-color-accent) 45%, #5f9a2f 100%);
  box-shadow: 0 18px 30px rgba(24, 37, 31, 0.28), inset -6px -8px 16px rgba(38, 62, 49, 0.35);
}
.lift { transform: translateZ(40px); }
.lift2 { transform: translateZ(80px); }
body.phone .d-only { display: none; }
`

function page(scene: Scene, variant: Variant, fontCss: string, tokensCss: string): string {
  const { width, height } = SIZES[variant]
  return `<!doctype html><html><head><meta charset="utf-8"><style>${fontCss}${tokensCss}
:root { --w: ${width}px; --h: ${height}px; }${BASE_CSS}${scene.css ?? ""}</style></head>
<body class="${variant}"><div class="stage"><div class="floor"></div><div class="world">${scene.body}</div></div></body></html>`
}

export function sceneHtml(scene: Scene, variant: Variant, fontCss: string, tokensCss: string): string {
  return page(scene, variant, fontCss, tokensCss)
}

// ---------------------------------------------------------------------------
// 1. Welcome: the Overview, with accounts, UPI, investments, a loan and a goal around it
// ---------------------------------------------------------------------------
const welcome: Scene = {
  slug: "welcome",
  css: String.raw`
.ov { left: 150px; top: 58px; width: 300px; }
body.phone .ov { left: 48px; top: 70px; width: 290px; }
.tiles { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 10px; }
.tile { border-radius: 10px; padding: 8px; }
.bars { display: flex; align-items: flex-end; gap: 5px; height: 46px; margin-top: 10px; }
.bars i { flex: 1; border-radius: 4px 4px 2px 2px; background: var(--fc-color-mint); }
.bars i.on { background: var(--fc-color-accent-deep); }
.p-bank { left: 40px; top: 40px; width: 128px; transform: translateZ(70px) rotateZ(-6deg); }
.p-upi { left: 455px; top: 50px; width: 108px; transform: translateZ(90px) rotateZ(5deg); }
.p-goal { left: 452px; top: 205px; width: 116px; transform: translateZ(60px); }
.p-loan { left: 30px; top: 215px; width: 128px; transform: translateZ(50px) rotateZ(4deg); }
.p-coins { left: 505px; top: 330px; transform: translateZ(100px); }
body.phone .p-upi { left: 262px; top: 36px; transform: translateZ(90px) rotateZ(5deg); }
`,
  body: String.raw`
<div class="abs slab pad ov">
  <div class="row"><div><div class="eyebrow">Overview · November</div><h2 style="font-size:13px;margin-top:3px">Good evening, Ravi</h2></div><span class="chip mint">This month</span></div>
  <div class="slab dark pad" style="margin-top:10px;border-radius:12px;padding:11px">
    <div class="eyebrow">Money left</div>
    <div class="num" style="font-size:22px;margin-top:2px">₹38,420</div>
    <div class="bar" style="margin-top:7px;background:rgba(255,255,255,.15)"><i style="width:62%;background:var(--fc-color-accent)"></i></div>
  </div>
  <div class="tiles">
    <div class="tile mint"><div class="eyebrow">Came in</div><div class="num" style="font-size:13px">₹92,000</div></div>
    <div class="tile peach"><div class="eyebrow">Went out</div><div class="num" style="font-size:13px">₹53,580</div></div>
  </div>
  <div class="bars"><i style="height:40%"></i><i style="height:65%"></i><i style="height:52%"></i><i style="height:80%"></i><i style="height:58%"></i><i class="on" style="height:72%"></i></div>
</div>
<div class="abs slab pad p-bank d-only"><div class="row"><span class="icon blue">₹</span><span class="chip mint">Bank</span></div><div class="muted" style="margin-top:8px;font-size:8.5px">Savings ··4821</div><div class="num" style="font-size:14px">₹52,300</div></div>
<div class="abs slab lime pad p-upi"><div class="eyebrow" style="color:var(--fc-color-accent-deep)">UPI</div><div class="num" style="font-size:12px;margin-top:3px">48 payments</div><div style="font-size:8.5px;margin-top:2px">categories suggested</div></div>
<div class="abs slab pad p-goal d-only"><div class="eyebrow">Goal</div><div style="font-weight:700;font-size:10px;margin-top:3px">Goa trip</div><div class="bar" style="margin-top:6px"><i style="width:58%"></i></div><div class="muted" style="font-size:8px;margin-top:4px">₹34,800 of ₹60,000</div></div>
<div class="abs slab pad p-loan d-only"><div class="eyebrow">Next EMI</div><div class="num" style="font-size:13px;margin-top:3px">₹21,450</div><div class="muted" style="font-size:8px">Home loan · 5 Dec</div></div>
<div class="abs stack p-coins d-only"><div class="coin" style="top:0">₹</div><div class="coin" style="top:-9px;left:6px">₹</div><div class="coin" style="top:-18px;left:2px">₹</div></div>
`,
}

// ---------------------------------------------------------------------------
// 2. Accounts: bank and cash cards stacked, Total available
// ---------------------------------------------------------------------------
const accounts: Scene = {
  slug: "accounts",
  css: String.raw`
.card3 { width: 210px; height: 122px; border-radius: 16px; padding: 12px 14px; display: flex; flex-direction: column; justify-content: flex-end; gap: 2px; }
.c1 { left: 120px; top: 150px; transform: translateZ(0px) rotateZ(-4deg); }
.c2 { left: 150px; top: 100px; transform: translateZ(45px) rotateZ(-2deg); }
.c3 { left: 180px; top: 50px; transform: translateZ(90px); }
.total { left: 392px; top: 96px; width: 170px; transform: translateZ(60px); }
.plus { left: 412px; top: 238px; width: 52px; height: 52px; border-radius: 16px; display: grid; place-items: center; font: 800 26px "Manrope Variable"; color: var(--fc-color-accent-deep); transform: translateZ(110px); }
.chipline { width: 28px; height: 20px; border-radius: 5px; background: linear-gradient(135deg, #f3e7b0, #d8c47a); }
body.phone .c1 { left: 24px; top: 190px; } body.phone .c2 { left: 54px; top: 140px; } body.phone .c3 { left: 84px; top: 90px; }
body.phone .total { left: 200px; top: 250px; width: 160px; transform: translateZ(130px); }
body.phone .plus { display: none; }
`,
  body: String.raw`
<div class="abs slab card3 c1" style="background:linear-gradient(150deg,#fee5d9,#f8cfbc)"><div class="row"><span style="font-weight:700;font-size:10px">Cash in hand</span><span class="icon" style="background:#fff">₹</span></div><div><div class="num" style="font-size:18px">₹3,200</div></div></div>
<div class="abs slab card3 c2" style="background:linear-gradient(150deg,#e8e6ff,#d3d0fb)"><div class="row"><span style="font-weight:700;font-size:10px">Salary account</span><span class="chipline"></span></div><div><div class="muted" style="font-size:8.5px">··1907</div><div class="num" style="font-size:18px">₹16,450</div></div></div>
<div class="abs slab dark card3 c3"><div class="row"><span style="font-weight:700;font-size:10px">Savings account</span><span class="chipline"></span></div><div><div class="muted" style="font-size:8.5px">··4821 · today's balance</div><div class="num" style="font-size:20px">₹52,300</div></div></div>
<div class="abs slab pad total"><div class="eyebrow">Total available</div><div class="num" style="font-size:20px;margin-top:3px">₹71,950</div><div class="bar" style="margin-top:8px;display:flex"><i style="width:73%"></i><i style="width:22%;background:#a9a4f5"></i><i style="width:5%;background:#f0a88a"></i></div><div class="muted" style="font-size:8px;margin-top:6px">3 accounts · kept up to date</div></div>
<div class="abs slab lime plus">+</div>
`,
}

// ---------------------------------------------------------------------------
// 3. Track: the Add expense sheet, and a UPI statement turned into categorised rows
// ---------------------------------------------------------------------------
const track: Scene = {
  slug: "track",
  css: String.raw`
.phoneframe { left: 70px; top: 30px; width: 170px; height: 300px; border-radius: 26px; padding: 8px; transform: rotateZ(-4deg); }
.screen { color: var(--fc-color-ink); background: var(--fc-color-canvas); border-radius: 19px; height: 100%; padding: 12px 10px; display: flex; flex-direction: column; gap: 8px; }
.amt { font: 800 26px "Manrope Variable"; text-align: center; margin: 6px 0 2px; }
.cats { display: flex; flex-wrap: wrap; gap: 4px; justify-content: center; }
.screen .muted { color: var(--fc-color-muted); }
.save { margin-top: auto; background: var(--fc-color-ink); color: #fff; border-radius: 9px; text-align: center; font-weight: 700; font-size: 10px; padding: 8px; }
.doc { left: 300px; top: 52px; width: 220px; transform: translateZ(40px) rotateZ(3deg); }
.line { display: flex; align-items: center; gap: 6px; padding: 5px 0; border-bottom: 1px solid var(--fc-color-line); font-size: 8.5px; }
.line:last-child { border-bottom: 0; }
.line b { margin-left: auto; font-family: "Manrope Variable"; }
.lock { left: 440px; top: 252px; transform: translateZ(100px); padding: 8px 10px; border-radius: 12px; font-size: 8.5px; font-weight: 700; display: flex; gap: 6px; align-items: center; }
body.phone .phoneframe { left: 14px; top: 46px; width: 150px; height: 270px; }
body.phone .doc { left: 150px; top: 150px; width: 220px; transform: translateZ(80px) rotateZ(3deg); }
body.phone .lock { left: 40px; top: 330px; }
`,
  body: String.raw`
<div class="abs slab dark phoneframe"><div class="screen">
  <div class="row"><span style="font-weight:700;font-size:11px">Add expense</span><span class="muted" style="font-size:9px">Today</span></div>
  <div class="amt">₹250</div>
  <div class="muted" style="text-align:center;font-size:8.5px">From Savings ··4821</div>
  <div class="cats"><span class="chip limebg">Groceries</span><span class="chip mint">Food</span><span class="chip blue">Travel</span><span class="chip peach">Bills</span><span class="chip lav">Shopping</span></div>
  <div class="slab" style="border-radius:9px;padding:7px;font-size:8.5px;box-shadow:none;border:1px solid var(--fc-color-line)">Note: vegetables</div>
  <div class="save">Save expense</div>
</div></div>
<div class="abs slab pad doc">
  <div class="row"><div><div class="eyebrow">UPI statement · review</div><div style="font-weight:700;font-size:10.5px;margin-top:3px">12 payments found</div></div><span class="icon lav">↓</span></div>
  <div style="margin-top:8px">
    <div class="line"><span class="chip mint">Food</span>Lunch order<b>₹420</b></div>
    <div class="line"><span class="chip blue">Travel</span>Metro card<b>₹300</b></div>
    <div class="line"><span class="chip peach">Bills</span>Electricity<b>₹1,860</b></div>
    <div class="line"><span class="chip limebg">Groceries</span>Kirana store<b>₹640</b></div>
  </div>
</div>
<div class="abs slab lock"><span class="icon mint" style="width:18px;height:18px">✓</span>File stays on this device</div>
`,
}

// ---------------------------------------------------------------------------
// 4. Investments: the list and its total, with rising columns
// ---------------------------------------------------------------------------
const investments: Scene = {
  slug: "investments",
  css: String.raw`
.list { left: 70px; top: 50px; width: 270px; }
.hold { display: flex; align-items: center; gap: 8px; padding: 7px 0; border-bottom: 1px solid var(--fc-color-line); font-size: 9px; }
.hold:last-child { border-bottom: 0; }
.hold .v { margin-left: auto; text-align: right; font-family: "Manrope Variable"; font-weight: 700; }
.up { color: var(--fc-color-success); font-size: 8px; font-weight: 700; }
.cols { left: 380px; top: 110px; width: 170px; height: 170px; transform: translateZ(50px); }
.col { position: absolute; bottom: 0; width: 34px; border-radius: 8px 8px 4px 4px; box-shadow: 6px 0 0 rgba(24, 37, 31, 0.12), 0 16px 24px rgba(24, 37, 31, 0.18); }
.worth { left: 360px; top: 36px; width: 170px; transform: translateZ(100px); }
body.phone .list { left: 16px; top: 130px; width: 236px; }
body.phone .cols { left: 262px; top: 205px; width: 170px; height: 170px; transform: translateZ(60px) scale(.62); transform-origin: 0 100%; }
body.phone .worth { left: 150px; top: 46px; }
`,
  body: String.raw`
<div class="abs slab pad list">
  <div class="row"><h2 style="font-size:12px">Investments</h2><span class="chip mint">Last close</span></div>
  <div style="margin-top:6px">
    <div class="hold"><span class="icon lav">MF</span><div><div style="font-weight:700">Nifty 50 index fund</div><div class="muted">Mutual fund</div></div><div class="v">₹1,86,400<div class="up">+12.4%</div></div></div>
    <div class="hold"><span class="icon blue">SH</span><div><div style="font-weight:700">Large-cap shares</div><div class="muted">40 shares</div></div><div class="v">₹1,12,750<div class="up">+8.1%</div></div></div>
    <div class="hold"><span class="icon peach">ETF</span><div><div style="font-weight:700">Gold ETF</div><div class="muted">ETF</div></div><div class="v">₹33,000<div class="up">+5.6%</div></div></div>
    <div class="hold"><span class="icon mint">FD</span><div><div style="font-weight:700">Fixed deposit</div><div class="muted">7.1% · worth today</div></div><div class="v">₹1,50,000</div></div>
  </div>
</div>
<div class="abs cols">
  <div class="col" style="left:0;height:38%;background:linear-gradient(#dff6dc,#bfe8b9)"></div>
  <div class="col" style="left:44px;height:56%;background:linear-gradient(#e8e6ff,#c8c4f8)"></div>
  <div class="col" style="left:88px;height:74%;background:linear-gradient(#ddecf8,#b7d4ee)"></div>
  <div class="col" style="left:132px;height:96%;background:linear-gradient(#cdf68f,#9ed456)"></div>
</div>
<div class="abs slab dark pad worth"><div class="eyebrow">Worth together</div><div class="num" style="font-size:19px;margin-top:3px">₹4,82,150</div><div style="font-size:8.5px;color:var(--fc-color-accent);margin-top:2px;font-weight:700">+₹41,300 overall</div></div>
`,
}

// ---------------------------------------------------------------------------
// 5. Loans: a home loan with what's owed and the next EMI on a calendar block
// ---------------------------------------------------------------------------
const loans: Scene = {
  slug: "loans",
  css: String.raw`
.loan { left: 90px; top: 50px; width: 280px; }
.kv { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 10px; }
.kv > div { border-radius: 10px; padding: 8px; background: var(--fc-color-canvas); }
.cal { left: 400px; top: 70px; width: 118px; transform: translateZ(90px) rotateZ(6deg); overflow: hidden; padding: 0; }
.cal .top { background: var(--fc-color-accent-deep); color: #fff; text-align: center; font-weight: 700; font-size: 10px; padding: 6px; border-radius: 16px 16px 0 0; }
.cal .day { font: 800 40px "Manrope Variable"; text-align: center; padding: 6px 0 0; }
.others { left: 395px; top: 230px; width: 150px; transform: translateZ(50px); }
body.phone .loan { left: 22px; top: 130px; width: 262px; }
body.phone .cal { left: 250px; top: 50px; width: 108px; }
body.phone .others { display: none; }
`,
  body: String.raw`
<div class="abs slab pad loan">
  <div class="row"><div><div class="eyebrow">Loans &amp; Liabilities</div><h2 style="font-size:13px;margin-top:3px">Home loan</h2></div><span class="icon blue">⌂</span></div>
  <div class="eyebrow" style="margin-top:12px">Still owed</div>
  <div class="num" style="font-size:22px">₹18,40,000</div>
  <div class="bar" style="margin-top:7px;height:8px"><i style="width:38%;background:var(--fc-color-accent-deep)"></i></div>
  <div class="muted" style="font-size:8px;margin-top:4px">38% repaid · 96 EMIs left</div>
  <div class="kv">
    <div><div class="eyebrow">EMI</div><div class="num" style="font-size:12px">₹21,450</div></div>
    <div><div class="eyebrow">Rate</div><div class="num" style="font-size:12px">8.4% floating</div></div>
  </div>
</div>
<div class="abs slab cal"><div class="top">December</div><div class="day">5</div><div style="text-align:center;font-size:8.5px;font-weight:700;padding:2px 0 10px">Next EMI ₹21,450</div></div>
<div class="abs slab pad others">
  <div class="line row" style="font-size:8.5px;padding:3px 0"><span>Car loan</span><b class="num">₹3,12,000</b></div>
  <div class="line row" style="font-size:8.5px;padding:3px 0"><span>Education loan</span><b class="num">₹1,45,000</b></div>
</div>
`,
}

// ---------------------------------------------------------------------------
// 6. Goals: a trip goal, its ring and the monthly amount, with rising coin stacks
// ---------------------------------------------------------------------------
const goals: Scene = {
  slug: "goals",
  css: String.raw`
.goal { left: 100px; top: 48px; width: 260px; }
.ring { width: 84px; height: 84px; border-radius: 50%; background: conic-gradient(var(--fc-color-accent-deep) 0 58%, var(--fc-color-mint) 58% 100%); display: grid; place-items: center; flex: none; }
.ring > div { width: 62px; height: 62px; border-radius: 50%; background: #fff; display: grid; place-items: center; font: 800 15px "Manrope Variable"; }
.monthly { left: 380px; top: 66px; width: 160px; transform: translateZ(90px); }
.stacks { left: 395px; top: 290px; transform: translateZ(40px); }
.flag { left: 520px; top: 150px; transform: translateZ(60px); }
body.phone .goal { left: 26px; top: 140px; width: 250px; }
body.phone .monthly { left: 196px; top: 56px; width: 160px; }
body.phone .stacks { display: none; }
`,
  body: String.raw`
<div class="abs slab pad goal">
  <div class="row"><div><div class="eyebrow">Goal · trip</div><h2 style="font-size:13px;margin-top:3px">Goa trip</h2><div class="muted" style="font-size:8.5px">by March 2027</div></div><span class="chip lav">On track</span></div>
  <div class="row" style="margin-top:12px;justify-content:flex-start;gap:14px">
    <div class="ring"><div>58%</div></div>
    <div><div class="eyebrow">Saved</div><div class="num" style="font-size:16px">₹34,800</div><div class="muted" style="font-size:8.5px">of ₹60,000</div></div>
  </div>
  <div class="slab" style="box-shadow:none;background:var(--fc-color-canvas);border-radius:10px;padding:8px;margin-top:12px;font-size:8.5px"><b>What if</b> you save ₹1,000 more a month? You'd reach it in February.</div>
</div>
<div class="abs slab lime pad monthly"><div class="eyebrow" style="color:var(--fc-color-accent-deep)">Save each month</div><div class="num" style="font-size:22px;margin-top:3px">₹6,300</div><div style="font-size:8.5px">to reach it on time</div></div>
<div class="abs stacks">
  <div class="abs stack" style="left:0;top:0"><div class="coin" style="top:0">₹</div></div>
  <div class="abs stack" style="left:54px;top:0"><div class="coin" style="top:0">₹</div><div class="coin" style="top:-9px">₹</div></div>
  <div class="abs stack d-only" style="left:108px;top:0"><div class="coin" style="top:0">₹</div><div class="coin" style="top:-9px">₹</div><div class="coin" style="top:-18px">₹</div></div>
</div>
`,
}

// ---------------------------------------------------------------------------
// 7. Roma: a question and an answer from the records, with its source, and the orb
// ---------------------------------------------------------------------------
const roma: Scene = {
  slug: "roma",
  css: String.raw`
.chat { left: 110px; top: 40px; width: 300px; display: flex; flex-direction: column; gap: 9px; }
.q { align-self: flex-end; background: var(--fc-color-ink); color: #fff; border-radius: 12px 12px 3px 12px; padding: 8px 10px; font-size: 9.5px; max-width: 80%; }
.a { background: var(--fc-color-canvas); border-radius: 12px 12px 12px 3px; padding: 9px 10px; font-size: 9.5px; line-height: 1.4; max-width: 92%; }
.src { display: flex; gap: 4px; margin-top: 6px; flex-wrap: wrap; }
.big { left: 440px; top: 70px; width: 96px; height: 96px; transform: translateZ(110px); }
.small { left: 480px; top: 230px; width: 36px; height: 36px; transform: translateZ(60px); }
.spark { left: 410px; top: 200px; transform: translateZ(90px); font: 800 18px "Manrope Variable"; color: var(--fc-color-accent-deep); }
body.phone .chat { left: 20px; top: 70px; width: 290px; }
body.phone .big { left: 290px; top: 40px; width: 72px; height: 72px; }
body.phone .small, body.phone .spark { display: none; }
`,
  body: String.raw`
<div class="abs slab pad chat">
  <div class="row"><div class="row" style="gap:6px"><span class="orb" style="width:20px;height:20px;display:block;box-shadow:none"></span><h2 style="font-size:12px">Ask Roma</h2></div><span class="chip mint">Your records</span></div>
  <div class="q">How much went on food last month?</div>
  <div class="a"><b>₹8,240 on Food in October</b>, 12% less than September. Most of it was eating out (₹5,100).<div class="src"><span class="chip blue">Oct 1 – Oct 31</span><span class="chip lav">23 entries</span></div></div>
  <div class="q">Am I on track for the Goa trip?</div>
</div>
<div class="abs orb big"></div>
<div class="abs orb small d-only"></div>
<div class="abs spark d-only">✦</div>
`,
}

export const SCENES: readonly Scene[] = [welcome, accounts, track, investments, loans, goals, roma]
