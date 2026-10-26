import type { Vec } from './types'

export const DEFAULT_ASPECT = '5:4'

/** Width and height of a "W:H" string, or null when it is not one. */
export function parseAspect(aspect: string): [number, number] | null {
  const m = /^\s*(\d+)\s*:\s*(\d+)\s*$/.exec(aspect)
  if (!m) return null
  const w = Number(m[1])
  const h = Number(m[2])
  return w > 0 && h > 0 ? [w, h] : null
}

/**
 * Half extents of the band a drawing may use inside the [-1, 1] square for
 * an aspect ratio: the wider side spans the whole square and the other is
 * shortened. 5:4 gives [1, 0.8]. An unparsable aspect gives the whole square.
 */
export function drawableArea(aspect: string): Vec {
  const parsed = parseAspect(aspect)
  if (!parsed) return [1, 1]
  const [w, h] = parsed
  return [Math.min(1, w / h), Math.min(1, h / w)]
}

/** Keeps a point inside the band. */
export function clampToArea([x, y]: Vec, [ax, ay]: Vec): Vec {
  return [Math.min(ax, Math.max(-ax, x)), Math.min(ay, Math.max(-ay, y))]
}
