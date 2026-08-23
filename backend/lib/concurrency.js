/**
 * Bounded-concurrency map.
 *
 * Ingest used to fan a single paste out into up to eight simultaneous model calls
 * via `Promise.allSettled`. Providers rate-limit per minute, so that burst reliably
 * tripped a 429: some wiki pages fell back to their stub text, and — worse — the
 * user's next chat or roadmap request was rejected too, because the burst had
 * already spent the minute's budget.
 *
 * Running the same jobs a few at a time costs a little wall-clock and buys back the
 * whole feature. Deliberately not a dependency: this is fifteen lines.
 */

/**
 * Runs `fn` over `items` with at most `limit` in flight at once.
 * Resolves to an array of settled results in input order — never rejects, matching
 * `Promise.allSettled` so callers can swap one for the other.
 */
export async function mapSettledWithConcurrency(items, limit, fn) {
  const list = [...items]
  const results = new Array(list.length)
  const width = Math.max(1, Math.min(limit, list.length))
  let next = 0

  async function worker() {
    while (next < list.length) {
      const index = next
      next += 1
      try {
        results[index] = { status: 'fulfilled', value: await fn(list[index], index) }
      } catch (reason) {
        results[index] = { status: 'rejected', reason }
      }
    }
  }

  await Promise.all(Array.from({ length: width }, worker))
  return results
}

export default { mapSettledWithConcurrency }
