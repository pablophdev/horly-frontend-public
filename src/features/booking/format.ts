import { DateTime } from 'luxon'

export function price(value: number, currency: string) {
  return `${new Intl.NumberFormat('es', { style: 'currency', currency }).format(value)} · ${currency}`
}

export function time(value: string, zone: string) {
  return DateTime.fromISO(value, { setZone: true }).setZone(zone).setLocale('es').toFormat('HH:mm')
}

export function slotTimeLabels(values: string[], zone: string) {
  const instants = values.map((value) => DateTime.fromISO(value, { setZone: true }).setZone(zone))
  const offsetsByLocalTime = new Map<string, Set<number>>()

  for (const instant of instants) {
    const localTime = instant.toFormat("yyyy-MM-dd'T'HH:mm")
    const offsets = offsetsByLocalTime.get(localTime) ?? new Set<number>()
    offsets.add(instant.offset)
    offsetsByLocalTime.set(localTime, offsets)
  }

  return instants.map((instant) => {
    const localTime = instant.toFormat("yyyy-MM-dd'T'HH:mm")
    const isAmbiguous = (offsetsByLocalTime.get(localTime)?.size ?? 0) > 1
    return {
      time: instant.toFormat('HH:mm'),
      offset: isAmbiguous ? `UTC${instant.toFormat('ZZ')}` : null,
    }
  })
}

export function dateTime(value: string, zone: string) {
  return `${DateTime.fromISO(value, { setZone: true }).setZone(zone).setLocale('es').toFormat("cccc d 'de' LLLL yyyy")} · ${time(value, zone)}`
}
