import { useEffect, useState } from 'react'

type Resource<T> =
  { key: string; status: 'success'; data: T } | { key: string; status: 'error'; error: unknown }

/** Keyed state hides stale data immediately; cleanup also discards late responses. */
export function useResource<T>(key: string, load: (signal: AbortSignal) => Promise<T>) {
  const [revision, setRevision] = useState(0)
  const [result, setResult] = useState<Resource<T>>()
  const identity = `${key}:${revision}`
  useEffect(() => {
    const controller = new AbortController()
    load(controller.signal).then(
      (data) => {
        if (!controller.signal.aborted) setResult({ key: identity, status: 'success', data })
      },
      (error: unknown) => {
        if (!controller.signal.aborted) setResult({ key: identity, status: 'error', error })
      },
    )
    return () => controller.abort()
  }, [identity, load])
  return {
    result: result?.key === identity ? result : { status: 'loading' as const },
    retry: () => setRevision((value) => value + 1),
  }
}
