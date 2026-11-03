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
  turnstile?: 'auto' | 'error' | 'script-blocked'
  businessImages?: { logoImageUrl: string | null; coverImageUrl: string | null }
  otherBusinessImages?: { logoImageUrl: string | null; coverImageUrl: string | null }
  imageFailures?: Array<'logo' | 'cover' | 'other-logo' | 'other-cover'>
  bookingReceipt?: typeof receipt
  businessDetails?: Partial<{
    name: string
    address: string | null
    timeZone: string
  }>
}

async function mockApi(page: Page, options: MockOptions = {}) {
  const requests: {
    path: string
    authorization: string | undefined
    turnstileToken: string | undefined
    body: string | null
  }[] = []
  let posts = 0
  await page.clock.install({ time: new Date('2026-11-01T02:00:00Z') })
  await page.route('https://images.test/**', (route) => {
    const imageName = new URL(route.request().url()).pathname.slice(1).replace('.svg', '')
    if (
      options.imageFailures?.includes(
        imageName as NonNullable<MockOptions['imageFailures']>[number],
      )
    )
      return route.abort('failed')
    return route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="300"><rect width="100%" height="100%" fill="#d9d6ff"/></svg>',
    })
  })
  if (options.turnstile === 'script-blocked') {
    await page.route(
      'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit',
      (route) => route.abort('blockedbyclient'),
    )
  } else {
    await page.addInitScript(
      ({ mode }) => {
        type WidgetOptions = {
          action: string
          language: string
          callback: (token: string) => void
          'expired-callback': () => void
          'error-callback': () => void
        }
        let widgetOptions: WidgetOptions | undefined
        let tokenNumber = 0
        const solve = () => {
          tokenNumber++
          widgetOptions?.callback(`simulated-turnstile-token-${tokenNumber}`)
        }
        window.turnstile = {
          render: (container, receivedOptions) => {
            widgetOptions = receivedOptions
            Object.assign(window, {
              __turnstileConfiguration: {
                action: receivedOptions.action,
                language: receivedOptions.language,
              },
            })
            container.textContent = 'Widget Turnstile simulado'
            queueMicrotask(() => {
              if (mode === 'error') widgetOptions?.['error-callback']()
              else solve()
            })
            return 'simulated-widget'
          },
          reset: () => queueMicrotask(solve),
          remove: () => undefined,
        }
        Object.assign(window, {
          __turnstileExpire: () => widgetOptions?.['expired-callback'](),
        })
      },
      { mode: options.turnstile ?? 'auto' },
    )
  }
  await page.route('**/api/public/businesses/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname
    requests.push({
      path: `${path}${url.search}`,
      authorization: request.headers().authorization,
      turnstileToken: request.headers()['x-turnstile-token'],
      body: request.postData(),
    })
    const json = (body: unknown, status = 200) => route.fulfill({ status, json: body })
    if (path.endsWith('/bookings')) {
      posts++
      if (options.post) return options.post(route, posts)
      return json(options.bookingReceipt ?? receipt, 201)
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
    const isOther = path.endsWith('/otro')
    const images = isOther
      ? (options.otherBusinessImages ?? { logoImageUrl: null, coverImageUrl: null })
      : (options.businessImages ?? { logoImageUrl: null, coverImageUrl: null })
    return json({
      name: isOther ? 'Otro negocio' : 'Salón Horly',
      slug: path.split('/').at(-1),
      description: 'Tu espacio de cuidado',
      phone: null,
      address: 'Calle 10',
      timeZone: 'America/New_York',
      ...options.businessDetails,
      ...images,
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
  const calendarLink = page.getByRole('link', { name: 'Agregar a Google Calendar' })
  await expect(calendarLink).toBeVisible()
  await expect(calendarLink).toHaveAttribute('target', '_blank')
  await expect(calendarLink).toHaveAttribute('rel', 'noopener noreferrer')
  await expect(calendarLink).toHaveAttribute('referrerpolicy', 'no-referrer')
  await expect(
    page.getByText('Se abrirá Google Calendar para que guardes el evento.'),
  ).toBeVisible()
  await expect(
    page.getByText(
      'Los cambios o cancelaciones de la reserva no se sincronizan automáticamente con tu calendario.',
    ),
  ).toBeVisible()
  const calendarUrl = new URL((await calendarLink.getAttribute('href'))!)
  expect(`${calendarUrl.origin}${calendarUrl.pathname}`).toBe(
    'https://calendar.google.com/calendar/render',
  )
  expect(Object.fromEntries(calendarUrl.searchParams)).toEqual({
    action: 'TEMPLATE',
    text: 'Reserva en Salón Horly',
    dates: '20261101T053000Z/20261101T060000Z',
    details: 'Reserva confirmada en Horly. Referencia: reservation-real-response',
    ctz: 'America/New_York',
    location: 'Calle 10',
  })
  expect(calendarUrl.toString()).not.toMatch(
    /Pablo Cliente|pablo%40example\.com|simulated-turnstile-token|Corte confirmado/,
  )
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
  expect(requests.find((request) => request.body)?.turnstileToken).toMatch(
    /^simulated-turnstile-token-/,
  )
  await expect
    .poll(() =>
      page.evaluate(() => {
        const configuredWindow = window as typeof window & {
          __turnstileConfiguration: { action: string; language: string }
        }
        return configuredWindow.__turnstileConfiguration
      }),
    )
    .toEqual({ action: 'create_booking', language: 'es' })
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

test('calendario codifica caracteres especiales y cruza el día en UTC', async ({ page }) => {
  await mockApi(page, {
    businessDetails: {
      name: 'Clínica Ágil & Spa',
      address: 'C/ Peñón, 2.º – Málaga',
    },
    bookingReceipt: {
      ...receipt,
      startsAt: '2026-03-08T19:30:00-04:00',
      endsAt: '2026-03-08T21:00:00-04:00',
    },
  })
  await selectSlot(page)
  await page.getByLabel('Nombre completo').fill('Álvaro Cliente')
  await page.getByLabel('Correo electrónico').fill('alvaro@example.com')
  await page.getByLabel('Teléfono', { exact: true }).fill('+34 600 123 456')
  await page.getByLabel('Notas').fill('Nota clínica privada')
  await page.getByRole('button', { name: 'Revisar reserva' }).click()
  await page.getByRole('button', { name: 'Confirmar reserva', exact: true }).click()

  const href = await page
    .getByRole('link', { name: 'Agregar a Google Calendar' })
    .getAttribute('href')
  const url = new URL(href!)
  expect(url.searchParams.get('text')).toBe('Reserva en Clínica Ágil & Spa')
  expect(url.searchParams.get('location')).toBe('C/ Peñón, 2.º – Málaga')
  expect(url.searchParams.get('dates')).toBe('20260308T233000Z/20260309T010000Z')
  expect(url.searchParams.get('ctz')).toBe('America/New_York')
  expect(decodeURIComponent(href!)).not.toMatch(
    /Álvaro Cliente|alvaro@example\.com|600 123 456|Nota clínica privada|simulated-turnstile-token/,
  )
})

for (const status of ['PENDING', 'CANCELLED'] as const) {
  test(`no ofrece calendario para una respuesta ${status}`, async ({ page }) => {
    await mockApi(page, { bookingReceipt: { ...receipt, status } })
    await review(page)
    await page.getByRole('button', { name: 'Confirmar reserva', exact: true }).click()
    await expect(page.getByText(status, { exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Agregar a Google Calendar' })).toHaveCount(0)
  })
}

test('no ofrece calendario durante el envío pendiente', async ({ page }) => {
  let complete!: () => void
  const pending = new Promise<void>((resolve) => {
    complete = resolve
  })
  await mockApi(page, {
    post: async (route) => {
      await pending
      await route.fulfill({ status: 201, json: receipt })
    },
  })
  await review(page)
  await page.getByRole('button', { name: 'Confirmar reserva', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Confirmando…' })).toBeDisabled()
  await expect(page.getByRole('link', { name: 'Agregar a Google Calendar' })).toHaveCount(0)
  complete()
  await expect(page.getByRole('link', { name: 'Agregar a Google Calendar' })).toBeVisible()
})

test('datos temporales inválidos producen incertidumbre y no un enlace', async ({ page }) => {
  await mockApi(page, {
    bookingReceipt: {
      ...receipt,
      startsAt: '2026-11-01T02:00:00-05:00',
      endsAt: '2026-11-01T01:30:00-05:00',
    },
  })
  await review(page)
  await page.getByRole('button', { name: 'Confirmar reserva', exact: true }).click()
  await expect(page.getByText('El resultado es incierto.', { exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Agregar a Google Calendar' })).toHaveCount(0)
})

test('descarta el calendario anterior al cambiar de negocio', async ({ page }) => {
  await mockApi(page)
  await review(page)
  await page.getByRole('button', { name: 'Confirmar reserva', exact: true }).click()
  await expect(page.getByRole('link', { name: 'Agregar a Google Calendar' })).toBeVisible()

  await page.evaluate(() => {
    window.history.pushState(
      { ...window.history.state, idx: window.history.state.idx + 1 },
      '',
      '/reservar/otro',
    )
    window.dispatchEvent(new PopStateEvent('popstate'))
  })
  await expect(page.getByRole('link', { name: 'Agregar a Google Calendar' })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Otro negocio' })).toBeVisible()
})

test('slug inexistente', async ({ page }) => {
  await mockApi(page, { missing: true })
  await page.goto('/reservar/no-existe')
  await expect(page.getByRole('heading', { name: 'Negocio no encontrado' })).toBeVisible()
})

test('muestra logo y banner públicos con presentación responsive', async ({ page }) => {
  await mockApi(page, {
    businessImages: {
      logoImageUrl: 'https://images.test/logo.svg',
      coverImageUrl: 'https://images.test/cover.svg',
    },
  })
  await page.goto('/reservar/salon')

  const logo = page.getByAltText('Logo de Salón Horly')
  const cover = page.getByTestId('business-cover').locator('img')
  await expect(logo).toBeVisible()
  await expect(logo).toHaveAttribute('src', 'https://images.test/logo.svg')
  await expect(cover).toBeVisible()
  await expect(cover).toHaveAttribute('src', 'https://images.test/cover.svg')
  expect(await logo.evaluate((element) => getComputedStyle(element).objectFit)).toBe('contain')
  expect(await cover.evaluate((element) => getComputedStyle(element).objectFit)).toBe('cover')

  const coverBox = await page.getByTestId('business-cover').boundingBox()
  const logoBox = await page.getByTestId('business-logo').boundingBox()
  expect(coverBox?.height).toBeGreaterThanOrEqual(150)
  expect(logoBox?.width).toBeGreaterThanOrEqual(60)
  expect(logoBox?.height).toBe(logoBox?.width)
})

test('campos de imagen null muestran banner predeterminado e iniciales', async ({ page }) => {
  await mockApi(page)
  await page.goto('/reservar/salon')
  await expect(page.getByTestId('business-cover')).toHaveClass(/business-hero__cover--fallback/)
  await expect(page.getByTestId('business-cover').locator('img')).toHaveCount(0)
  await expect(page.getByTestId('business-logo')).toHaveClass(/business-hero__logo--fallback/)
  await expect(page.getByTestId('business-logo')).toContainText('SH')
  await expect(page.getByAltText('Logo de Salón Horly')).toHaveCount(0)
})

test('fallos de logo y banner usan fallbacks y no bloquean la reserva', async ({ page }) => {
  await mockApi(page, {
    businessImages: {
      logoImageUrl: 'https://images.test/logo.svg',
      coverImageUrl: 'https://images.test/cover.svg',
    },
    imageFailures: ['logo', 'cover'],
  })
  await review(page)
  await expect(page.getByTestId('business-cover')).toHaveClass(/business-hero__cover--fallback/)
  await expect(page.getByTestId('business-logo')).toHaveClass(/business-hero__logo--fallback/)
  await expect(page.getByTestId('business-logo')).toContainText('SH')
  await page.getByRole('button', { name: 'Confirmar reserva', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Tu reserva ha sido registrada' })).toBeVisible()
})

test('al cambiar de negocio descarta imágenes anteriores y reinicia URLs y errores', async ({
  page,
}) => {
  await mockApi(page, {
    businessImages: {
      logoImageUrl: 'https://images.test/logo.svg',
      coverImageUrl: 'https://images.test/cover.svg',
    },
    otherBusinessImages: {
      logoImageUrl: 'https://images.test/other-logo.svg',
      coverImageUrl: 'https://images.test/other-cover.svg',
    },
    imageFailures: ['logo'],
  })
  await page.goto('/reservar/salon')
  await expect(page.getByTestId('business-logo')).toHaveClass(/business-hero__logo--fallback/)
  await expect(page.locator('img[src="https://images.test/cover.svg"]')).toBeVisible()

  let release!: () => void
  let arrived!: () => void
  const received = new Promise<void>((resolve) => {
    arrived = resolve
  })
  const delayed = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route('**/api/public/businesses/otro', async (route) => {
    arrived()
    await delayed
    await route.fulfill({
      json: {
        name: 'Otro negocio',
        slug: 'otro',
        description: 'Otra identidad',
        phone: null,
        address: 'Calle 20',
        timeZone: 'America/New_York',
        logoImageUrl: 'https://images.test/other-logo.svg',
        coverImageUrl: 'https://images.test/other-cover.svg',
      },
    })
  })
  await page.evaluate(() => {
    window.history.pushState(
      { ...window.history.state, idx: window.history.state.idx + 1 },
      '',
      '/reservar/otro',
    )
    window.dispatchEvent(new PopStateEvent('popstate'))
  })
  await received
  await expect(page.getByTestId('business-logo')).toHaveCount(0)
  await expect(page.locator('img[src="https://images.test/cover.svg"]')).toHaveCount(0)
  release()

  await expect(page.getByAltText('Logo de Otro negocio')).toHaveAttribute(
    'src',
    'https://images.test/other-logo.svg',
  )
  await expect(page.getByTestId('business-cover').locator('img')).toHaveAttribute(
    'src',
    'https://images.test/other-cover.svg',
  )
  await expect(page.getByRole('heading', { name: 'Salón Horly' })).toHaveCount(0)
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

for (const failure of ['network', '503', 'invalid'] as const) {
  test(`resultado incierto ${failure}: reintento idéntico y bloqueo`, async ({ page }) => {
    const requests = await mockApi(page, {
      post: async (route, count) => {
        if (count > 1) return route.fulfill({ status: 201, json: receipt })
        if (failure === 'network') return route.abort('failed')
        return route.fulfill({ status: failure === '503' ? 503 : 201, json: {} })
      },
    })
    await review(page)
    await page.getByRole('button', { name: 'Confirmar reserva', exact: true }).click()
    await expect(page.getByText('El resultado es incierto.', { exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Agregar a Google Calendar' })).toHaveCount(0)
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
    expect(posts[0].turnstileToken).not.toBe(posts[1].turnstileToken)
  })
}

test('Turnstile bloquea confirmación al expirar y permite completar uno nuevo', async ({
  page,
}) => {
  const requests = await mockApi(page)
  await review(page)
  await expect(page.getByRole('button', { name: 'Confirmar reserva', exact: true })).toBeEnabled()
  await page.evaluate(() => {
    const controls = window as typeof window & { __turnstileExpire: () => void }
    controls.__turnstileExpire()
  })
  await expect(page.getByText('La verificación ha caducado. Complétala nuevamente.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Completa la verificación' })).toBeDisabled()
  expect(requests.filter((request) => request.body)).toHaveLength(0)
  await page.getByRole('button', { name: 'Reiniciar verificación' }).click()
  await expect(page.getByRole('button', { name: 'Confirmar reserva', exact: true })).toBeEnabled()
})

test('error del widget mantiene bloqueado el POST y permite reintentar su carga', async ({
  page,
}) => {
  const requests = await mockApi(page, { turnstile: 'error' })
  await review(page)
  await expect(
    page.getByText('No se pudo cargar o completar la verificación de seguridad.'),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: 'Completa la verificación' })).toBeDisabled()
  await page.getByRole('button', { name: 'Reintentar verificación' }).click()
  await expect(
    page.getByText('No se pudo cargar o completar la verificación de seguridad.'),
  ).toBeVisible()
  expect(requests.filter((request) => request.body)).toHaveLength(0)
})

test('script de Turnstile bloqueado muestra error y nunca omite la verificación', async ({
  page,
}) => {
  const requests = await mockApi(page, { turnstile: 'script-blocked' })
  await review(page)
  await expect(
    page.getByText('No se pudo cargar o completar la verificación de seguridad.'),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: 'Completa la verificación' })).toBeDisabled()
  await page.getByRole('button', { name: 'Reintentar verificación' }).click()
  await expect(
    page.getByText('No se pudo cargar o completar la verificación de seguridad.'),
  ).toBeVisible()
  expect(requests.filter((request) => request.body)).toHaveLength(0)
})

test('403 exige otro Turnstile sin perder incertidumbre, clave ni cuerpo', async ({ page }) => {
  const requests = await mockApi(page, {
    post: (route, count) => {
      if (count === 1) return route.abort('failed')
      if (count === 2) return route.fulfill({ status: 403, json: {} })
      return route.fulfill({ status: 201, json: receipt })
    },
  })
  await review(page)
  await page.getByRole('button', { name: 'Confirmar reserva', exact: true }).click()
  await expect(page.getByText('El resultado es incierto.', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Reintentar el mismo intento' }).click()
  await expect(
    page.getByText(
      'La verificación de seguridad fue rechazada. Complétala nuevamente para reintentar.',
    ),
  ).toBeVisible()
  await expect(page.getByText('El resultado es incierto.', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Editar datos' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Reintentar el mismo intento' })).toBeEnabled()
  await page.getByRole('button', { name: 'Reintentar el mismo intento' }).click()
  await expect(page.getByRole('heading', { name: 'Tu reserva ha sido registrada' })).toBeVisible()
  const posts = requests.filter((request) => request.body)
  expect(posts).toHaveLength(3)
  expect(new Set(posts.map((request) => request.body)).size).toBe(1)
  expect(new Set(posts.map((request) => request.turnstileToken)).size).toBe(3)
})

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
  expect(posts[0].turnstileToken).not.toBe(posts[1].turnstileToken)
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
