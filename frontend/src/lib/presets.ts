import type { Drawing, Frame, Path } from './types'

// Copied from oscilloshape's examples (src/lib/shapes.ts) rather than shared:
// it is a separate repository. Its calibration shapes are left out.

// Handle length that makes four cubic Bezier segments approximate a circle.
const KAPPA = 0.5522847498

function circle(cx: number, cy: number, r: number): Path {
  const k = r * KAPPA
  return {
    closed: true,
    points: [
      { x: cx + r, y: cy, in: [cx + r, cy - k], out: [cx + r, cy + k] },
      { x: cx, y: cy + r, in: [cx + k, cy + r], out: [cx - k, cy + r] },
      { x: cx - r, y: cy, in: [cx - r, cy + k], out: [cx - r, cy - k] },
      { x: cx, y: cy - r, in: [cx - k, cy - r], out: [cx + k, cy - r] },
    ],
  }
}

function polygon(points: [number, number][], closed = true): Path {
  return { closed, points: points.map(([x, y]) => ({ x, y })) }
}

const smile: Path = {
  closed: false,
  points: [
    { x: -0.45, y: -0.2, out: [-0.3, -0.62] },
    { x: 0.45, y: -0.2, in: [0.3, -0.62] },
  ],
}

const katakanaI = polygon([
  [0.45, 0.85],
  [0.7, 0.65],
  [0.25, 0.3125],
  [0.25, -0.85],
  [0, -0.85],
  [0, 0.125],
  [-0.6, -0.325],
  [-0.75, -0.05],
])

function preset(name: string, frame: Frame): Drawing {
  return { id: `preset:${name}`, createdAt: '1970-01-01T00:00:00Z', frame }
}

/** Drawings the float page shows even when nobody has sent one yet. */
export const PRESETS: readonly Drawing[] = [
  preset('circle', { paths: [circle(0, 0, 0.8)] }),
  preset('smiley', {
    paths: [circle(0, 0, 0.85), circle(-0.3, 0.3, 0.09), circle(0.3, 0.3, 0.09), smile],
  }),
  preset('katakana-i', { paths: [katakanaI] }),
]
