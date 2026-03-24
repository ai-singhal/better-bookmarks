import { useId } from 'react'
import { cn } from '../utils'

type BrandLogoProps = {
  className?: string
  title?: string
}

type BookProps = {
  x: number
  y: number
  width: number
  height: number
  color: string
  accent: string
  angle?: number
}

function Book({ x, y, width, height, color, accent, angle = 0 }: BookProps) {
  const pivotX = x + width / 2
  const pivotY = y + height

  return (
    <g transform={angle ? `rotate(${angle} ${pivotX} ${pivotY})` : undefined}>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        rx={width * 0.28}
        fill={color}
      />
      <rect
        x={x + width - 2.2}
        y={y + 1.4}
        width={1.2}
        height={height - 2.8}
        rx={0.6}
        fill="#f8fafc"
        opacity={0.92}
      />
      <rect
        x={x + 1.6}
        y={y + 4}
        width={width - 5.2}
        height={1.5}
        rx={0.75}
        fill={accent}
        opacity={0.9}
      />
      <rect
        x={x + 1.6}
        y={y + 7.2}
        width={width - 6.6}
        height={1.15}
        rx={0.575}
        fill={accent}
        opacity={0.62}
      />
    </g>
  )
}

export function BrandLogo({
  className,
  title = 'Better Bookmarks logo with toppling books',
}: BrandLogoProps) {
  const prefix = useId().replace(/:/g, '')
  const backgroundId = `${prefix}-background`
  const glowId = `${prefix}-glow`
  const shadowId = `${prefix}-shadow`

  return (
    <svg
      viewBox="0 0 64 64"
      fill="none"
      className={cn('block', className)}
      role={title ? 'img' : undefined}
      aria-label={title || undefined}
      aria-hidden={title ? undefined : true}
    >
      {title ? <title>{title}</title> : null}

      <defs>
        <linearGradient id={backgroundId} x1="10" y1="8" x2="54" y2="56" gradientUnits="userSpaceOnUse">
          <stop stopColor="#14213d" />
          <stop offset="1" stopColor="#0b1220" />
        </linearGradient>
        <radialGradient id={glowId} cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(30 20) rotate(52) scale(32 24)">
          <stop stopColor="#f8fafc" stopOpacity="0.24" />
          <stop offset="1" stopColor="#f8fafc" stopOpacity="0" />
        </radialGradient>
        <filter id={shadowId} x="7" y="39" width="50" height="13" filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
          <feFlood floodOpacity="0" result="BackgroundImageFix" />
          <feBlend in="SourceGraphic" in2="BackgroundImageFix" result="shape" />
          <feGaussianBlur stdDeviation="2" result="effect1_foregroundBlur_0_1" />
        </filter>
      </defs>

      <rect x="4" y="4" width="56" height="56" rx="18" fill={`url(#${backgroundId})`} />
      <rect x="4" y="4" width="56" height="56" rx="18" fill={`url(#${glowId})`} />
      <path
        d="M16 16.5c4.6-4.2 11.1-6.2 19.6-5.9 6.4.2 10.9 1.6 14.4 4.4"
        stroke="#bfdbfe"
        strokeOpacity="0.22"
        strokeWidth="1.6"
        strokeLinecap="round"
      />

      <g filter={`url(#${shadowId})`}>
        <ellipse cx="32" cy="45.5" rx="18.5" ry="2.8" fill="#020617" fillOpacity="0.82" />
      </g>
      <rect x="14" y="44" width="36" height="3" rx="1.5" fill="#1e293b" />

      <Book x={15} y={17} width={10} height={25} color="#f59e0b" accent="#fef3c7" />
      <Book x={28} y={16} width={10} height={26} color="#fb7185" accent="#ffe4e6" angle={14} />
      <Book x={40} y={19} width={10} height={23} color="#38bdf8" accent="#e0f2fe" angle={34} />
    </svg>
  )
}
