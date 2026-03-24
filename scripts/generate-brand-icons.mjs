import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { deflateSync } from 'node:zlib'

const DESIGN_SIZE = 64
const SAMPLE_RATE = 4

const OUTPUTS = [
  { size: 16, path: resolve('public/icons/icon16.png') },
  { size: 48, path: resolve('public/icons/icon48.png') },
  { size: 128, path: resolve('public/icons/icon128.png') },
  { size: 256, path: resolve('/tmp/better-bookmarks-logo-preview.png') },
]

const backgroundStart = hexToRgb('#14213d')
const backgroundEnd = hexToRgb('#0b1220')
const shelfColor = hexToRgb('#1e293b')
const highlightColor = hexToRgb('#bfdbfe')
const shadowColor = hexToRgb('#020617')

const books = [
  {
    x: 15,
    y: 17,
    width: 10,
    height: 25,
    radius: 2.8,
    angle: 0,
    color: hexToRgb('#f59e0b'),
    accent: hexToRgb('#fef3c7'),
  },
  {
    x: 28,
    y: 16,
    width: 10,
    height: 26,
    radius: 2.8,
    angle: 14,
    color: hexToRgb('#fb7185'),
    accent: hexToRgb('#ffe4e6'),
  },
  {
    x: 40,
    y: 19,
    width: 10,
    height: 23,
    radius: 2.8,
    angle: 34,
    color: hexToRgb('#38bdf8'),
    accent: hexToRgb('#e0f2fe'),
  },
]

const highlightSegments = buildHighlightSegments()

for (const output of OUTPUTS) {
  const png = renderIcon(output.size)
  mkdirSync(dirname(output.path), { recursive: true })
  writeFileSync(output.path, png)
}

function renderIcon(size) {
  const hiSize = size * SAMPLE_RATE
  const hiBuffer = new Float32Array(hiSize * hiSize * 4)

  for (let py = 0; py < hiSize; py += 1) {
    const y = ((py + 0.5) / hiSize) * DESIGN_SIZE
    for (let px = 0; px < hiSize; px += 1) {
      const x = ((px + 0.5) / hiSize) * DESIGN_SIZE
      const offset = (py * hiSize + px) * 4

      if (insideRoundedRect(x, y, 4, 4, 56, 56, 18)) {
        const t = clamp(projectLinearGradient(x, y, 10, 8, 54, 56), 0, 1)
        blend(offset, hiBuffer, lerpColor(backgroundStart, backgroundEnd, t), 1)

        const glow = radialGlowAlpha(x, y)
        if (glow > 0) {
          blend(offset, hiBuffer, [0.9725, 0.9804, 0.9882], glow)
        }
      }

      const highlight = minDistanceToSegments(x, y, highlightSegments)
      if (highlight <= 0.8) {
        const alpha = 0.22 * (1 - highlight / 0.8)
        blend(offset, hiBuffer, highlightColor, alpha)
      }

      const shadow = ellipseShadowAlpha(x, y)
      if (shadow > 0) {
        blend(offset, hiBuffer, shadowColor, shadow)
      }

      if (insideRoundedRect(x, y, 14, 44, 36, 3, 1.5)) {
        blend(offset, hiBuffer, shelfColor, 1)
      }

      for (const book of books) {
        paintBookPixel(offset, hiBuffer, x, y, book)
      }
    }
  }

  return encodePng(downsample(hiBuffer, hiSize, size))
}

function paintBookPixel(offset, buffer, x, y, book) {
  const point = rotatePoint(x, y, book.angle, book.x + book.width / 2, book.y + book.height)

  if (insideRoundedRect(point.x, point.y, book.x, book.y, book.width, book.height, book.radius)) {
    blend(offset, buffer, book.color, 1)
  }

  if (insideRoundedRect(point.x, point.y, book.x + book.width - 2.2, book.y + 1.4, 1.2, book.height - 2.8, 0.6)) {
    blend(offset, buffer, [0.9725, 0.9804, 0.9882], 0.92)
  }

  if (insideRoundedRect(point.x, point.y, book.x + 1.6, book.y + 4, book.width - 5.2, 1.5, 0.75)) {
    blend(offset, buffer, book.accent, 0.9)
  }

  if (insideRoundedRect(point.x, point.y, book.x + 1.6, book.y + 7.2, book.width - 6.6, 1.15, 0.575)) {
    blend(offset, buffer, book.accent, 0.62)
  }
}

function radialGlowAlpha(x, y) {
  const centerX = 30
  const centerY = 20
  const rotated = rotatePoint(x, y, -52, centerX, centerY)
  const nx = (rotated.x - centerX) / 32
  const ny = (rotated.y - centerY) / 24
  const distance = Math.sqrt(nx * nx + ny * ny)
  return distance >= 1 ? 0 : 0.24 * (1 - distance)
}

function ellipseShadowAlpha(x, y) {
  const dx = (x - 32) / 18.5
  const dy = (y - 45.5) / 3.4
  const distance = dx * dx + dy * dy
  if (distance >= 1.2) return 0
  return 0.36 * Math.max(0, 1 - distance / 1.2)
}

function buildHighlightSegments() {
  const points = []

  const first = sampleCubic(
    { x: 16, y: 16.5 },
    { x: 20.6, y: 12.3 },
    { x: 27.1, y: 10.3 },
    { x: 35.6, y: 10.6 },
    18
  )
  const second = sampleCubic(
    { x: 35.6, y: 10.6 },
    { x: 42, y: 10.8 },
    { x: 46.5, y: 12.2 },
    { x: 50, y: 15 },
    12
  )

  points.push(...first, ...second.slice(1))

  return points.slice(1).map((point, index) => ({
    x1: points[index].x,
    y1: points[index].y,
    x2: point.x,
    y2: point.y,
  }))
}

