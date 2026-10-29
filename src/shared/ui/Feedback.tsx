import { errorMessage } from '../api/http'

export function Loading() {
  return (
    <p className="notice" role="status">
      Cargando…
    </p>
  )
}

export function Failure({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <div className="notice error" role="alert">
      <p>{errorMessage(error)}</p>
      <button onClick={retry}>Reintentar</button>
    </div>
  )
}
