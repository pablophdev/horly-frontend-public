import { test, expect } from '@playwright/test'
import type { Page, Route } from '@playwright/test'

const service = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Corte de cabello',
  description: 'Un estilo para ti',
  durationMinutes: 30,
  price: 25,
  currency: 'EUR',
}
const professional = {
  id: '22222222-2222-4222-8222-222222222222',
  fullName: 'Ana Pérez',
  bio: 'Estilista',
}
const slots = [
  { startsAt: '2026-11-01T01:30:00-04:00', endsAt: '2026-11-01T01:00:00-05:00' },
  { startsAt: '2026-11-01T01:30:00-05:00', endsAt: '2026-11-01T02:00:00-05:00' },
  { startsAt: '2026-11-01T10:30:00-05:00', endsAt: '2026-11-01T11:00:00-05:00' },
]
const receipt = {
  id: 'reservation-real-response',
  businessSlug: 'salon',
  serviceName: 'Corte confirmado',
  durationMinutes: 35,
  price: 27,
  currency: 'EUR',
  timeZone: 'America/New_York',
  ...slots[0],
  status: 'CONFIRMED',
}
type MockOptions = {
  missing?: boolean
  empty?: 'services' | 'professionals' | 'slots'
  post?: (route: Route, count: number) => Promise<void>
  serviceError?: boolean
}

async function mockApi(page: Page, options: MockOptions = {}) {
  const requests: { path: string; authorization: string | undefined; body: string | null }[] = []
  let posts = 0
  await page.clock.install({ time: new Date('2026-11-01T02:00:00Z') })
  await page.route('**/api/public/businesses/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname
    requests.push({
      path: `${path}${url.search}`,
      authorization: request.headers().authorization,
      body: request.postData(),
    })
    const json = (body: unknown, status = 200) => route.fulfill({ status, json: body })
    if (path.endsWith('/bookings')) {
      posts++
      if (options.post) return options.post(route, posts)
      return json(receipt, 201)
    }
    if (path.endsWith('/services'))
      return options.serviceError
        ? json({}, 500)
        : json(options.empty === 'services' ? [] : [service])
    if (path.endsWith('/professionals'))
      return json(options.empty === 'professionals' ? [] : [professional])
    if (path.endsWith('/availability'))
      return json({
        businessId: 'business',
        professionalId: professional.id,
        serviceId: service.id,
        date: url.searchParams.get('date'),
        timeZone: 'America/New_York',
        durationMinutes: 30,
        slots: options.empty === 'slots' ? [] : slots,
      })
    if (options.missing) return json({}, 404)
    return json({
      name: path.endsWith('/otro') ? 'Otro negocio' : 'Salón Horly',
      slug: path.split('/').at(-1),
      description: 'Tu espacio de cuidado',
      phone: null,
      address: 'Calle 10',
      timeZone: 'America/New_York',
    })
  })
  return requests
}

async function selectService(page: Page) {
  await page.goto('/reservar/salon')
  await page.getByRole('button', { name: /Corte de cabello/ }).click()
}

async function selectSlot(page: Page) {
  await selectService(page)
  await page.getByRole('button', { name: /Ana Pérez/ }).click()
  await page.getByLabel('Fecha', { exact: true }).fill('2026-11-01')
  await page.getByRole('button', { name: '01:30, UTC-04:00', exact: true }).click()
}

async function review(page: Page) {
  await selectSlot(page)
  await page.getByLabel('Nombre completo').fill('Pablo Cliente')
  await page.getByLabel('Correo electrónico').fill('pablo@example.com')
  await page.getByRole('button', { name: 'Revisar reserva' }).click()
}

