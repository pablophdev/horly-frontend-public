# horly-booking

Frontend público de reservas de Horly. React, TypeScript **~6.0.3**, React Compiler, Vite, React Router y Luxon. Sin autenticación: consume exclusivamente la API pública de Spring Boot.

## Instalación y ejecución

Requisitos: Node.js compatible con Vite 8 (20.19+ o 22.12+) y npm.

```sh
npm ci
cp .env.example .env.local
npm run dev
```

En PowerShell, usa `Copy-Item .env.example .env.local`. Si la política de ejecución bloquea `npm.ps1`, utiliza `npm.cmd` y `npx.cmd`.

Vite escucha en **http://localhost:5173**, con `strictPort: true`: falla si el puerto está ocupado, en lugar de cambiar el origen silenciosamente. En esta máquina se encontró el panel administrativo usando ese puerto. Puedes detenerlo tú para usar la configuración CORS actual con la web pública, o iniciar esta web con `npm run dev -- --port 5174`. En ese caso, el backend debe permitir exactamente **http://localhost:5174** en CORS. No se ha modificado el backend.

```sh
npm run build
npm run lint
npm run preview
```

`preview` es para inspeccionar el build; su origen predeterminado es `http://localhost:4173`, que también necesita autorización CORS si se conecta al backend. En producción, configura el hosting para devolver `index.html` en rutas del cliente.

## Variables de entorno

`.env.example` contiene:

```dotenv
VITE_API_URL=http://localhost:8080
VITE_TURNSTILE_SITE_KEY=
```

`VITE_API_URL` representa el **origen del backend**, sin `/api`. El cliente elimina barras finales y añade `/api` a las rutas. `VITE_TURNSTILE_SITE_KEY` debe contener la Site Key pública de Cloudflare Turnstile correspondiente al dominio. La Secret Key pertenece únicamente al backend y nunca debe incluirse en este repositorio, `.env.local` ni ninguna variable `VITE_*`: todas son públicas e incorporadas al build. Los archivos `.env*` locales están ignorados, excepto `.env.example`. Reiniciar Vite tras cambiar la configuración.

## Arquitectura por features

```text
src/
  app/                         # Router, layout público y estilos de marca
  features/
    booking/
      api.ts                   # Contratos, validación runtime y endpoints públicos
      BookingPage.tsx          # Negocio, servicios, profesionales y disponibilidad
      format.ts                # Precio, zona IANA y desfase UTC
      components/Checkout.tsx  # Cliente, resumen, intento idempotente y comprobante
  shared/
    api/http.ts                # Transporte, errores HTTP/conexión/respuesta inválida
    hooks/useResource.ts       # Consultas cancelables y descarte de datos antiguos
    turnstile/                 # Cargador singleton y widget explícito de Cloudflare
    ui/                        # Estados y diálogo accesible de abandono
e2e/                           # Pruebas Playwright con mocks HTTP
```

Se consultaron en lectura los estilos del panel `horly-frontend`, especialmente `src/index.css`, `app/styles/theme.css` y `features/settings/components/BusinessPreview.css`. Se reutilizaron sus valores visuales: Montserrat, violeta `#5c55ee`, fondo `#f8f9fc`, bordes `#e4e7f1`, superficies blancas y avisos lavanda. La fuente se sirve localmente mediante Fontsource. El layout es específico para clientes y prioriza móvil.

## Rutas y endpoints

- `/`: indica que hace falta el enlace del negocio; no lista negocios.
- `/reservar/:slug`: flujo completo de reservas.
- Cualquier otra ruta: página no encontrada.

Todas las rutas de API comienzan por `/api/public/businesses/{slug}`:

| Método | Sufijo                                                       | Uso                                                    |
| ------ | ------------------------------------------------------------ | ------------------------------------------------------ |
| GET    | (ninguno)                                                    | Información y zona horaria del negocio                 |
| GET    | `/services`                                                  | Servicios, array directo                               |
| GET    | `/professionals?serviceId=…`                                 | Profesionales del servicio, array directo              |
| GET    | `/availability?professionalId=…&serviceId=…&date=YYYY-MM-DD` | Turnos ofrecidos por el backend                        |
| POST   | `/bookings`                                                  | Crear o recuperar el resultado de un intento; HTTP 201 |

Slug codificado con `encodeURIComponent`, parámetros con `URLSearchParams`, sin `Authorization` y con `credentials: 'omit'`. El POST añade el token efímero exclusivamente en `X-Turnstile-Token`; el JSON mantiene su contrato. No hay datos demo en la aplicación, SDK de Supabase ni acceso a base de datos.

## Comportamiento de reservas

