import { useCallback, useState } from 'react'
import { DateTime } from 'luxon'
import { ApiError } from '../../shared/api/http'
import { useResource } from '../../shared/hooks/useResource'
import { Failure, Loading } from '../../shared/ui/Feedback'
import { bookingApi } from './api'
import type { Business, Professional, Service, Slot } from './api'
import { price, slotTimeLabels } from './format'
import { Checkout } from './components/Checkout'

export function BookingPage({ slug }: { slug: string }) {
  const load = useCallback((signal: AbortSignal) => bookingApi.business(slug, signal), [slug])
  const { result, retry } = useResource(slug, load)
  const [generation, setGeneration] = useState(0)
  if (result.status === 'loading') return <Loading />
  if (result.status === 'error') {
    if (result.error instanceof ApiError && result.error.status === 404)
      return (
        <section className="card landing">
          <h1>Negocio no encontrado</h1>
          <p>Comprueba el enlace que te ha compartido el negocio.</p>
        </section>
      )
    return <Failure error={result.error} retry={retry} />
  }
  const business = result.data
  return (
    <>
      <section className="business-heading">
        <span className="eyebrow">RESERVA TU MOMENTO</span>
        <h1>{business.name}</h1>
        {business.description && <p className="description">{business.description}</p>}
        <div className="business-details">
          {business.address && <address>{business.address}</address>}
          {business.phone && <span>Tel. {business.phone}</span>}
        </div>
      </section>
      <BookingFlow
        key={generation}
        business={business}
        slug={slug}
        onNew={() => setGeneration((value) => value + 1)}
      />
    </>
  )
}

function BookingFlow({
  business,
  slug,
  onNew,
}: {
  business: Business
  slug: string
  onNew: () => void
}) {
  const [service, setService] = useState<Service>()
  const [professional, setProfessional] = useState<Professional>()
  const [date, setDate] = useState(() => DateTime.now().setZone(business.timeZone).toISODate()!)
  const [slot, setSlot] = useState<Slot>()
  const [locked, setLocked] = useState(false)
  const [completed, setCompleted] = useState(false)
  const [revision, setRevision] = useState(0)
  const [conflict, setConflict] = useState(false)
  const load = useCallback((signal: AbortSignal) => bookingApi.services(slug, signal), [slug])
  const { result, retry } = useResource(slug, load)
  const today = DateTime.now().setZone(business.timeZone)
  const refresh = () => {
    setConflict(true)
    setSlot(undefined)
    setRevision((value) => value + 1)
  }

  return (
    <div className="booking-layout">
      <div className="booking-main">
        <div hidden={completed}>
          {conflict && (
            <p className="notice error" role="alert">
              Hay un conflicto con la reserva. Hemos vuelto a consultar la disponibilidad.
              Selecciona un turno de nuevo.
            </p>
          )}
          <section className="card">
            <div className="section-heading">
              <span className="step">1</span>
              <div>
                <h2>Elige tu servicio</h2>
                <p>Encuentra lo que necesitas.</p>
              </div>
            </div>
            {result.status === 'loading' && <Loading />}
            {result.status === 'error' && <Failure error={result.error} retry={retry} />}
            {result.status === 'success' &&
              (result.data.length === 0 ? (
                <p className="notice">Este negocio aún no tiene servicios disponibles.</p>
              ) : (
                <fieldset disabled={locked} className="choices">
                  <legend className="sr-only">Servicios</legend>
                  {result.data.map((item) => (
                    <button
                      type="button"
                      className={`choice ${service?.id === item.id ? 'selected' : ''}`}
                      aria-pressed={service?.id === item.id}
                      key={item.id}
                      onClick={() => {
                        setService(item)
                        setProfessional(undefined)
                        setSlot(undefined)
                      }}
                    >
                      <span>
                        <strong>{item.name}</strong>
                        {item.description && <small>{item.description}</small>}
                        <small>{item.durationMinutes} min</small>
                      </span>
                      <span className="choice-price">
                        {price(item.price, item.currency)}
                        <span aria-hidden="true" className="selection-dot" />
                      </span>
                    </button>
                  ))}
                </fieldset>
              ))}
          </section>
          {service && (
            <Professionals
              key={service.id}
              slug={slug}
              serviceId={service.id}
              selected={professional?.id}
              locked={locked}
              onSelect={(value) => {
                setProfessional(value)
                setSlot(undefined)
              }}
            />
          )}
          {service && professional && (
            <section className="card">
              <div className="section-heading">
                <span className="step">3</span>
                <div>
                  <h2>Encuentra tu horario</h2>
                  <p>Horas del negocio · {business.timeZone}</p>
                </div>
              </div>
              <fieldset disabled={locked}>
                <label htmlFor="booking-date">Fecha</label>
                <input
                  id="booking-date"
                  type="date"
                  value={date}
                  min={today.toISODate()!}
                  max={today.plus({ days: 90 }).toISODate()!}
                  onChange={(event) => {
                    setDate(event.target.value)
                    setSlot(undefined)
                  }}
                />
              </fieldset>
              {date >= today.toISODate()! && date <= today.plus({ days: 90 }).toISODate()! ? (
                <Availability
                  key={`${service.id}:${professional.id}:${date}:${revision}`}
                  slug={slug}
                  serviceId={service.id}
                  professionalId={professional.id}
                  date={date}
                  zone={business.timeZone}
                  selected={slot?.startsAt}
                  locked={locked}
                  onSelect={setSlot}
                />
              ) : (
                <p className="notice">Elige una fecha entre hoy y los próximos 90 días.</p>
              )}
              <p className="fine-print">
                Seleccionar un turno no lo bloquea ni confirma una reserva.
              </p>
            </section>
          )}
        </div>
        {service && professional && slot && (
          <Checkout
            key={`${service.id}:${professional.id}:${slot.startsAt}`}
            business={business}
            slug={slug}
            service={service}
            professional={professional}
            slot={slot}
            onLock={setLocked}
            onConflict={refresh}
            onSuccess={() => {
              setCompleted(true)
              setRevision((value) => value + 1)
            }}
            onNew={onNew}
          />
        )}
      </div>
      <aside className="booking-aside">
        <span className="eyebrow">A TU RITMO</span>
        <h2>
          Tu próxima cita,
          <br />
          en unos pasos.
        </h2>
        <p>Elige el servicio, encuentra tu horario y confirma tus datos.</p>
        <ol>
          <li>Servicio y profesional</li>
          <li>Fecha y horario</li>
          <li>Tus datos y confirmación</li>
        </ol>
        <div className="aside-note">
          Sin registro.
          <br />
          La confirmación no representa un pago.
        </div>
      </aside>
    </div>
  )
}

