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
```

Representa el **origen del backend**, sin `/api`. El cliente elimina barras finales y añade `/api` a las rutas. No introducir secretos en variables `VITE_*`: son públicas e incorporadas al build. Los archivos `.env*` locales están ignorados, excepto `.env.example`. Reiniciar Vite tras cambiar la configuración.

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

Slug codificado con `encodeURIComponent`, parámetros con `URLSearchParams`, sin `Authorization` y con `credentials: 'omit'`. No hay datos demo en la aplicación, SDK de Supabase ni acceso a base de datos.

## Comportamiento de reservas

- Cambiar negocio remonta la feature y limpia todos sus datos. Las consultas usan `AbortController` y descartan respuestas obsoletas. Cambiar servicio limpia profesional y turno; cambiar profesional o fecha limpia turno.
- Hoy y el máximo de 90 días se calculan con Luxon en la zona IANA del negocio. `date` viaja sin conversión UTC y `startsAt` conserva exactamente el string del slot. Las horas muestran su desfase UTC, incluso en horas repetidas por DST. No se generan turnos en React.
- Nombre obligatorio (150), correo válido si se proporciona (254), teléfono (30), notas (1000); al menos correo o teléfono. Opcionales vacíos se envían como `null`.
- El resumen precede al POST. Este solo envía los campos del contrato: clave, profesional, servicio, inicio y datos del cliente. El comprobante usa los valores devueltos por el backend, incluido precio, duración y estado.
- Cada intento genera un `crypto.randomUUID()`. El envío queda bloqueado mientras está en curso. Red, 5xx o respuesta inválida producen resultado incierto: clave y payload quedan en memoria, se bloquea la edición y solo se permite reintento manual idéntico. No hay reintentos automáticos.
- La navegación interna pide confirmación mediante diálogo modal; recargar, cerrar o salir del documento usa la advertencia nativa `beforeunload` (el navegador decide su texto y presentación). Al abandonar se pierde el intento en memoria. No se persisten datos personales en almacenamiento local.
- 409 muestra conflicto, limpia el turno y reconsulta disponibilidad automáticamente. 400 y 404 tienen mensajes específicos sin atribuir causas desconocidas. Tras éxito se vuelve a consultar disponibilidad y se exige “Crear otra reserva” para iniciar un flujo nuevo.
- 429 conserva la clave y el payload exactos, bloquea edición y envío durante la espera y habilita después un reintento exclusivamente manual. Se prioriza `Retry-After` (segundos o fecha HTTP), después `retryAfterSeconds` del JSON y finalmente 60 segundos. La cuenta usa un instante límite, no acumula intervalos, y no elimina una incertidumbre previa. Para que JavaScript pueda leer `Retry-After` en una petición CORS, el backend debe exponerlo con `Access-Control-Expose-Headers: Retry-After`; si no lo hace, se usa el cuerpo o el fallback. No se ha modificado el backend.
- Seleccionar horario no bloquea el turno. Confirmar no representa un pago.

## Pruebas E2E con mocks

```sh
npx playwright install chromium
npm run test:e2e
```

Playwright inicia su propio Vite en **http://localhost:5174**, con puerto estricto y sin reutilizar servidores existentes. Los endpoints se interceptan: estas pruebas no requieren Spring Boot ni acreditan su integración o CORS. Se ejecutan en Chromium escritorio y Chromium con viewport/táctil móvil (no es Safari), con zona del navegador `Asia/Tokyo` y negocio `America/New_York`.

Cobertura: recorrido completo y payload permitido, comprobante del backend, ausencia de Authorization, slug inexistente, las tres listas vacías, errores HTTP/reintento, conflicto y recarga, red/5xx/respuesta inválida con reintento idéntico, bloqueo y advertencia de abandono, respuesta atrasada entre negocios, límites locales, DST, validación de contacto, limpieza de selección, inicio y 404.

## Verificación con Spring Boot real (manual)

1. Arrancar el backend existente en `http://localhost:8080`, con un negocio real que tenga servicio, profesional asociado y horarios disponibles. Obtener su slug desde la configuración del negocio.
2. Configurar `.env.local` y arrancar esta web en `http://localhost:5173`. Si se elige `5174`, añadir antes `http://localhost:5174` a los orígenes permitidos por el backend. Verificar también el preflight POST `OPTIONS` para JSON.
3. Abrir `/reservar/SLUG_REAL`. En Network, comprobar los GET reales, sus parámetros y ausencia de Authorization. Verificar que un fallo CORS/conexión aparece como error, no como lista vacía.
4. Elegir servicio, profesional, fecha y slot real. Completar contacto, revisar y confirmar. Comprobar un POST con HTTP 201 y el comprobante con los valores del servidor. Verificar la reserva desde el panel administrativo existente.
5. Comprobar que la disponibilidad se reconsulta tras éxito. Usar “Crear otra reserva” para comenzar otro intento.
6. Para probar idempotencia real, repetir controladamente el mismo POST con la misma clave y el mismo cuerpo en un entorno de pruebas: debe devolver HTTP 201 y el mismo identificador, sin crear otra reserva. Para probar conflicto, intentar reservar un turno que otro cliente haya ocupado mientras se revisaba el resumen.
7. Probar desde un navegador cuya zona sea diferente a la del negocio y comprobar fecha, hora y desfase en el resumen y comprobante.

**La verificación con Spring Boot real no se ha realizado durante esta implementación.** Los resultados automatizados corresponden a mocks HTTP. No se implementan pagos, cancelación pública, consulta de reservas previas, envío de correos, cuentas ni funciones administrativas.
