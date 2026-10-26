import type { Drawing } from './types'

// The animation of the float page. Lengths are CSS pixels and times are
// seconds on whatever clock the caller passes as `now`.

export interface Screen {
  width: number
  height: number
}

export interface Sprite {
  drawing: Drawing
  /** Centre at birth. */
  x: number
  y: number
  /** Per second. */
  vx: number
  vy: number
  /** Radians at birth, clockwise on the canvas. */
  angle: number
  /** Radians per second. */
  spin: number
  bornAt: number
  lifetime: number
  /** Side of the square the [-1, 1] frame fills at full size. */
  baseScale: number
}

export const FADE_SECONDS = 1.5
export const LIFETIME_RANGE = [12, 20] as const
/** Fractions of the shorter side of the screen. */
export const SIZE_RANGE = [0.25, 0.45] as const
/** Fractions of the shorter side of the screen per second. */
export const SPEED_RANGE = [0.02, 0.05] as const
export const MAX_SPIN = 0.2
/** Largest tilt from upright at mid-life. */
export const MAX_TILT = 0.3
/** Scale at birth and at death, growing to and shrinking from 1. */
export const MIN_SCALE = 0.5
export const MAX_SPAWN_DELAY = 3
export const COUNT_RANGE = [6, 12] as const
const PHONE_AREA = 390 * 844
const LARGE_AREA = 1920 * 1080

const clamp01 = (p: number) => Math.min(1, Math.max(0, p))
const lerp = ([a, b]: readonly [number, number], t: number) => a + (b - a) * t

export const easeOutCubic = (p: number) => 1 - (1 - clamp01(p)) ** 3
export const easeInCubic = (p: number) => clamp01(p) ** 3

export interface Appearance {
  opacity: number
  scale: number
}

/** Fades in while growing, holds, then fades out while shrinking. */
export function appearance(s: Sprite, now: number): Appearance {
  const age = now - s.bornAt
  if (age < 0 || age >= s.lifetime) return { opacity: 0, scale: MIN_SCALE }
  if (age < FADE_SECONDS) {
    const e = easeOutCubic(age / FADE_SECONDS)
    return { opacity: e, scale: MIN_SCALE + (1 - MIN_SCALE) * e }
  }
  const fadeOutAt = s.lifetime - FADE_SECONDS
  if (age > fadeOutAt) {
    const e = easeInCubic((age - fadeOutAt) / FADE_SECONDS)
    return { opacity: 1 - e, scale: 1 - (1 - MIN_SCALE) * e }
  }
  return { opacity: 1, scale: 1 }
}

export interface Pose extends Appearance {
  x: number
  y: number
  angle: number
  /** baseScale times scale. */
  size: number
}

export function pose(s: Sprite, now: number): Pose {
  const age = now - s.bornAt
  const a = appearance(s, now)
  return {
    ...a,
    x: s.x + s.vx * age,
    y: s.y + s.vy * age,
    angle: s.angle + s.spin * age,
    size: s.baseScale * a.scale,
  }
}

export function isAlive(s: Sprite, now: number): boolean {
  return now - s.bornAt < s.lifetime
}

/** A random position along an extent such that ±half around it stays inside. */
function within(extent: number, half: number, r: number): number {
  return 2 * half >= extent ? extent / 2 : half + r * (extent - 2 * half)
}

/**
 * A sprite whose centre stays on screen for its whole lifetime: the middle
 * of its straight path is picked first and the start is derived from it.
 */
export function spawnSprite(
  drawing: Drawing,
  screen: Screen,
  now: number,
  rand: () => number = Math.random,
): Sprite {
  const short = Math.min(screen.width, screen.height)
  const lifetime = lerp(LIFETIME_RANGE, rand())
  const speed = lerp(SPEED_RANGE, rand()) * short
  const heading = rand() * 2 * Math.PI
  const vx = Math.cos(heading) * speed
  const vy = Math.sin(heading) * speed
  const half = lifetime / 2
  const midX = within(screen.width, Math.abs(vx) * half, rand())
  const midY = within(screen.height, Math.abs(vy) * half, rand())
  const spin = (rand() * 2 - 1) * MAX_SPIN
  // Near upright at mid-life rather than at birth, when the sprite is
  // fully visible and a written word is most likely to be read.
  const tilt = (rand() * 2 - 1) * MAX_TILT
  return {
    drawing,
    x: midX - vx * half,
    y: midY - vy * half,
    vx,
    vy,
    angle: tilt - spin * half,
    spin,
    bornAt: now,
    lifetime,
    baseScale: lerp(SIZE_RANGE, rand()) * short,
  }
}

/** How many sprites to keep on a screen, growing with its area. */
export function targetCount({ width, height }: Screen): number {
  const t = clamp01((width * height - PHONE_AREA) / (LARGE_AREA - PHONE_AREA))
  return Math.round(lerp(COUNT_RANGE, t))
}

/**
 * Keeps targetCount() sprites alive. A slot that frees up is filled after a
 * random delay so that appearances are staggered; the very first sprite
 * appears at once. The drawing is picked when the sprite is born, not when
 * the slot is scheduled, so removals and new drawings are seen promptly.
 */
export class Scheduler {
  sprites: Sprite[] = []
  private due: number[] = []

  constructor(
    private readonly pick: () => Drawing | undefined,
    private readonly rand: () => number = Math.random,
  ) {}

  update(now: number, screen: Screen): readonly Sprite[] {
    this.sprites = this.sprites.filter((s) => isAlive(s, now))
    if (screen.width <= 0 || screen.height <= 0) return this.sprites

    const target = targetCount(screen)
    while (this.due.length > 0 && this.sprites.length + this.due.length > target) this.due.pop()
    while (this.sprites.length + this.due.length < target) {
      const first = this.sprites.length === 0 && this.due.length === 0
      this.due.push(first ? now : now + this.rand() * MAX_SPAWN_DELAY)
    }

    const ready = this.due.filter((t) => t <= now).length
    this.due = this.due.filter((t) => t > now)
    for (let i = 0; i < ready; i++) {
      const drawing = this.pick()
      if (drawing) this.sprites.push(spawnSprite(drawing, screen, now, this.rand))
    }
    return this.sprites
  }
}
