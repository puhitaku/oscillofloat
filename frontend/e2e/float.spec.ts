import { expect, test, type Page, type WebSocketRoute } from '@playwright/test'
import {
  appearance,
  easeInCubic,
  easeOutCubic,
  FADE_SECONDS,
  MAX_SPAWN_DELAY,
  MIN_SCALE,
  Scheduler,
  spawnSprite,
  targetCount,
  type Sprite,
} from '../src/lib/float'
import { PRESETS } from '../src/lib/presets'
import type { ClientMessage, Drawing } from '../src/lib/types'

const line = (id: string, createdAt: string): Drawing => ({
  id,
  createdAt,
  frame: {
    paths: [
      {
        closed: false,
        points: [
          { x: -0.5, y: 0 },
          { x: 0.5, y: 0 },
        ],
      },
    ],
  },
})

const a = line('0192f1a0-0000-7000-8000-00000000000a', '2026-10-26T12:00:00Z')
const b = line('0192f1a0-0000-7000-8000-00000000000b', '2026-10-26T12:01:00Z')
const c = line('0192f1a0-0000-7000-8000-00000000000c', '2026-10-26T12:02:00Z')
const d = line('0192f1a0-0000-7000-8000-00000000000d', '2026-10-26T12:03:00Z')

/** A fake /ws backend holding `stored`, recording what each connection sent. */
async function fakeBackend(page: Page, stored: Drawing[]) {
  const connections: { ws: WebSocketRoute; received: ClientMessage[] }[] = []
  await page.routeWebSocket(/\/ws$/, (ws) => {
    const conn = { ws, received: [] as ClientMessage[] }
    connections.push(conn)
    ws.onMessage((raw) => {
      const msg = JSON.parse(String(raw)) as ClientMessage
      conn.received.push(msg)
      if (msg.type === 'list') {
        const drawings = [...stored].reverse().map(({ id, createdAt }) => ({ id, createdAt }))
        ws.send(JSON.stringify({ type: 'list', drawings }))
      } else {
        const drawings = stored.filter((s) => msg.ids.includes(s.id))
        ws.send(JSON.stringify({ type: 'drawings', drawings }))
      }
    })
  })
  const latest = () => connections[connections.length - 1]
  const push = (msg: unknown) => latest().ws.send(JSON.stringify(msg))
  return { connections, latest, push }
}

interface Held {
  shown: string[]
  held: Record<string, boolean>
}

/** The gallery store's drawings and every entry it holds with its removed flag. */
function held(page: Page): Promise<Held | null> {
  return page.evaluate(() => {
    const g = (window as unknown as { __gallery?: GalleryHook }).__gallery
    if (!g) return null
    return {
      shown: g.drawings.map((x) => x.id).sort(),
      held: Object.fromEntries([...g.entries].map(([id, e]) => [id, e.removed])),
    }
  })
}

type GalleryHook = {
  drawings: { id: string }[]
  entries: Map<string, { removed: boolean }>
  pickRandom(): { id: string } | undefined
}

