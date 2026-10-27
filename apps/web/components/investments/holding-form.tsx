"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Search } from "lucide-react"
import { type HoldingItem, type Instrument, type WriteResult, SEARCH_MIN_LENGTH, newRequestKey } from "@fin-creador/api"
import { currentPriceScaled, formatPriceScaled, holdingFigures, scaledToInputString } from "@fin-creador/domain"
import { holdingFormSchema } from "@fin-creador/schemas"
import { saveHoldingAction, searchInstrumentsAction } from "@/app/(app)/investments/actions"
import { fullDate, money } from "@/components/transactions/display"
import { Button } from "@/components/ui/button"
import { DialogClose } from "@/components/ui/dialog"
import { FormMessage, TextField } from "@/components/ui/field"
import { toast } from "@/components/ui/toast"
import { KindChip, ProfitText, priceLabel } from "./display"

// Add a holding in two steps (search the instrument, then units, buy price and date) or edit
// one (the instrument stays). The preview uses the same shared schema and domain maths the
// server uses to save it.

const NETWORK = "We couldn't reach the server. Your details are kept; try again."
const PREVIEW_KEY = "00000000-0000-4000-8000-000000000000"
const SEARCH_DELAY_MS = 300

type Values = { units: string; buyPrice: string; buyDate: string }

const codeLine = (i: Instrument) => [i.source === "bse" ? `BSE ${i.sourceCode}` : `AMFI ${i.sourceCode}`, i.symbol, i.isin].filter(Boolean).join(" · ")

export function HoldingForm({ today, item, onDone }: { today: string; item?: HoldingItem; onDone: () => void }) {
  const [instrument, setInstrument] = useState<Instrument | null>(item?.instrument ?? null)
  // One key per opened form; a retry after a failure reuses it, so the record is added once.
  const [requestKey] = useState(newRequestKey)
  const [values, setValues] = useState<Values>(() =>
    item
      ? { units: scaledToInputString(item.unitsScaled), buyPrice: scaledToInputString(item.buyPriceScaled), buyDate: item.buyDate }
      : { units: "", buyPrice: "", buyDate: today },
  )
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const set = (name: keyof Values) => (e: React.ChangeEvent<HTMLInputElement>) => setValues((v) => ({ ...v, [name]: e.target.value }))

  const preview = useMemo(() => {
    if (!instrument) return null
    const parsed = holdingFormSchema({ today }).safeParse({ ...values, holdingId: "", instrumentId: instrument.id, idempotencyKey: PREVIEW_KEY })
    if (!parsed.success) return null
    const price = currentPriceScaled(instrument.lastPriceScaled, instrument.priceDate, today)
    return holdingFigures({ instrumentId: instrument.id, unitsScaled: parsed.data.unitsScaled, buyPriceScaled: parsed.data.buyPriceScaled }, price)
  }, [instrument, values, today])

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (pending || !instrument) return
    setPending(true)
    setFormError(null)
    let result: WriteResult
    try {
      result = await saveHoldingAction({
        ...values,
        holdingId: item?.id ?? "",
        instrumentId: item ? "" : instrument.id,
        idempotencyKey: item ? "" : requestKey,
      })
    } catch {
      result = { status: "error", message: NETWORK }
    }
    setPending(false)
    if (result.status === "success") {
      toast.success(result.message)
      onDone()
      return
    }
    setFormError(result.message)
    setErrors(result.fieldErrors ?? {})
  }

  if (!instrument) return <InstrumentSearch onChoose={setInstrument} />

  return (
    <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
      <div className="-mx-1 grid min-h-0 flex-1 content-start gap-3.5 overflow-y-auto px-1 pb-1">
        {formError && <FormMessage tone="error">{formError}</FormMessage>}
        {errors.instrumentId && <FormMessage tone="error">{errors.instrumentId}</FormMessage>}
        <div className="flex items-start gap-3 rounded-xl bg-canvas px-3 py-2.5">
          <div className="grid min-w-0 flex-1 gap-0.5">
            <p className="flex flex-wrap items-center gap-1.5 text-sm font-semibold">
              {instrument.name} <KindChip kind={instrument.kind} />
            </p>
            <p className="text-xs text-muted-foreground">{codeLine(instrument)}</p>
            <p className="text-xs text-muted-foreground tabular-nums">
              {priceLabel(instrument.source)} {formatPriceScaled(instrument.lastPriceScaled)} on {fullDate(instrument.priceDate)}
            </p>
          </div>
          {!item && (
            <Button type="button" variant="ghost" size="sm" className="-mr-1 shrink-0" onClick={() => setInstrument(null)}>
              Change
            </Button>
          )}
        </div>
        <div className="grid items-start gap-3 md:grid-cols-3">
          <TextField name="units" label="Units" inputMode="decimal" autoComplete="off" placeholder="e.g. 12.5" hint="Up to 4 decimals" value={values.units} error={errors.units} onChange={set("units")} autoFocus />
          <TextField name="buyPrice" label="Buy price per unit (₹)" inputMode="decimal" autoComplete="off" placeholder="e.g. 1,250.50" value={values.buyPrice} error={errors.buyPrice} onChange={set("buyPrice")} />
          <TextField name="buyDate" label="Buy date" type="date" max={today} value={values.buyDate} error={errors.buyDate} onChange={set("buyDate")} />
        </div>
      </div>

      {/* Sticky footer: the preview stays in view next to the buttons. */}
      <div className="mt-3 flex flex-wrap items-end justify-between gap-x-4 gap-y-2 border-t border-line pt-3">
        <div aria-live="polite" className="grid min-w-0 flex-1 basis-60 gap-0.5 text-sm">
          {preview ? (
            <>
              <p className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-semibold">Invested</span>
                <span className="font-heading text-lg font-bold tabular-nums">{money(preview.investedMinor, "INR")}</span>
              </p>
              {preview.valueMinor !== null && preview.profitMinor !== null ? (
                <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground tabular-nums">
                  Value {money(preview.valueMinor, "INR")} at the last price · <ProfitText minor={preview.profitMinor} bps={preview.profitBps} className="text-xs" />
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">No current price: value and profit aren&apos;t counted.</p>
              )}
            </>
          ) : (
            <p className="text-muted-foreground">Enter units, buy price and date to see the invested amount.</p>
          )}
        </div>
        <div className="flex shrink-0 gap-2">
          <DialogClose render={<Button type="button" variant="secondary" />}>Cancel</DialogClose>
          <Button type="submit" size="lg" disabled={pending} aria-busy={pending}>
            {pending ? "Saving…" : item ? "Save changes" : "Add holding"}
          </Button>
        </div>
      </div>
    </form>
  )
}

