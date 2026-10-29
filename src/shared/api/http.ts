import { z } from 'zod'

const origin = (import.meta.env.VITE_API_URL || 'http://localhost:8080').replace(/\/+$/, '')

export class ApiError extends Error {
  status: number
  constructor(status: number) {
    super(`HTTP ${status}`)
    this.status = status
  }
}

export class InvalidResponseError extends Error {}

export class RateLimitError extends Error {
  status = 429 as const
  retryAt: number

  constructor(retryAt: number) {
    super('Demasiados intentos. Espera antes de volver a intentar.')
    this.name = 'RateLimitError'
    this.retryAt = retryAt
  }
}

function retryAtFromHeader(value: string | null, now: number) {
  if (!value) return null
  const normalized = value.trim()
  if (/^\d+$/.test(normalized)) {
    const seconds = Number(normalized)
    if (Number.isSafeInteger(seconds)) return now + seconds * 1_000
  }
  const date = Date.parse(normalized)
  return Number.isNaN(date) ? null : Math.max(now, date)
}

async function rateLimitError(response: Response) {
  const now = Date.now()
  const headerRetryAt = retryAtFromHeader(response.headers.get('Retry-After'), now)
  if (headerRetryAt !== null) return new RateLimitError(headerRetryAt)

  let bodySeconds: number | null = null
  try {
    const body: unknown = JSON.parse(await response.text())
    if (body && typeof body === 'object' && 'retryAfterSeconds' in body) {
      const value = body.retryAfterSeconds
      if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0)
        bodySeconds = value
    }
  } catch {
    // The HTTP status remains authoritative even when its optional body is invalid or empty.
  }
  return new RateLimitError(now + (bodySeconds ?? 60) * 1_000)
}

export async function request<T>(
  path: string,
  schema: z.ZodType<T>,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${origin}/api${path}`, {
    ...options,
    credentials: 'omit',
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
  })
  if (response.status === 429) throw await rateLimitError(response)
  if (!response.ok) throw new ApiError(response.status)
  try {
    if (options.method === 'POST' && response.status !== 201) throw new Error('Expected 201')
    return schema.parse(await response.json())
  } catch {
    throw new InvalidResponseError('La respuesta del servidor no es válida.')
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 400) return 'Revisa los datos enviados e inténtalo de nuevo.'
    if (error.status === 404) return 'El recurso ya no está disponible.'
    if (error.status === 409)
      return 'Hay un conflicto con la reserva. Revisa la disponibilidad y selecciona un turno de nuevo.'
    return `El servidor devolvió un error (HTTP ${error.status}). Inténtalo de nuevo.`
  }
  if (error instanceof InvalidResponseError) return error.message
  return 'No se pudo conectar con el servidor. Comprueba tu conexión e inténtalo de nuevo.'
}