function sampleCubic(start, control1, control2, end, steps) {
  const points = []
  for (let step = 0; step <= steps; step += 1) {
    const t = step / steps
    const mt = 1 - t
    points.push({
      x:
        mt * mt * mt * start.x +
        3 * mt * mt * t * control1.x +
        3 * mt * t * t * control2.x +
        t * t * t * end.x,
      y:
        mt * mt * mt * start.y +
        3 * mt * mt * t * control1.y +
        3 * mt * t * t * control2.y +
        t * t * t * end.y,
    })
  }
  return points
}

function downsample(buffer, hiSize, size) {
  const output = Buffer.alloc(size * size * 4)

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0

      for (let sy = 0; sy < SAMPLE_RATE; sy += 1) {
        for (let sx = 0; sx < SAMPLE_RATE; sx += 1) {
          const hiX = x * SAMPLE_RATE + sx
          const hiY = y * SAMPLE_RATE + sy
          const hiOffset = (hiY * hiSize + hiX) * 4
          r += buffer[hiOffset]
          g += buffer[hiOffset + 1]
          b += buffer[hiOffset + 2]
          a += buffer[hiOffset + 3]
        }
      }

      const scale = SAMPLE_RATE * SAMPLE_RATE
      const offset = (y * size + x) * 4
      output[offset] = Math.round((r / scale) * 255)
      output[offset + 1] = Math.round((g / scale) * 255)
      output[offset + 2] = Math.round((b / scale) * 255)
      output[offset + 3] = Math.round((a / scale) * 255)
    }
  }

  return output
}

function encodePng(rgba) {
  const size = Math.sqrt(rgba.length / 4)
  const stride = size * 4
  const raw = Buffer.alloc((stride + 1) * size)

  for (let y = 0; y < size; y += 1) {
    raw[y * (stride + 1)] = 0
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }

  const header = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  return Buffer.concat([
    header,
    createChunk('IHDR', ihdr),
    createChunk('IDAT', deflateSync(raw, { level: 9 })),
    createChunk('IEND', Buffer.alloc(0)),
  ])
}

function createChunk(type, data) {
  const typeBuffer = Buffer.from(type)
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0)
  return Buffer.concat([length, typeBuffer, data, crc])
}

function crc32(buffer) {
  let crc = 0xffffffff
  for (const value of buffer) {
    crc ^= value
    for (let bit = 0; bit < 8; bit += 1) {
      const mask = -(crc & 1)
      crc = (crc >>> 1) ^ (0xedb88320 & mask)
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function blend(offset, buffer, color, alpha) {
  if (alpha <= 0) return

  const dstAlpha = buffer[offset + 3]
  const outAlpha = alpha + dstAlpha * (1 - alpha)

  if (outAlpha <= 0) return

  buffer[offset] =
    (color[0] * alpha + buffer[offset] * dstAlpha * (1 - alpha)) / outAlpha
  buffer[offset + 1] =
    (color[1] * alpha + buffer[offset + 1] * dstAlpha * (1 - alpha)) / outAlpha
  buffer[offset + 2] =
    (color[2] * alpha + buffer[offset + 2] * dstAlpha * (1 - alpha)) / outAlpha
  buffer[offset + 3] = outAlpha
}

function insideRoundedRect(x, y, rectX, rectY, width, height, radius) {
  const centerX = rectX + width / 2
  const centerY = rectY + height / 2
  const dx = Math.max(Math.abs(x - centerX) - width / 2 + radius, 0)
  const dy = Math.max(Math.abs(y - centerY) - height / 2 + radius, 0)
  return dx * dx + dy * dy <= radius * radius
}

function rotatePoint(x, y, angleDeg, originX, originY) {
  if (!angleDeg) return { x, y }

  const angle = (-angleDeg * Math.PI) / 180
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const translatedX = x - originX
  const translatedY = y - originY

  return {
    x: translatedX * cos - translatedY * sin + originX,
    y: translatedX * sin + translatedY * cos + originY,
  }
}

function distanceToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1
  const dy = y2 - y1
  const lengthSquared = dx * dx + dy * dy

  if (lengthSquared === 0) {
    return Math.hypot(px - x1, py - y1)
  }

  const t = clamp(((px - x1) * dx + (py - y1) * dy) / lengthSquared, 0, 1)
  const projectionX = x1 + t * dx
  const projectionY = y1 + t * dy
  return Math.hypot(px - projectionX, py - projectionY)
}

function minDistanceToSegments(x, y, segments) {
  let distance = Infinity
  for (const segment of segments) {
    distance = Math.min(distance, distanceToSegment(x, y, segment.x1, segment.y1, segment.x2, segment.y2))
  }
  return distance
}

function projectLinearGradient(x, y, x1, y1, x2, y2) {
  const dx = x2 - x1
  const dy = y2 - y1
  return ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)
}

function lerpColor(start, end, t) {
  return [
    start[0] + (end[0] - start[0]) * t,
    start[1] + (end[1] - start[1]) * t,
    start[2] + (end[2] - start[2]) * t,
  ]
}

function hexToRgb(value) {
  const normalized = value.replace('#', '')
  return [
    Number.parseInt(normalized.slice(0, 2), 16) / 255,
    Number.parseInt(normalized.slice(2, 4), 16) / 255,
    Number.parseInt(normalized.slice(4, 6), 16) / 255,
  ]
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}