type SearchState = { status: "idle" } | { status: "searching" } | { status: "done"; query: string; results: Instrument[] } | { status: "error"; message: string }

function InstrumentSearch({ onChoose }: { onChoose: (instrument: Instrument) => void }) {
  const [query, setQuery] = useState("")
  const [state, setState] = useState<SearchState>({ status: "idle" })
  const latest = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])

  // Searches a moment after typing stops; only the newest answer is shown.
  function change(text: string) {
    setQuery(text)
    clearTimeout(timer.current)
    const q = text.trim()
    const request = ++latest.current
    if (q.length < SEARCH_MIN_LENGTH) {
      setState({ status: "idle" })
      return
    }
    setState({ status: "searching" })
    timer.current = setTimeout(async () => {
      try {
        const result = await searchInstrumentsAction(q)
        if (request !== latest.current) return
        setState(result.ok ? { status: "done", query: q, results: result.results } : { status: "error", message: result.message })
      } catch {
        if (request === latest.current) setState({ status: "error", message: "We couldn't reach the server. Try again." })
      }
    }, SEARCH_DELAY_MS)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="relative">
        <Search aria-hidden="true" className="pointer-events-none absolute top-[33px] left-3 size-4 text-muted-foreground" />
        <TextField
          name="instrumentSearch"
          type="search"
          label="Search a fund or share"
          hint="Name, ticker, scheme or scrip code, or ISIN"
          autoComplete="off"
          className="[&_input]:pl-9"
          value={query}
          onChange={(e) => change(e.target.value)}
          autoFocus
        />
      </div>
      <div aria-live="polite" className="sr-only">
        {state.status === "done" ? `${state.results.length} ${state.results.length === 1 ? "result" : "results"}` : ""}
      </div>
      <div className="-mx-1 mt-3 min-h-0 flex-1 overflow-y-auto px-1">
        {state.status === "searching" && <p className="text-sm text-muted-foreground">Searching…</p>}
        {state.status === "error" && <FormMessage tone="error">{state.message}</FormMessage>}
        {state.status === "done" && state.results.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Nothing matches “{state.query}”. Only funds and shares with a price in the last 30 days are listed.
          </p>
        )}
        {state.status === "done" && state.results.length > 0 && (
          <ul aria-label="Search results" className="grid gap-1">
            {state.results.map((i) => (
              <li key={i.id}>
                <button
                  type="button"
                  onClick={() => onChoose(i)}
                  className="flex w-full items-start gap-3 rounded-lg border border-line px-3 py-2 text-left outline-none hover:bg-canvas focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <span className="grid min-w-0 flex-1 gap-0.5">
                    <span className="flex flex-wrap items-center gap-1.5 text-sm font-semibold">
                      {i.name} <KindChip kind={i.kind} />
                    </span>
                    <span className="truncate text-xs text-muted-foreground">{codeLine(i)}</span>
                  </span>
                  <span className="grid shrink-0 justify-items-end gap-0.5 text-right">
                    <span className="text-sm font-semibold tabular-nums">{formatPriceScaled(i.lastPriceScaled)}</span>
                    <span className="text-xs text-muted-foreground">{fullDate(i.priceDate)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="mt-3 flex justify-end border-t border-line pt-3">
        <DialogClose render={<Button type="button" variant="secondary" />}>Cancel</DialogClose>
      </div>
    </div>
  )
}
