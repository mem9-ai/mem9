const RETRY_STATUS_CODES = new Set([429, 500, 502, 503, 504])
const MAX_RETRIES = 5
const BASE_DELAY_MS = 2000
const REQUEST_TIMEOUT_MS = 600_000

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

export const fetchWithRetry = async (url: string, init?: RequestInit): Promise<Response> => {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    try {
      const response = await fetch(url, { ...init, signal: controller.signal })
      clearTimeout(timeout)
      if (RETRY_STATUS_CODES.has(response.status) && attempt < MAX_RETRIES) {
        await sleep(BASE_DELAY_MS * 2 ** attempt)
        continue
      }
      return response
    } catch (err) {
      clearTimeout(timeout)
      if (attempt >= MAX_RETRIES) throw err
      await sleep(BASE_DELAY_MS * 2 ** attempt)
    }
  }
  throw new Error('fetchWithRetry: exhausted retries')
}