test.describe('float page', () => {
  test('loads every drawing and follows additions and removals', async ({ page }) => {
    const stored = [a, b]
    const backend = await fakeBackend(page, stored)
    await page.goto('/float')

    await expect
      .poll(() => backend.connections[0]?.received)
      .toEqual([{ type: 'list' }, { type: 'get', ids: [b.id, a.id] }])
    await expect
      .poll(() => held(page))
      .toEqual({
        shown: [a.id, b.id],
        held: { [a.id]: false, [b.id]: false },
      })
    await expect(page.getByRole('status')).toBeHidden()

    stored.push(c)
    backend.push({ type: 'added', drawing: c })
    await expect.poll(async () => (await held(page))?.shown).toEqual([a.id, b.id, c.id])

    stored.splice(stored.indexOf(a), 1)
    backend.push({ type: 'removed', ids: [a.id] })
    await expect
      .poll(() => held(page))
      .toEqual({
        shown: [b.id, c.id],
        held: { [a.id]: true, [b.id]: false, [c.id]: false },
      })

    stored.push(d)
    backend.push({ type: 'added', drawing: d })
    await expect
      .poll(() => held(page))
      .toEqual({
        shown: [b.id, c.id, d.id],
        held: { [b.id]: false, [c.id]: false, [d.id]: false },
      })
  })

  test('purges removed drawings on the list reply after a reconnect', async ({ page }) => {
    const stored = [a, b]
    const backend = await fakeBackend(page, stored)
    await page.goto('/float')
    await expect.poll(async () => (await held(page))?.shown).toEqual([a.id, b.id])

    backend.push({ type: 'removed', ids: [a.id] })
    await expect.poll(async () => (await held(page))?.held).toEqual({ [a.id]: true, [b.id]: false })

    stored.splice(stored.indexOf(a), 1, c)
    await backend.latest().ws.close()
    await expect(page.getByRole('status')).toHaveText('接続中…')

    await expect.poll(() => backend.connections.length, { timeout: 5000 }).toBe(2)
    await expect
      .poll(() => backend.connections[1].received)
      .toEqual([{ type: 'list' }, { type: 'get', ids: [c.id] }])
    await expect
      .poll(() => held(page))
      .toEqual({
        shown: [b.id, c.id],
        held: { [b.id]: false, [c.id]: false },
      })
    await expect(page.getByRole('status')).toBeHidden()
  })

  test('picking a drawing drops flagged ones and prefers new arrivals', async ({ page }) => {
    const stored = [a]
    const backend = await fakeBackend(page, stored)
    await page.goto('/float')
    await expect.poll(async () => (await held(page))?.shown).toEqual([a.id])

    backend.push({ type: 'removed', ids: [a.id] })
    await expect.poll(async () => (await held(page))?.held).toEqual({ [a.id]: true })
    const picked = await page.evaluate(() =>
      (window as unknown as { __gallery: GalleryHook }).__gallery.pickRandom(),
    )
    expect(picked).toBeUndefined()
    expect((await held(page))?.held).toEqual({})

    backend.push({ type: 'added', drawing: b })
    await expect.poll(async () => (await held(page))?.shown).toEqual([b.id])
    const first = await page.evaluate(
      () => (window as unknown as { __gallery: GalleryHook }).__gallery.pickRandom()?.id,
    )
    expect(first).toBe(b.id)
  })

  test('fills the viewport with a canvas that shows drawings', async ({ page }) => {
    await fakeBackend(page, [])
    await page.goto('/float')

    const canvas = page.getByRole('img', { name: 'みんなの絵' })
    await expect(canvas).toBeVisible()
    const viewport = page.viewportSize()!
    expect(await canvas.boundingBox()).toEqual({
      x: 0,
      y: 0,
      width: viewport.width,
      height: viewport.height,
    })
    // In device pixels: the backing store is the viewport times devicePixelRatio.
    await expect
      .poll(() =>
        canvas.evaluate((el: HTMLCanvasElement) => [
          el.width - Math.round(innerWidth * devicePixelRatio),
          el.height - Math.round(innerHeight * devicePixelRatio),
        ]),
      )
      .toEqual([0, 0])
    await expect(canvas).toHaveCSS('cursor', 'none')

    await page.waitForTimeout(1000)
    await expect
      .poll(() =>
        canvas.evaluate((el: HTMLCanvasElement) => {
          const data = el.getContext('2d')!.getImageData(0, 0, el.width, el.height).data
          let lit = 0
          for (let i = 3; i < data.length; i += 4) if (data[i] > 0) lit++
          return lit
        }),
      )
      .toBeGreaterThan(100)
  })
})

