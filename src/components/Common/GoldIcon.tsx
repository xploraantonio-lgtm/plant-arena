import React from 'react'
import monedaImg from '../../assets/ico/moneda.webp'

export interface GoldIconProps {
  size?: number | string
  className?: string
  style?: React.CSSProperties
  title?: string
  alt?: string
}

/**
 * Componente unificado para renderizar el icono de Oro del juego.
 * Usa el asset oficial `moneda.webp` con caída elegante y estilo en línea
 * para evitar glifos rotos o caracteres vacíos (tofu) de emojis Unicode en Windows/iOS/Android.
 */
export const GoldIcon: React.FC<GoldIconProps> = ({
  size = 18,
  className = '',
  style = {},
  title = 'Oro',
  alt = 'Oro',
}) => {
  const dimension = typeof size === 'number' ? `${size}px` : size

  return (
    <img
      src={monedaImg}
      alt={alt}
      title={title}
      className={`gold-icon-img ${className}`.trim()}
      style={{
        width: dimension,
        height: dimension,
        objectFit: 'contain',
        verticalAlign: '-0.15em',
        display: 'inline-block',
        filter: 'drop-shadow(0 1px 3px rgba(0, 0, 0, 0.45))',
        ...style,
      }}
      loading="lazy"
      onError={(e) => {
        // En caso excepcional de error al cargar el asset, se oculta
        e.currentTarget.style.display = 'none'
      }}
    />
  )
}

export default GoldIcon
