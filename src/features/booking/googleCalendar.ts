import { DateTime, IANAZone } from 'luxon'
import type { Business, Receipt } from './api'

const GOOGLE_CALENDAR_URL = 'https://calendar.google.com/calendar/render'
const EXPLICIT_OFFSET = /(?:Z|[+-]\d{2}:\d{2})$/

/** Builds a Google Calendar template only from a confirmed, internally consistent receipt. */
export function buildGoogleCalendarUrl(receipt: Receipt, business: Business): string | null {
  if (
    receipt.status !== 'CONFIRMED' ||
    receipt.businessSlug !== business.slug ||
    receipt.timeZone !== business.timeZone ||
    !IANAZone.isValidZone(business.timeZone) ||
    !EXPLICIT_OFFSET.test(receipt.startsAt) ||
    !EXPLICIT_OFFSET.test(receipt.endsAt)
  )
    return null

  const startsAt = DateTime.fromISO(receipt.startsAt, { setZone: true })
  const endsAt = DateTime.fromISO(receipt.endsAt, { setZone: true })
  if (!startsAt.isValid || !endsAt.isValid || endsAt.toMillis() <= startsAt.toMillis()) return null

  const formatUtc = (value: DateTime) => value.toUTC().toFormat("yyyyMMdd'T'HHmmss'Z'")
  const utcStart = formatUtc(startsAt)
  const utcEnd = formatUtc(endsAt)
  if (utcEnd <= utcStart) return null

  const url = new URL(GOOGLE_CALENDAR_URL)
  const parameters = new URLSearchParams({
    action: 'TEMPLATE',
    text: `Reserva en ${business.name}`,
    dates: `${utcStart}/${utcEnd}`,
    details: `Reserva confirmada en Horly. Referencia: ${receipt.id}`,
    ctz: business.timeZone,
  })
  if (business.address?.trim()) parameters.set('location', business.address)
  url.search = parameters.toString()
  return url.toString()
}