- Cambiar negocio remonta la feature y limpia todos sus datos. Las consultas usan `AbortController` y descartan respuestas obsoletas. Cambiar servicio limpia profesional y turno; cambiar profesional o fecha limpia turno.
- Hoy y el máximo de 90 días se calculan con Luxon en la zona IANA del negocio. `date` viaja sin conversión UTC y `startsAt` conserva exactamente el string del slot. El desfase UTC solo aparece para diferenciar horas locales repetidas por DST. No se generan turnos en React.
- Nombre obligatorio (150), correo válido si se proporciona (254), teléfono (30), notas (1000); al menos correo o teléfono. Opcionales vacíos se envían como `null`.
- El resumen precede al POST. Este solo envía los campos del contrato: clave, profesional, servicio, inicio y datos del cliente. El comprobante usa los valores devueltos por el backend, incluido precio, duración y estado.
- Cada intento genera un `crypto.randomUUID()`. El envío queda bloqueado mientras está en curso. Red, 5xx o respuesta inválida producen resultado incierto: clave y payload quedan en memoria, se bloquea la edición y solo se permite reintento manual idéntico. No hay reintentos automáticos.
- La navegación interna pide confirmación mediante diálogo modal; recargar, cerrar o salir del documento usa la advertencia nativa `beforeunload` (el navegador decide su texto y presentación). Al abandonar se pierde el intento en memoria. No se persisten datos personales en almacenamiento local.
- 409 muestra conflicto, limpia el turno y reconsulta disponibilidad automáticamente. 400 y 404 tienen mensajes específicos sin atribuir causas desconocidas. Tras éxito se vuelve a consultar disponibilidad y se exige “Crear otra reserva” para iniciar un flujo nuevo.
- 429 conserva la clave y el payload exactos, bloquea edición y envío durante la espera y habilita después un reintento exclusivamente manual. Se prioriza `Retry-After` (segundos o fecha HTTP), después `retryAfterSeconds` del JSON y finalmente 60 segundos. La cuenta usa un instante límite, no acumula intervalos, y no elimina una incertidumbre previa. Para que JavaScript pueda leer `Retry-After` en una petición CORS, el backend debe exponerlo con `Access-Control-Expose-Headers: Retry-After`; si no lo hace, se usa el cuerpo o el fallback. No se ha modificado el backend.
- Turnstile usa el script oficial con renderizado explícito, acción `create_booking` e idioma español. Sin configuración o ante bloqueo/error del script no existe bypass: confirmar permanece deshabilitado y se ofrece recargar la verificación. Cada POST consume su token; al finalizar la petición o fallar la red, se descarta y reinicia el widget. El nuevo token nunca cambia la clave ni el cuerpo congelado, no se persiste y no se registra. Un 403 solicita otra verificación sin dirigir a login ni eliminar una incertidumbre previa.
- Seleccionar horario no bloquea el turno. Confirmar no representa un pago.

## Pruebas E2E con mocks

```sh
npx playwright install chromium
npm run test:e2e
```

Playwright inicia su propio Vite en **http://localhost:5174**, con puerto estricto, una Site Key pública de pruebas y sin reutilizar servidores existentes. Los endpoints y Turnstile se simulan dentro del navegador: estas pruebas no contactan Cloudflare, no requieren Spring Boot y no acreditan su integración, validación criptográfica ni CORS. Se ejecutan en Chromium escritorio y Chromium con viewport/táctil móvil (no es Safari), con zona del navegador `Asia/Tokyo` y negocio `America/New_York`.

Cobertura: recorrido completo, encabezado Turnstile y payload permitido, configuración `action`/idioma, expiración, error y bloqueo del script, 403, renovación de token con clave/cuerpo idénticos tras red/503, 429 sin POST automático, comprobante del backend, ausencia de Authorization, slug inexistente, listas vacías, conflictos, respuestas inválidas y atrasadas, abandono, zonas horarias, DST, validaciones, inicio y 404.

## Verificación con Spring Boot real (manual)

1. Arrancar el backend existente en `http://localhost:8080`, con un negocio real que tenga servicio, profesional asociado y horarios disponibles. Obtener su slug desde la configuración del negocio.
2. Crear un widget Turnstile para el hostname real y colocar **solo su Site Key** en `VITE_TURNSTILE_SITE_KEY` dentro de `.env.local`. Configurar la Secret Key exclusivamente en el backend mediante su mecanismo seguro existente.
3. Arrancar esta web en `http://localhost:5173`. Si se elige `5174`, añadir antes `http://localhost:5174` a los orígenes permitidos por el backend. El preflight `OPTIONS` del POST debe permitir `Content-Type` y `X-Turnstile-Token`. Si se usa `Retry-After`, exponerlo como se describe arriba.
4. Abrir `/reservar/SLUG_REAL`. En Network, comprobar los GET reales, sus parámetros y ausencia de Authorization. Verificar que un fallo CORS/conexión aparece como error, no como lista vacía.
5. Elegir servicio, profesional, fecha y slot real. Completar contacto y resolver el widget. Comprobar que el POST contiene `X-Turnstile-Token`, que el token no aparece en el JSON y que HTTP 201 produce el comprobante. Verificar la reserva desde el panel administrativo existente.
6. Comprobar expiración, token rechazado (403) y bloqueo del dominio de challenges en un entorno de pruebas. Confirmar que se pide una nueva verificación y nunca se dirige a login ni se envía sin token.
7. Comprobar que la disponibilidad se reconsulta tras éxito. Usar “Crear otra reserva” para comenzar otro intento.
8. Para probar idempotencia real, repetir controladamente el mismo POST con la misma clave y cuerpo pero un token Turnstile nuevo en un entorno de pruebas: debe devolver HTTP 201 y el mismo identificador, sin crear otra reserva. Para probar conflicto, intentar reservar un turno que otro cliente haya ocupado mientras se revisaba el resumen.
9. Probar desde un navegador cuya zona sea diferente a la del negocio y comprobar fecha, hora y desfase en el resumen y comprobante.

**La verificación con Spring Boot real no se ha realizado durante esta implementación.** Los resultados automatizados corresponden a mocks HTTP. No se implementan pagos, cancelación pública, consulta de reservas previas, envío de correos, cuentas ni funciones administrativas.
