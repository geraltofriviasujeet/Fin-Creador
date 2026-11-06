import { normalizeNumber } from "../output"

// Exact decimal arithmetic for web totals (Sprint 10.8): amounts are decimal strings in the
// currency found, worked with as integers (BigInt) at a shared scale, never floating point.

const scaleOf = (a: string) => (a.split(".")[1] ?? "").length

function toBig(a: string, scale: number): bigint {
  const [whole = "0", fraction = ""] = a.split(".")
  return BigInt(whole + fraction.padEnd(scale, "0"))
}

function fromBig(n: bigint, scale: number): string {
  const digits = n.toString().padStart(scale + 1, "0")
  return normalizeNumber(scale === 0 ? digits : `${digits.slice(0, -scale)}.${digits.slice(-scale)}`)
}

export function addDecimals(...amounts: string[]): string {
  const scale = Math.max(0, ...amounts.map(scaleOf))
  return fromBig(amounts.reduce((sum, a) => sum + toBig(a, scale), 0n), scale)
}

export function multiplyDecimal(amount: string, times: number): string {
  if (!Number.isSafeInteger(times) || times < 0) throw new Error("Multiply by a whole number only")
  const scale = scaleOf(amount)
  return fromBig(toBig(amount, scale) * BigInt(times), scale)
}

export function compareDecimals(a: string, b: string): number {
  const scale = Math.max(scaleOf(a), scaleOf(b))
  const x = toBig(a, scale)
  const y = toBig(b, scale)
  return x < y ? -1 : x > y ? 1 : 0
}
