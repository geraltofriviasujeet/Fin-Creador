import { CircleAlert } from "lucide-react"
import { cn } from "cn"

/** A small set of radio options shown as a segmented control (keyboard: arrows within the group). */
export function Choice<V extends string>({
  name,
  legend,
  value,
  options,
  onChange,
  error,
  hint,
  className,
  grid = false,
}: {
  name: string
  legend: string
  value: string
  options: readonly { value: V; label: string }[]
  onChange: (value: V) => void
  error?: string
  hint?: string
  className?: string
  /** Wrap the options in a grid of equal cells (for longer lists). */
  grid?: boolean
}) {
  const errorId = error ? `${name}-error` : undefined
  const hintId = hint ? `${name}-hint` : undefined
  return (
    <fieldset className={cn("min-w-0", className)} aria-describedby={[hintId, errorId].filter(Boolean).join(" ") || undefined}>
      <legend className="mb-1.5 text-sm font-semibold text-ink">{legend}</legend>
      <div className={cn(grid ? "grid grid-cols-2 gap-1.5 md:grid-cols-3" : "flex w-fit max-w-full flex-wrap gap-0.5 rounded-lg bg-canvas p-0.5")}>
        {options.map((o) => (
          <label
            key={o.value}
            className={cn(
              "relative flex cursor-pointer items-center text-sm font-semibold has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-1 has-[:focus-visible]:outline-ring",
              grid
                ? "min-h-[36px] rounded-lg border border-line px-3 py-1.5 has-[:checked]:border-ink has-[:checked]:bg-primary has-[:checked]:text-primary-foreground"
                : "h-[32px] rounded-md px-3 text-muted-foreground has-[:checked]:bg-primary has-[:checked]:text-primary-foreground",
            )}
          >
            {/* Transparent over its label: clickable and announced as a radio. */}
            <input type="radio" className="absolute inset-0 m-0 size-full cursor-pointer appearance-none opacity-0" name={name} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} />
            {o.label}
          </label>
        ))}
      </div>
      {hint && (
        <p id={hintId} className="mt-1.5 text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="mt-1.5 flex items-center gap-1.5 text-xs font-medium text-danger">
          <CircleAlert aria-hidden="true" className="size-3.5 shrink-0" />
          {error}
        </p>
      )}
    </fieldset>
  )
}
