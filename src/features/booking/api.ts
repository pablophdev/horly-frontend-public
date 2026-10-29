import { DateTime, IANAZone } from 'luxon'
import { z } from 'zod'
import { request } from '../../shared/api/http'

const text = z.string().min(1)
const zone = text.refine((value) => IANAZone.isValidZone(value))
const instant = text.refine(
  (value) =>
    /(?:Z|[+-]\d{2}:\d{2})$/.test(value) && DateTime.fromISO(value, { setZone: true }).isValid,
)
const money = { price: z.number().finite().nonnegative(), currency: z.string().regex(/^[A-Z]{3}$/) }
const duration = z.number().int().positive()
const businessSchema = z.object({
  name: text,
  slug: text,
  description: z.string().nullable(),
  phone: z.string().nullable(),
  address: z.string().nullable(),
  timeZone: zone,
})
const serviceSchema = z.object({
  id: text,
  name: text,
  description: z.string().nullable(),
  durationMinutes: duration,
  ...money,
})
const professionalSchema = z.object({ id: text, fullName: text, bio: z.string().nullable() })
const slotSchema = z.object({ startsAt: instant, endsAt: instant })
const availabilitySchema = z.object({
  businessId: text,
  professionalId: text,
  serviceId: text,
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  timeZone: zone,
  durationMinutes: duration,
  slots: z.array(slotSchema),
})
const receiptSchema = z.object({
  id: text,
  businessSlug: text,
  serviceName: text,
  durationMinutes: duration,
  ...money,
  timeZone: zone,
  startsAt: instant,
  endsAt: instant,
  status: text,
})

export type Business = z.infer<typeof businessSchema>
export type Service = z.infer<typeof serviceSchema>
export type Professional = z.infer<typeof professionalSchema>
export type Slot = z.infer<typeof slotSchema>
export type Receipt = z.infer<typeof receiptSchema>
export type BookingPayload = {
  requestKey: string
  professionalId: string
  serviceId: string
  startsAt: string
  customerName: string
  customerEmail: string | null
  customerPhone: string | null
  notes: string | null
}

const base = (slug: string) => `/public/businesses/${encodeURIComponent(slug)}`
export const bookingApi = {
  business: (slug: string, signal: AbortSignal) => request(base(slug), businessSchema, { signal }),
  services: (slug: string, signal: AbortSignal) =>
    request(`${base(slug)}/services`, z.array(serviceSchema), { signal }),
  professionals: (slug: string, serviceId: string, signal: AbortSignal) =>
    request(
      `${base(slug)}/professionals?${new URLSearchParams({ serviceId })}`,
      z.array(professionalSchema),
      { signal },
    ),
  availability: (
    slug: string,
    professionalId: string,
    serviceId: string,
    date: string,
    signal: AbortSignal,
  ) =>
    request(
      `${base(slug)}/availability?${new URLSearchParams({ professionalId, serviceId, date })}`,
      availabilitySchema,
      { signal },
    ),
  book: (slug: string, payload: BookingPayload) =>
    request(`${base(slug)}/bookings`, receiptSchema, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
}