test('recorrido completo, comprobante del backend y ningún Authorization', async ({ page }) => {
  const requests = await mockApi(page)
  await review(page)
  await expect(page.getByRole('heading', { name: 'Revisa tu reserva' })).toBeVisible()
  await page.getByRole('button', { name: 'Confirmar reserva', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Tu reserva ha sido registrada' })).toBeVisible()
  await expect(page.getByText('Corte confirmado')).toBeVisible()
  await expect(page.getByText('35 min', { exact: true })).toBeVisible()
  const body = JSON.parse(requests.find((r) => r.body)!.body!)
  expect(body).toEqual({
    requestKey: expect.stringMatching(/^[\da-f-]{36}$/),
    professionalId: professional.id,
    serviceId: service.id,
    startsAt: slots[0].startsAt,
    customerName: 'Pablo Cliente',
    customerEmail: 'pablo@example.com',
    customerPhone: null,
    notes: null,
  })
  expect(requests.every((r) => r.authorization === undefined)).toBe(true)
  await expect
    .poll(() => requests.filter((r) => r.path.includes('/availability')).length)
    .toBeGreaterThanOrEqual(3)
  await page.getByRole('button', { name: 'Crear otra reserva' }).click()
  await expect(page.getByRole('button', { name: /Corte de cabello/ })).toHaveAttribute(
    'aria-pressed',
    'false',
  )
})

test('slug inexistente', async ({ page }) => {
  await mockApi(page, { missing: true })
  await page.goto('/reservar/no-existe')
  await expect(page.getByRole('heading', { name: 'Negocio no encontrado' })).toBeVisible()
})

for (const empty of ['services', 'professionals', 'slots'] as const) {
  test(`estado vacío: ${empty}`, async ({ page }) => {
    await mockApi(page, { empty })
    await page.goto('/reservar/salon')
    if (empty === 'services')
      await expect(page.getByText('Este negocio aún no tiene servicios disponibles.')).toBeVisible()
    else {
      await page.getByRole('button', { name: /Corte de cabello/ }).click()
      if (empty === 'professionals')
        await expect(page.getByText(/No hay profesionales disponibles/)).toBeVisible()
      else {
        await page.getByRole('button', { name: /Ana Pérez/ }).click()
        await expect(page.getByText(/No hay turnos disponibles/)).toBeVisible()
        await expect(page.getByLabel('Fecha', { exact: true })).toBeEnabled()
      }
    }
  })
}

test('error HTTP no se presenta como lista vacía y permite reintentar', async ({ page }) => {
  const options = { serviceError: true }
  await mockApi(page, options)
  await page.goto('/reservar/salon')
  await expect(page.getByRole('alert')).toContainText('HTTP 500')
  await expect(page.getByText('Este negocio aún no tiene servicios disponibles.')).toHaveCount(0)
  options.serviceError = false
  await page.getByRole('button', { name: 'Reintentar', exact: true }).click()
  await expect(page.getByRole('button', { name: /Corte de cabello/ })).toBeVisible()
})

test('409 informa conflicto, limpia turno y reconsulta disponibilidad', async ({ page }) => {
  const requests = await mockApi(page, {
    post: (route) => route.fulfill({ status: 409, json: {} }),
  })
  await review(page)
  const before = requests.filter((r) => r.path.includes('/availability')).length
  await page.getByRole('button', { name: 'Confirmar reserva', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Hay un conflicto')
  await expect
    .poll(() => requests.filter((r) => r.path.includes('/availability')).length)
    .toBeGreaterThan(before)
  await expect(page.getByRole('button', { name: '01:30, UTC-04:00', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  )
  await expect(page.getByRole('button', { name: 'Confirmar reserva', exact: true })).toHaveCount(0)
})

for (const failure of ['network', '500', 'invalid'] as const) {
  test(`resultado incierto ${failure}: reintento idéntico y bloqueo`, async ({ page }) => {
    const requests = await mockApi(page, {
      post: async (route, count) => {
        if (count > 1) return route.fulfill({ status: 201, json: receipt })
        if (failure === 'network') return route.abort('failed')
        return route.fulfill({ status: failure === '500' ? 500 : 201, json: {} })
      },
    })
    await review(page)
    await page.getByRole('button', { name: 'Confirmar reserva', exact: true }).click()
    await expect(page.getByText('El resultado es incierto.', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Editar datos' })).toBeDisabled()
    await expect(page.getByLabel('Fecha', { exact: true })).toBeDisabled()
    await expect(page.getByRole('button', { name: /Corte de cabello/ })).toBeDisabled()
    await page.getByRole('link', { name: 'Horly, inicio' }).click()
    await expect(page.getByRole('alertdialog')).toBeVisible()
    await page.getByRole('button', { name: 'Permanecer aquí' }).click()
    expect(requests.filter((r) => r.body)).toHaveLength(1)
    await page.getByRole('button', { name: 'Reintentar el mismo intento' }).click()
    await expect(page.getByRole('heading', { name: 'Tu reserva ha sido registrada' })).toBeVisible()
    const posts = requests.filter((r) => r.body)
    expect(posts).toHaveLength(2)
    expect(posts[0].body).toBe(posts[1].body)
  })
}

test('429 espera, no reintenta automáticamente y conserva payload y clave', async ({ page }) => {
  const requests = await mockApi(page, {
    post: (route, count) =>
      count === 1
        ? route.fulfill({
            status: 429,
            headers: {
              'Retry-After': '2',
              'Access-Control-Expose-Headers': 'Retry-After',
            },
            json: {
              status: 429,
              code: 'PUBLIC_BOOKING_RATE_LIMIT',
              message: 'Demasiados intentos. Espera antes de volver a intentar.',
              retryAfterSeconds: 45,
            },
          })
        : route.fulfill({ status: 201, json: receipt }),
  })
  await review(page)
  await page.getByRole('button', { name: 'Confirmar reserva', exact: true }).click()

  const countdown = page.getByText('Demasiados intentos. Puedes reintentar en 2 segundos')
  await expect(countdown).toBeVisible()
  await expect(countdown).not.toHaveAttribute('role')
  await expect(countdown).not.toHaveAttribute('aria-live')
  await expect(page.getByRole('status')).toHaveCount(1)
  const retry = page.getByRole('button', { name: 'Reintentar el mismo intento' })
  await expect(retry).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Editar datos' })).toBeDisabled()

  await page.clock.fastForward(1_000)
  await expect(page.getByText('Demasiados intentos. Puedes reintentar en 1 segundos')).toBeVisible()
  expect(requests.filter((request) => request.body)).toHaveLength(1)
  await page.clock.fastForward(1_100)
  await expect(retry).toBeEnabled()
  expect(requests.filter((request) => request.body)).toHaveLength(1)

  await retry.click()
  await expect(page.getByRole('heading', { name: 'Tu reserva ha sido registrada' })).toBeVisible()
  const posts = requests.filter((request) => request.body)
  expect(posts).toHaveLength(2)
  expect(posts[0].body).toBe(posts[1].body)
})

test('429 usa retryAfterSeconds cuando Retry-After es inválido', async ({ page }) => {
  await mockApi(page, {
    post: (route) =>
      route.fulfill({
        status: 429,
        headers: { 'Retry-After': 'no-es-valido' },
        json: { retryAfterSeconds: 45 },
      }),
  })
  await review(page)
  await page.getByRole('button', { name: 'Confirmar reserva', exact: true }).click()
  await expect(
    page.getByText('Demasiados intentos. Puedes reintentar en 45 segundos'),
  ).toBeVisible()
})

for (const response of ['vacía', 'inválida'] as const) {
  test(`429 conserva su tipo con respuesta ${response} y aplica 60 segundos`, async ({ page }) => {
    await mockApi(page, {
      post: (route) =>
        route.fulfill({
          status: 429,
          ...(response === 'inválida' ? { headers: { 'Retry-After': 'mañana' } } : {}),
          body: response === 'vacía' ? '' : '{json-inválido',
        }),
    })
    await review(page)
    await page.getByRole('button', { name: 'Confirmar reserva', exact: true }).click()
    await expect(
      page.getByText('Demasiados intentos. Puedes reintentar en 60 segundos'),
    ).toBeVisible()
    await expect(page.getByText('La respuesta del servidor no es válida.')).toHaveCount(0)
  })
}

test('429 admite una fecha HTTP en Retry-After', async ({ page }) => {
  await mockApi(page, {
    post: (route) =>
      route.fulfill({
        status: 429,
        headers: {
          'Retry-After': 'Sun, 01 Nov 2026 02:02:00 GMT',
          'Access-Control-Expose-Headers': 'Retry-After',
        },
        body: '',
      }),
  })
  await review(page)
  await page.getByRole('button', { name: 'Confirmar reserva', exact: true }).click()
  await expect(
    page.getByText(/Demasiados intentos\. Puedes reintentar en 1(?:1\d|20) segundos/),
  ).toBeVisible()
})

test('un 429 posterior conserva un resultado incierto anterior', async ({ page }) => {
  const requests = await mockApi(page, {
    post: (route, count) => {
      if (count === 1) return route.abort('failed')
      if (count === 2)
        return route.fulfill({
          status: 429,
          headers: {
            'Retry-After': '1',
            'Access-Control-Expose-Headers': 'Retry-After',
          },
          body: '',
        })
      return route.fulfill({ status: 201, json: receipt })
    },
  })
  await review(page)
  await page.getByRole('button', { name: 'Confirmar reserva', exact: true }).click()
  await expect(page.getByText('El resultado es incierto.', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Reintentar el mismo intento' }).click()
  await expect(page.getByText('Demasiados intentos. Puedes reintentar en 1 segundos')).toBeVisible()
  await expect(page.getByText('El resultado es incierto.', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Editar datos' })).toBeDisabled()
  expect(requests.filter((request) => request.body)).toHaveLength(2)

  await page.clock.fastForward(1_100)
  expect(requests.filter((request) => request.body)).toHaveLength(2)
  await page.getByRole('button', { name: 'Reintentar el mismo intento' }).click()
  await expect(page.getByRole('heading', { name: 'Tu reserva ha sido registrada' })).toBeVisible()
  const posts = requests.filter((request) => request.body)
  expect(posts).toHaveLength(3)
  expect(new Set(posts.map((request) => request.body)).size).toBe(1)
})

test('zona del negocio, límites locales y horas repetidas por DST', async ({ page }) => {
  const requests = await mockApi(page)
  await selectService(page)
  await page.getByRole('button', { name: /Ana Pérez/ }).click()
  const date = page.getByLabel('Fecha', { exact: true })
  await expect(date).toHaveValue('2026-10-31')
  await expect(date).toHaveAttribute('min', '2026-10-31')
  await expect(date).toHaveAttribute('max', '2027-01-29')
  await date.fill('2026-11-01')
  await expect(page.getByRole('button', { name: '01:30, UTC-04:00', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '01:30, UTC-05:00', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '10:30', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '10:30', exact: true })).not.toContainText('UTC')
  await expect(page.getByText('Todas las horas corresponden a America/New_York.')).toBeVisible()
  expect(requests.some((r) => r.path.includes('date=2026-11-01'))).toBe(true)
})

test('descarta respuestas atrasadas al cambiar de negocio sin recargar', async ({ page }) => {
  await mockApi(page)
  let release!: () => void
  let arrived!: () => void
  const received = new Promise<void>((resolve) => {
    arrived = resolve
  })
  const delayed = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route('**/api/public/businesses/salon/services', async (route) => {
    arrived()
    await delayed
    await route
      .fulfill({ json: [{ ...service, name: 'Servicio anterior atrasado' }] })
      .catch(() => {})
  })
  await page.goto('/reservar/salon')
  await received
  await page.evaluate(() => {
    window.history.pushState(
      { ...window.history.state, idx: window.history.state.idx + 1 },
      '',
      '/reservar/otro',
    )
    window.dispatchEvent(new PopStateEvent('popstate'))
  })
  await expect(page.getByRole('heading', { name: 'Otro negocio' })).toBeVisible()
  release()
  await expect(page.getByRole('button', { name: /Corte de cabello/ })).toBeVisible()
  await expect(page.getByText('Servicio anterior atrasado')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Salón Horly' })).toHaveCount(0)
})

test('validación de contacto, longitudes y limpieza al cambiar selección', async ({ page }) => {
  await mockApi(page)
  await selectSlot(page)
  await page.getByLabel('Nombre completo').fill('Pablo')
  await expect(page.getByLabel('Nombre completo')).toHaveAttribute('maxlength', '150')
  await expect(page.getByLabel('Correo electrónico')).toHaveAttribute('maxlength', '254')
  await expect(page.getByLabel('Teléfono', { exact: true })).toHaveAttribute('maxlength', '30')
  await expect(page.getByLabel('Notas')).toHaveAttribute('maxlength', '1000')
  await page.getByRole('button', { name: 'Revisar reserva' }).click()
  await expect(page.getByRole('alert')).toContainText('al menos un correo o teléfono')
  await page.getByLabel('Correo electrónico').fill('no-es-correo')
  await page.getByRole('button', { name: 'Revisar reserva' }).click()
  await expect(page.getByRole('heading', { name: 'Revisa tu reserva' })).toHaveCount(0)
  await page.getByLabel('Fecha', { exact: true }).fill('2026-11-02')
  await expect(page.getByLabel('Nombre completo')).toHaveCount(0)
  await page.getByRole('button', { name: /Corte de cabello/ }).click()
  await expect(page.getByLabel('Fecha', { exact: true })).toHaveCount(0)
})

test('inicio y ruta inexistente', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Un momento para ti.' })).toBeVisible()
  await page.goto('/no-existe')
  await expect(page.getByRole('heading', { name: 'No encontramos esta página' })).toBeVisible()
})
