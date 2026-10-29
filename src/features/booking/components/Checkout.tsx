import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { useBlocker } from 'react-router-dom'
import { ApiError, RateLimitError, errorMessage } from '../../../shared/api/http'
import { LeaveAttemptDialog } from '../../../shared/ui/LeaveAttemptDialog'
import { TurnstileWidget } from '../../../shared/turnstile/TurnstileWidget'
import type { TurnstileWidgetHandle } from '../../../shared/turnstile/TurnstileWidget'
import { bookingApi } from '../api'
import type { BookingPayload, Business, Professional, Receipt, Service, Slot } from '../api'
import { dateTime, price, time } from '../format'

type Customer = {
  customerName: string
  customerEmail: string
  customerPhone: string
  notes: string
}
type Attempt = {
  payload: BookingPayload
  status: 'sending' | 'uncertain' | 'rate-limited' | 'verification-required'
  uncertain: boolean
  retryAt?: number
}

export function Checkout({
  business,
  slug,
  service,
  professional,
  slot,
  onLock,
  onConflict,
  onSuccess,
  onNew,
}: {
  business: Business
  slug: string
  service: Service
  professional: Professional
  slot: Slot
  onLock: (locked: boolean) => void
  onConflict: () => void
  onSuccess: () => void
  onNew: () => void
}) {
  const [customer, setCustomer] = useState<Customer>({
    customerName: '',
    customerEmail: '',
    customerPhone: '',
    notes: '',
  })
  const [review, setReview] = useState(false)
  const [attempt, setAttempt] = useState<Attempt>()
  const [receipt, setReceipt] = useState<Receipt>()
  const [error, setError] = useState('')
  const [retryAfterSeconds, setRetryAfterSeconds] = useState(0)
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null)
  const busy = useRef(false)
  const mounted = useRef(true)
  const title = useRef<HTMLHeadingElement>(null)
  const turnstile = useRef<TurnstileWidgetHandle>(null)
  const handleTurnstileToken = useCallback((token: string | null) => {
    setTurnstileToken(token)
  }, [])
  const blocker = useBlocker(Boolean(attempt))
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  useEffect(() => {
    if (!attempt) return
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [attempt])
  useEffect(() => {
    title.current?.focus()
  }, [review, receipt])
  useEffect(() => {
    const retryAt = attempt?.retryAt
    if (retryAt === undefined || retryAt <= Date.now()) return
    const updateRemaining = () => {
      const remaining = Math.max(0, Math.ceil((retryAt - Date.now()) / 1_000))
      setRetryAfterSeconds(remaining)
      if (remaining === 0) window.clearInterval(timer)
    }
    const timer = window.setInterval(updateRemaining, 250)
    return () => window.clearInterval(timer)
  }, [attempt?.retryAt])

  function reviewCustomer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!customer.customerName.trim()) {
      setError('Introduce tu nombre.')
      return
    }
    if (!customer.customerEmail.trim() && !customer.customerPhone.trim()) {
      setError('Indica al menos un correo o teléfono.')
      return
    }
    setError('')
    setReview(true)
  }

  async function send() {
    if (busy.current || receipt || retryAfterSeconds > 0 || !turnstileToken) return
    busy.current = true
    const tokenForRequest = turnstileToken
    const payload = attempt?.payload ?? {
      requestKey: crypto.randomUUID(),
      professionalId: professional.id,
      serviceId: service.id,
      startsAt: slot.startsAt,
      customerName: customer.customerName.trim(),
      customerEmail: customer.customerEmail.trim() || null,
      customerPhone: customer.customerPhone.trim() || null,
      notes: customer.notes.trim() || null,
    }
    const wasUncertain = attempt?.uncertain ?? false
    setRetryAfterSeconds(0)
    setAttempt({ payload, status: 'sending', uncertain: wasUncertain })
    onLock(true)
    setError('')
    try {
      const result = await bookingApi.book(slug, payload, tokenForRequest)
      if (!mounted.current) return
      setReceipt(result)
      setAttempt(undefined)
      onSuccess()
    } catch (cause) {
      if (!mounted.current) return
      if (cause instanceof RateLimitError) {
        setRetryAfterSeconds(Math.max(0, Math.ceil((cause.retryAt - Date.now()) / 1_000)))
        setAttempt({
          payload,
          status: 'rate-limited',
          uncertain: wasUncertain,
          retryAt: cause.retryAt,
        })
        setError('')
      } else if (!(cause instanceof ApiError) || cause.status >= 500) {
        setAttempt({ payload, status: 'uncertain', uncertain: true })
        setError(errorMessage(cause))
      } else if (cause.status === 403) {
        setAttempt({ payload, status: 'verification-required', uncertain: wasUncertain })
        setError(errorMessage(cause))
      } else {
        setAttempt(undefined)
        onLock(false)
        setError(errorMessage(cause))
        if (cause.status === 409) {
          onConflict()
        }
      }
    } finally {
      busy.current = false
      if (mounted.current) {
        setTurnstileToken(null)
        turnstile.current?.reset()
      }
    }
  }

  if (receipt)
    return (
      <section className="card receipt">
        <span className="success-mark" aria-hidden="true">
          ✓
        </span>
        <span className="eyebrow">COMPROBANTE DE RESERVA</span>
        <h2 tabIndex={-1} ref={title}>
          Tu reserva ha sido registrada
        </h2>
        <p>Guarda este comprobante para tener los detalles a mano.</p>
        <dl>
          <dt>Referencia</dt>
          <dd className="reference">{receipt.id}</dd>
          <dt>Negocio</dt>
          <dd>{receipt.businessSlug}</dd>
          <dt>Servicio</dt>
          <dd>{receipt.serviceName}</dd>
          <dt>Inicio</dt>
          <dd>{dateTime(receipt.startsAt, receipt.timeZone)}</dd>
          <dt>Fin</dt>
          <dd>{dateTime(receipt.endsAt, receipt.timeZone)}</dd>
          <dt>Zona horaria</dt>
          <dd>{receipt.timeZone}</dd>
          <dt>Duración</dt>
          <dd>{receipt.durationMinutes} min</dd>
          <dt>Precio</dt>
          <dd>{price(receipt.price, receipt.currency)}</dd>
          <dt>Estado</dt>
          <dd>{receipt.status}</dd>
        </dl>
        <p className="notice">La confirmación no representa un pago.</p>
        <button className="primary" onClick={onNew}>
          Crear otra reserva
        </button>
      </section>
    )

  return (
    <section className="card">
      <div className="section-heading">
        <span className="step">4</span>
        <div>
          <h2 ref={title} tabIndex={-1}>
            {review ? 'Revisa tu reserva' : 'Tus datos'}
          </h2>
          <p>{review ? 'Un último vistazo antes de confirmar.' : 'Sin cuentas ni contraseñas.'}</p>
        </div>
      </div>
      {!review ? (
        <form onSubmit={reviewCustomer}>
          <div className="form-grid">
            <label className="full">
              Nombre completo <span>(obligatorio)</span>
              <input
                autoComplete="name"
                required
                maxLength={150}
                value={customer.customerName}
                onChange={(event) => setCustomer({ ...customer, customerName: event.target.value })}
              />
            </label>
            <label>
              Correo electrónico
              <input
                type="email"
                autoComplete="email"
                maxLength={254}
                value={customer.customerEmail}
                onChange={(event) =>
                  setCustomer({ ...customer, customerEmail: event.target.value })
                }
              />
            </label>
            <label>
              Teléfono
              <input
                type="tel"
                autoComplete="tel"
                maxLength={30}
                value={customer.customerPhone}
                onChange={(event) =>
                  setCustomer({ ...customer, customerPhone: event.target.value })
                }
              />
            </label>
            <p className="fine-print full" id="contact-hint">
              Necesitamos al menos tu correo o teléfono.
            </p>
            <label className="full">
              Notas <span>(opcional)</span>
              <textarea
                maxLength={1000}
                rows={3}
                value={customer.notes}
                onChange={(event) => setCustomer({ ...customer, notes: event.target.value })}
              />
            </label>
          </div>
          {error && (
            <p role="alert" className="notice error">
              {error}
            </p>
          )}
          <button className="primary" type="submit">
            Revisar reserva <span aria-hidden="true">→</span>
          </button>
        </form>
      ) : (
        <>
          <dl>
            <dt>Servicio</dt>
            <dd>
              {service.name} · {service.durationMinutes} min
            </dd>
            <dt>Profesional</dt>
            <dd>{professional.fullName}</dd>
            <dt>Fecha y hora</dt>
            <dd>
              {dateTime(slot.startsAt, business.timeZone)} — {time(slot.endsAt, business.timeZone)}
            </dd>
            <dt>Zona horaria</dt>
            <dd>{business.timeZone}</dd>
            <dt>Cliente</dt>
            <dd>{customer.customerName}</dd>
            {customer.customerEmail && (
              <>
                <dt>Correo</dt>
                <dd>{customer.customerEmail}</dd>
              </>
            )}
            {customer.customerPhone && (
              <>
                <dt>Teléfono</dt>
                <dd>{customer.customerPhone}</dd>
              </>
            )}
            {customer.notes && (
              <>
                <dt>Notas</dt>
                <dd className="description">{customer.notes}</dd>
              </>
            )}
            <dt>Precio</dt>
            <dd className="total">{price(service.price, service.currency)}</dd>
          </dl>
          <p className="notice">
            La confirmación no representa un pago. El turno se confirma al completar la reserva.
          </p>
          <TurnstileWidget ref={turnstile} onTokenChange={handleTurnstileToken} />
          {error && (
            <p role="alert" className="notice error">
              {error}
            </p>
          )}
          {attempt?.uncertain && (
            <div role="alert" className="notice warning">
              <strong>El resultado es incierto.</strong>
              <p>
                La reserva podría haberse creado. Conservamos este intento sin cambios. Reintenta
                para obtener su resultado con la misma clave y los mismos datos.
              </p>
              <p>No cierres esta página: el intento se conserva solo en memoria.</p>
            </div>
          )}
          {attempt?.status === 'rate-limited' && retryAfterSeconds > 0 && (
            <>
              <p className="sr-only" role="status">
                Se alcanzó el límite de intentos. El botón de reintento estará disponible al
                finalizar la espera.
              </p>
              <p id="rate-limit-countdown" className="notice warning">
                Demasiados intentos. Puedes reintentar en {retryAfterSeconds} segundos
              </p>
            </>
          )}
          <div className="actions">
            <button
              className="primary"
              disabled={attempt?.status === 'sending' || retryAfterSeconds > 0 || !turnstileToken}
              aria-describedby={retryAfterSeconds > 0 ? 'rate-limit-countdown' : undefined}
              onClick={send}
            >
              {attempt?.status === 'sending'
                ? 'Confirmando…'
                : attempt
                  ? 'Reintentar el mismo intento'
                  : turnstileToken
                    ? 'Confirmar reserva'
                    : 'Completa la verificación'}
            </button>
            <button
              disabled={Boolean(attempt)}
              onClick={() => {
                setReview(false)
                setError('')
              }}
            >
              Editar datos
            </button>
          </div>
        </>
      )}
      {blocker.state === 'blocked' && (
        <LeaveAttemptDialog stay={() => blocker.reset()} leave={() => blocker.proceed()} />
      )}
    </section>
  )
}
