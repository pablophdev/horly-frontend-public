import { Link, Outlet, useParams } from 'react-router-dom'
import { BookingPage } from '../features/booking/BookingPage'

export function Layout() {
  return (
    <>
      <a className="skip-link" href="#main">
        Saltar al contenido
      </a>
      <header className="site-header">
        <Link className="brand" to="/" aria-label="Horly, inicio">
          <span className="brand-icon" aria-hidden="true">
            h
          </span>
          horly<span className="brand-dot">.</span>
        </Link>
        <span className="header-caption">Reservas online</span>
      </header>
      <main id="main">
        <Outlet />
      </main>
      <footer>
        Tu tiempo, bien organizado. <span>Con Horly</span>
      </footer>
    </>
  )
}

export function BookingRoute() {
  const { slug = '' } = useParams()
  return <BookingPage key={slug} slug={slug} />
}
