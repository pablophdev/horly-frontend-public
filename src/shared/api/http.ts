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
