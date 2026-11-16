// Where the UPI import is reached from (Sprint 9e): its page returns there. Transactions by default.

export type UpiImportOrigin = "transactions" | "income"

export const UPI_IMPORT_ORIGINS: Record<UpiImportOrigin, { label: string; href: string }> = {
  transactions: { label: "Transactions", href: "/transactions" },
  income: { label: "Income", href: "/income" },
}

export const upiImportHref = (from: UpiImportOrigin) => `/income/import/upi?from=${from}`

/** The origin named by `?from=`, else Transactions. */
export const upiImportOrigin = (from: unknown): UpiImportOrigin => (from === "income" ? "income" : "transactions")
