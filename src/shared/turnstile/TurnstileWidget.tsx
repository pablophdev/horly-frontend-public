import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { loadTurnstile } from './loadTurnstile'
import type { TurnstileApi } from './loadTurnstile'

export type TurnstileWidgetHandle = { reset: () => void }

type Status = 'loading' | 'ready' | 'verified' | 'expired' | 'error' | 'missing-config'

export const TurnstileWidget = forwardRef<
  TurnstileWidgetHandle,
  { onTokenChange: (token: string | null) => void }
>(function TurnstileWidget({ onTokenChange }, ref) {
  const siteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY?.trim()
  const container = useRef<HTMLDivElement>(null)
  const api = useRef<TurnstileApi | undefined>(undefined)
  const widgetId = useRef<string | undefined>(undefined)
  const [revision, setRevision] = useState(0)
  const [status, setStatus] = useState<Status>(siteKey ? 'loading' : 'missing-config')

  const reset = () => {
    onTokenChange(null)
    setStatus('ready')
    if (api.current && widgetId.current) api.current.reset(widgetId.current)
  }
  useImperativeHandle(ref, () => ({ reset }))

  useEffect(() => {
    if (!siteKey) {
      onTokenChange(null)
      return
    }
    let active = true
    let renderedId: string | undefined
    onTokenChange(null)

    loadTurnstile().then(
      (turnstile) => {
        if (!active || !container.current) return
        api.current = turnstile
        renderedId = turnstile.render(container.current, {
          sitekey: siteKey,
          action: 'create_booking',
          language: 'es',
          size: 'flexible',
          callback: (token) => {
            if (!active) return
            setStatus('verified')
            onTokenChange(token)
          },
          'expired-callback': () => {
            if (!active) return
            onTokenChange(null)
            setStatus('expired')
          },
          'error-callback': () => {
            if (!active) return
            onTokenChange(null)
            setStatus('error')
          },
        })
        widgetId.current = renderedId
        setStatus((current) => (current === 'loading' ? 'ready' : current))
      },
      () => {
        if (!active) return
        onTokenChange(null)
        setStatus('error')
      },
    )

    return () => {
      active = false
      if (renderedId) api.current?.remove(renderedId)
      if (widgetId.current === renderedId) widgetId.current = undefined
    }
  }, [siteKey, revision, onTokenChange])

  const retry = () => {
    onTokenChange(null)
    if (!siteKey) {
      setStatus('missing-config')
      return
    }
    if (widgetId.current) api.current?.remove(widgetId.current)
    widgetId.current = undefined
    setStatus('loading')
    setRevision((value) => value + 1)
  }

  return (
    <div className="turnstile-panel" aria-labelledby="turnstile-title">
      <strong id="turnstile-title">Verificación de seguridad</strong>
      <p>Completa la verificación para habilitar la confirmación.</p>
      <div ref={container} className="turnstile-widget" />
      {status === 'loading' && <p role="status">Cargando verificación…</p>}
      {status === 'verified' && <p className="turnstile-success">Verificación completada.</p>}
      {status === 'expired' && (
        <div className="notice warning" role="alert">
          <p>La verificación ha caducado. Complétala nuevamente.</p>
          <button type="button" onClick={retry}>
            Reiniciar verificación
          </button>
        </div>
      )}
      {(status === 'error' || status === 'missing-config') && (
        <div className="notice error" role="alert">
          <p>
            {status === 'missing-config'
              ? 'Falta configurar la clave pública de Turnstile.'
              : 'No se pudo cargar o completar la verificación de seguridad.'}
          </p>
          <button type="button" onClick={retry}>
            Reintentar verificación
          </button>
        </div>
      )}
    </div>
  )
})