test.describe('float animation model', () => {
  const sprite = (lifetime: number): Sprite => ({
    drawing: PRESETS[0],
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    angle: 0,
    spin: 0,
    bornAt: 10,
    lifetime,
    baseScale: 100,
  })

  test('easings start at 0, end at 1 and clamp outside', () => {
    for (const ease of [easeOutCubic, easeInCubic]) {
      expect(ease(-1)).toBe(0)
      expect(ease(0)).toBe(0)
      expect(ease(1)).toBe(1)
      expect(ease(2)).toBe(1)
    }
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.5)
    expect(easeInCubic(0.5)).toBeLessThan(0.5)
  })

  test('a sprite fades in growing, holds, and fades out shrinking', () => {
    const s = sprite(15)
    expect(appearance(s, 9)).toEqual({ opacity: 0, scale: MIN_SCALE })
    expect(appearance(s, 10)).toEqual({ opacity: 0, scale: MIN_SCALE })
    expect(appearance(s, 10 + FADE_SECONDS)).toEqual({ opacity: 1, scale: 1 })
    expect(appearance(s, 17)).toEqual({ opacity: 1, scale: 1 })
    expect(appearance(s, 25 - FADE_SECONDS)).toEqual({ opacity: 1, scale: 1 })
    expect(appearance(s, 25)).toEqual({ opacity: 0, scale: MIN_SCALE })

    const fadeIn = [0.25, 0.5, 0.75, 1, 1.25].map((t) => appearance(s, 10 + t))
    const fadeOut = [0.25, 0.5, 0.75, 1, 1.25].map((t) => appearance(s, 25 - FADE_SECONDS + t))
    for (let i = 1; i < 5; i++) {
      expect(fadeIn[i].opacity).toBeGreaterThan(fadeIn[i - 1].opacity)
      expect(fadeIn[i].scale).toBeGreaterThan(fadeIn[i - 1].scale)
      expect(fadeOut[i].opacity).toBeLessThan(fadeOut[i - 1].opacity)
      expect(fadeOut[i].scale).toBeLessThan(fadeOut[i - 1].scale)
    }
    // Ease-out growth is past halfway at mid-fade; ease-in shrink is not.
    expect(appearance(s, 10 + FADE_SECONDS / 2).opacity).toBeGreaterThan(0.5)
    expect(appearance(s, 25 - FADE_SECONDS / 2).opacity).toBeGreaterThan(0.5)
  })

  test('spawned sprites stay on screen within the configured ranges', () => {
    for (const screen of [
      { width: 390, height: 844 },
      { width: 1920, height: 1080 },
    ]) {
      const short = Math.min(screen.width, screen.height)
      for (let i = 0; i < 200; i++) {
        const s = spawnSprite(PRESETS[0], screen, 0)
        expect(s.lifetime).toBeGreaterThanOrEqual(12)
        expect(s.lifetime).toBeLessThanOrEqual(20)
        expect(Math.abs(s.spin)).toBeLessThanOrEqual(0.2)
        expect(s.baseScale / short).toBeGreaterThanOrEqual(0.25)
        expect(s.baseScale / short).toBeLessThanOrEqual(0.45)
        const speed = Math.hypot(s.vx, s.vy) / short
        expect(speed).toBeGreaterThanOrEqual(0.02)
        expect(speed).toBeLessThanOrEqual(0.05)
        for (const t of [0, s.lifetime / 2, s.lifetime]) {
          const x = s.x + s.vx * t
          const y = s.y + s.vy * t
          expect(x).toBeGreaterThanOrEqual(-1e-9)
          expect(x).toBeLessThanOrEqual(screen.width + 1e-9)
          expect(y).toBeGreaterThanOrEqual(-1e-9)
          expect(y).toBeLessThanOrEqual(screen.height + 1e-9)
        }
      }
    }
  })

  test('the number of sprites grows from 6 on a phone to 12 on a large screen', () => {
    expect(targetCount({ width: 390, height: 844 })).toBe(6)
    expect(targetCount({ width: 320, height: 568 })).toBe(6)
    const laptop = targetCount({ width: 1280, height: 720 })
    expect(laptop).toBeGreaterThan(6)
    expect(laptop).toBeLessThan(12)
    expect(targetCount({ width: 1920, height: 1080 })).toBe(12)
    expect(targetCount({ width: 3840, height: 2160 })).toBe(12)
  })

  test('the scheduler shows one sprite at once, staggers the rest and replaces the dead', () => {
    const screen = { width: 1920, height: 1080 }
    const scheduler = new Scheduler(() => PRESETS[1])
    expect(scheduler.update(0, screen)).toHaveLength(1)

    const births = new Set<number>()
    const deaths: number[] = []
    let previous: readonly Sprite[] = []
    for (let step = 1; step <= 600; step++) {
      const t = step / 10
      const sprites = [...scheduler.update(t, screen)]
      for (const s of previous) if (!sprites.includes(s)) deaths.push(t)
      for (const s of sprites) births.add(s.bornAt)
      previous = sprites
      expect(sprites.length).toBeLessThanOrEqual(12)
      if (t > MAX_SPAWN_DELAY) {
        // Each free slot is filled within MAX_SPAWN_DELAY.
        const recent = deaths.filter((d) => d > t - MAX_SPAWN_DELAY - 0.1).length
        expect(sprites.length).toBeGreaterThanOrEqual(12 - recent)
      }
    }
    expect(deaths.length).toBeGreaterThan(12)
    expect([...births].filter((b) => b <= MAX_SPAWN_DELAY).length).toBeGreaterThan(3)
  })

  test('the scheduler skips a slot when there is nothing to pick', () => {
    const scheduler = new Scheduler(() => undefined)
    expect(scheduler.update(0, { width: 800, height: 600 })).toHaveLength(0)
    expect(scheduler.update(0, { width: 0, height: 0 })).toHaveLength(0)
  })
})
