import { useEffect, useRef } from 'react'

export function LeaveAttemptDialog({ stay, leave }: { stay: () => void; leave: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const element = dialog.current
    element?.showModal()
    return () => element?.close()
  }, [])
  return (
    <dialog
      ref={dialog}
      role="alertdialog"
      aria-labelledby="leave-title"
      aria-describedby="leave-description"
      className="leave-dialog card"
      onCancel={(event) => {
        event.preventDefault()
        stay()
      }}
    >
      <h2 id="leave-title">¿Abandonar este intento?</h2>
      <p id="leave-description">
        El resultado de la reserva aún no está resuelto. Si sales, perderás la clave guardada en
        memoria y no podrás reintentar este mismo intento desde aquí.
      </p>
      <div className="actions">
        <button autoFocus className="primary" onClick={stay}>
          Permanecer aquí
        </button>
        <button onClick={leave}>Abandonar intento</button>
      </div>
    </dialog>
  )
}