function Professionals({
  slug,
  serviceId,
  selected,
  locked,
  onSelect,
}: {
  slug: string
  serviceId: string
  selected?: string
  locked: boolean
  onSelect: (value: Professional) => void
}) {
  const load = useCallback(
    (signal: AbortSignal) => bookingApi.professionals(slug, serviceId, signal),
    [slug, serviceId],
  )
  const { result, retry } = useResource(`${slug}:${serviceId}`, load)
  return (
    <section className="card">
      <div className="section-heading">
        <span className="step">2</span>
        <div>
          <h2>¿Con quién te gustaría?</h2>
          <p>Elige un profesional.</p>
        </div>
      </div>
      {result.status === 'loading' && <Loading />}
      {result.status === 'error' && <Failure error={result.error} retry={retry} />}
      {result.status === 'success' &&
        (result.data.length === 0 ? (
          <p className="notice">
            No hay profesionales disponibles para este servicio. Puedes elegir otro servicio.
          </p>
        ) : (
          <fieldset disabled={locked} className="choices">
            <legend className="sr-only">Profesionales</legend>
            {result.data.map((item) => (
              <button
                className={`choice ${selected === item.id ? 'selected' : ''}`}
                key={item.id}
                aria-pressed={selected === item.id}
                onClick={() => onSelect(item)}
              >
                <span className="avatar" aria-hidden="true">
                  {item.fullName.slice(0, 1)}
                </span>
                <span className="grow">
                  <strong>{item.fullName}</strong>
                  {item.bio && <small>{item.bio}</small>}
                </span>
                <span className="selection-dot" aria-hidden="true" />
              </button>
            ))}
          </fieldset>
        ))}
    </section>
  )
}

function Availability({
  slug,
  serviceId,
  professionalId,
  date,
  zone,
  selected,
  locked,
  onSelect,
}: {
  slug: string
  serviceId: string
  professionalId: string
  date: string
  zone: string
  selected?: string
  locked: boolean
  onSelect: (value: Slot) => void
}) {
  const load = useCallback(
    (signal: AbortSignal) => bookingApi.availability(slug, professionalId, serviceId, date, signal),
    [slug, professionalId, serviceId, date],
  )
  const { result, retry } = useResource(`${slug}:${professionalId}:${serviceId}:${date}`, load)
  if (result.status === 'loading') return <Loading />
  if (result.status === 'error') return <Failure error={result.error} retry={retry} />
  if (result.data.slots.length === 0)
    return <p className="notice">No hay turnos disponibles para esta fecha. Prueba con otro día.</p>
  const labels = slotTimeLabels(
    result.data.slots.map((slot) => slot.startsAt),
    zone,
  )
  return (
    <fieldset className="slots" disabled={locked}>
      <legend>Horarios disponibles</legend>
      <p className="slots-zone">Todas las horas corresponden a {zone}.</p>
      <div className="slots-grid">
        {result.data.slots.map((item, index) => {
          const label = labels[index]
          return (
            <button
              type="button"
              key={item.startsAt}
              className={selected === item.startsAt ? 'selected' : ''}
              aria-label={label.offset ? `${label.time}, ${label.offset}` : label.time}
              aria-pressed={selected === item.startsAt}
              onClick={() => onSelect(item)}
            >
              <span className="slot-time">{label.time}</span>
              {label.offset && <span className="slot-offset">{label.offset}</span>}
            </button>
          )
        })}
      </div>
    </fieldset>
  )
}
