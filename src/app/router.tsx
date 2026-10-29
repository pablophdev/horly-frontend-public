import { createBrowserRouter, Link } from 'react-router-dom'
import { Layout, BookingRoute } from './Layout'

export const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      {
        path: '/',
        element: (
          <section className="card landing">
            <span className="eyebrow">TU PRÓXIMA CITA</span>
            <h1>Un momento para ti.</h1>
            <p>Para reservar, abre el enlace que te ha compartido tu negocio.</p>
            <p className="notice">Cada negocio tiene su propio enlace de reservas en Horly.</p>
          </section>
        ),
      },
      { path: '/reservar/:slug', element: <BookingRoute /> },
      {
        path: '*',
        element: (
          <section className="card landing">
            <span className="eyebrow">404</span>
            <h1>No encontramos esta página</h1>
            <p>Comprueba el enlace de tu negocio.</p>
            <Link to="/">Volver al inicio</Link>
          </section>
        ),
      },
    ],
  },
])
