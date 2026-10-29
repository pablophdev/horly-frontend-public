const SCRIPT_ID = 'cloudflare-turnstile-script'
const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

export type TurnstileOptions = {
  sitekey: string
  action: 'create_booking'
  language: 'es'
  size: 'flexible'
  callback: (token: string) => void
  'expired-callback': () => void
  'error-callback': () => void
}

export type TurnstileApi = {
  render: (container: HTMLElement, options: TurnstileOptions) => string
  reset: (widgetId: string) => void
  remove: (widgetId: string) => void
}

declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

let loading: Promise<TurnstileApi> | undefined

export function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile)
  if (loading) return loading

  loading = new Promise<TurnstileApi>((resolve, reject) => {
    const previous = document.getElementById(SCRIPT_ID)
    previous?.remove()

    const script = document.createElement('script')
    script.id = SCRIPT_ID
    script.src = SCRIPT_URL
    script.async = true
    script.defer = true
    script.onload = () => {
      if (window.turnstile) resolve(window.turnstile)
      else reject(new Error('Turnstile no quedó disponible.'))
    }
    script.onerror = () => reject(new Error('No se pudo cargar Turnstile.'))
    document.head.appendChild(script)
  }).catch((error: unknown) => {
    document.getElementById(SCRIPT_ID)?.remove()
    loading = undefined
    throw error
  })

  return loading
}
