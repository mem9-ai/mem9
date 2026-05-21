export const runWithConcurrency = async <T>(tasks: Array<() => Promise<T>>, concurrency: number): Promise<T[]> => {
  if (tasks.length === 0) return []
  const limit = Math.max(1, Math.floor(concurrency))
  const results: T[] = Array.from({ length: tasks.length }) as T[]
  let nextIndex = 0
  const worker = async (): Promise<void> => {
    while (true) {
      const i = nextIndex
      nextIndex += 1
      if (i >= tasks.length) return
      results[i] = await tasks[i]()
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, async () => await worker()))
  return results
}
