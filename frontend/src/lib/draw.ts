// Pure geometry for the drawing page: erasing with a circle and simplifying
// strokes before upload. Paths and points are treated as immutable; a path
// that is not touched is returned as the same object.

import { clampToArea } from './aspect'
import type { Frame, Path, Point, Vec } from './types'

/** Pen samples closer than this to the previous point are skipped. */
export const MIN_POINT_DISTANCE = 0.004

/** Ramer-Douglas-Peucker tolerance applied before upload. */
export const SIMPLIFY_EPSILON = 0.002

/** Coordinates are rounded to this many decimals before upload. */
export const UPLOAD_DECIMALS = 4

/** Eraser radii in scope units. */
export const ERASER_SMALL_RADIUS = 0.03
export const ERASER_LARGE_RADIUS = 0.08

type XY = { x: number; y: number }

export function distance(a: XY, b: XY): number {
  return Math.hypot(b.x - a.x, b.y - a.y)
}

function lerp(a: XY, b: XY, t: number): Point {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
}

function polylineLength(points: XY[]): number {
  let length = 0
  for (let i = 1; i < points.length; i++) length += distance(points[i - 1], points[i])
  return length
}

/**
 * The parameter range [t0, t1] (0 at a, 1 at b) of the part of segment a-b
 * that lies strictly inside the circle, or null when none does. A segment
 * that only touches the circle is outside.
 */
export function segmentCircleInterval(
  a: XY,
  b: XY,
  [cx, cy]: Vec,
  r: number,
): [number, number] | null {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const fx = a.x - cx
  const fy = a.y - cy
  const qa = dx * dx + dy * dy
  const qc = fx * fx + fy * fy - r * r
  if (qa === 0) return qc < 0 ? [0, 1] : null
  const qb = 2 * (fx * dx + fy * dy)
  const disc = qb * qb - 4 * qa * qc
  if (disc <= 0) return null
  const s = Math.sqrt(disc)
  const t0 = Math.max(0, (-qb - s) / (2 * qa))
  const t1 = Math.min(1, (-qb + s) / (2 * qa))
  return t0 < t1 ? [t0, t1] : null
}

/**
 * Cuts a path with a circle. Segments crossing the circle are clipped at its
 * boundary and the parts outside survive as separate open paths. Erasing
 * never leaves dots: a surviving fragment shorter than MIN_POINT_DISTANCE is
 * dropped. A dot (single-point path) is removed when it is inside the circle.
 */
export function cutPath(path: Path, center: Vec, r: number): Path[] {
  const pts = path.points
  if (pts.length === 0) return []
  if (pts.length === 1) {
    const [cx, cy] = center
    return Math.hypot(pts[0].x - cx, pts[0].y - cy) < r ? [] : [path]
  }

  const walk = path.closed ? [...pts, pts[0]] : pts
  const pieces: Point[][] = []
  let current: Point[] = []
  let touched = false
  const flush = () => {
    if (current.length >= 2) pieces.push(current)
    current = []
  }

  for (let i = 0; i + 1 < walk.length; i++) {
    const a = walk[i]
    const b = walk[i + 1]
    const inside = segmentCircleInterval(a, b, center, r)
    if (!inside) {
      if (current.length === 0) current.push(a)
      current.push(b)
      continue
    }
    touched = true
    const [t0, t1] = inside
    if (t0 > 0) {
      if (current.length === 0) current.push(a)
      current.push(lerp(a, b, t0))
    }
    flush()
    if (t1 < 1) current.push(lerp(a, b, t1), b)
  }
  flush()
  if (!touched) return [path]

  // A closed path cut once or more is unrolled from its first point; when
  // that point survived, the last piece continues into the first one.
  if (path.closed && pieces.length > 1) {
    const first = pieces[0]
    const last = pieces[pieces.length - 1]
    if (first[0] === pts[0] && last[last.length - 1] === pts[0]) {
      pieces[0] = [...last, ...first.slice(1)]
      pieces.pop()
    }
  }

  return pieces
    .filter((p) => polylineLength(p) >= MIN_POINT_DISTANCE)
    .map((points) => ({ closed: false, points }))
}

/** Erases a circle from every path. Returns the same array when nothing changed. */
export function eraseCircle(paths: Path[], center: Vec, r: number): Path[] {
  let changed = false
  const out: Path[] = []
  for (const path of paths) {
    const cut = cutPath(path, center, r)
    if (cut.length !== 1 || cut[0] !== path) changed = true
    out.push(...cut)
  }
  return changed ? out : paths
}

/**
 * Erases along the segment from one center to the next by stamping circles
 * at most half a radius apart, so that a fast drag leaves no gaps.
 */
export function eraseAlong(paths: Path[], from: Vec, to: Vec, r: number): Path[] {
  const steps = Math.max(1, Math.ceil(Math.hypot(to[0] - from[0], to[1] - from[1]) / (r / 2)))
  let out = paths
  for (let i = 1; i <= steps; i++) {
    const t = i / steps
    out = eraseCircle(out, [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t], r)
  }
  return out
}

function segmentDistance(p: XY, a: XY, b: XY): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return distance(p, a)
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

/**
 * Ramer-Douglas-Peucker on an open polyline; the end points are kept.
 * Distances are measured to the segment rather than the infinite line so
 * that a stroke doubling back on itself is not collapsed.
 */
export function simplifyPoints(points: Point[], epsilon: number): Point[] {
  if (points.length <= 2) return points.slice()
  const keep = new Uint8Array(points.length)
  keep[0] = 1
  keep[points.length - 1] = 1
  const stack: [number, number][] = [[0, points.length - 1]]
  while (stack.length > 0) {
    const [first, last] = stack.pop()!
    let farthest = -1
    let max = epsilon
    for (let i = first + 1; i < last; i++) {
      const d = segmentDistance(points[i], points[first], points[last])
      if (d > max) {
        max = d
        farthest = i
      }
    }
    if (farthest < 0) continue
    keep[farthest] = 1
    stack.push([first, farthest], [farthest, last])
  }
  return points.filter((_, i) => keep[i] === 1)
}

export function simplifyPath(path: Path, epsilon: number): Path {
  if (!path.closed || path.points.length < 3) {
    return { closed: path.closed, points: simplifyPoints(path.points, epsilon) }
  }
  const unrolled = simplifyPoints([...path.points, path.points[0]], epsilon)
  return { closed: true, points: unrolled.slice(0, -1) }
}

const UPLOAD_SCALE = 10 ** UPLOAD_DECIMALS

// Not Math.round(v / step) * step: multiplying by an inexact step prints
// values like 0.00030000000000000003, while a division by a power of ten
// gives the shortest decimal.
function round(v: number): number {
  return Math.round(v * UPLOAD_SCALE) / UPLOAD_SCALE
}

/**
 * The frame to upload: every path simplified, coordinates rounded and kept
 * inside the band, so the JSON stays small and valid.
 */
export function frameForUpload(paths: Path[], area: Vec): Frame {
  return {
    paths: paths.map((path) => {
      const simplified = simplifyPath(path, SIMPLIFY_EPSILON)
      return {
        closed: simplified.closed,
        points: simplified.points.map((p) => {
          const [x, y] = clampToArea([round(p.x), round(p.y)], area)
          return { x, y }
        }),
      }
    }),
  }
}

export function countPoints(paths: Path[]): number {
  let n = 0
  for (const path of paths) n += path.points.length
  return n
}
