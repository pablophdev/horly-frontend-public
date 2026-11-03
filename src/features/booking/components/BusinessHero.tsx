import { useState } from 'react'
import type { Business } from '../api'

function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toLocaleUpperCase('es')
}

function BusinessCover({ url }: { url: string | null }) {
  const [failed, setFailed] = useState(false)
  const showImage = Boolean(url) && !failed

  return (
    <div
      className={`business-hero__cover${showImage ? '' : ' business-hero__cover--fallback'}`}
      data-testid="business-cover"
    >
      {showImage && (
        <img
          src={url!}
          alt=""
          aria-hidden="true"
          decoding="async"
          fetchPriority="high"
          onError={() => setFailed(true)}
        />
      )}
    </div>
  )
}

function BusinessLogo({ url, name }: { url: string | null; name: string }) {
  const [failed, setFailed] = useState(false)
  const showImage = Boolean(url) && !failed

  return (
    <div
      className={`business-hero__logo${showImage ? '' : ' business-hero__logo--fallback'}`}
      data-testid="business-logo"
    >
      {showImage ? (
        <img src={url!} alt={`Logo de ${name}`} decoding="async" onError={() => setFailed(true)} />
      ) : (
        <span aria-hidden="true">{initials(name)}</span>
      )}
    </div>
  )
}

export function BusinessHero({ business }: { business: Business }) {
  return (
    <section className="business-hero" aria-labelledby="business-name">
      <BusinessCover
        key={`${business.slug}:${business.coverImageUrl ?? 'default-cover'}`}
        url={business.coverImageUrl}
      />
      <div className="business-hero__identity">
        <BusinessLogo
          key={`${business.slug}:${business.logoImageUrl ?? 'default-logo'}`}
          url={business.logoImageUrl}
          name={business.name}
        />
        <div className="business-hero__content">
          <span className="eyebrow">RESERVA TU MOMENTO</span>
          <h1 id="business-name">{business.name}</h1>
          {business.description && <p className="description">{business.description}</p>}
          <div className="business-details">
            {business.address && <address>{business.address}</address>}
            {business.phone && <span>Tel. {business.phone}</span>}
          </div>
        </div>
      </div>
    </section>
  )
}
