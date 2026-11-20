/** PostgREST returns at most 1,000 rows a request (max_rows). */
const PAGE = 1000

/** Every row of a query, one 1,000-row page at a time; null if any page fails. The query must have a stable order. */
export async function allPages<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[] | null> {
  const rows: T[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1)
    if (error || !data) return null
    rows.push(...data)
    if (data.length < PAGE) return rows
  }
}
