import { expect, test, type Page, type Request } from '@playwright/test'

type Point = { x: number; y: number }
type UploadBody = { frame: { paths: { closed: boolean; points: Point[] }[] } }

interface Recorded {
  uploads: Request[]
  deletes: Request[]
}

async function setup(page: Page, uploadStatus = 201): Promise<Recorded> {
  const recorded: Recorded = { uploads: [], deletes: [] }
  await page.route('**/api/config', (route) =>
    route.fulfill({ json: { auth: null, settings: { aspect: '5:4' } } }),
  )
  await page.route('**/api/drawings', async (route) => {
    const request = route.request()
    if (request.method() === 'POST') {
      recorded.uploads.push(request)
      if (uploadStatus >= 400) {
        await route.fulfill({ status: uploadStatus, json: { error: 'refused' } })
        return
      }
      await route.fulfill({
        status: 201,
        json: { id: '0192f1a0-0000-7000-8000-000000000000', createdAt: '2026-10-26T12:00:00Z' },
      })
      return
    }
    if (request.method() === 'DELETE') {
      recorded.deletes.push(request)
      await route.fulfill({ json: { deleted: 3 } })
      return
    }
    await route.fallback()
  })
  await page.goto('/')
  await expect(canvas(page)).toBeVisible()
  return recorded
}

const canvas = (page: Page) => page.getByRole('img', { name: 'お絵かきキャンバス' })
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true })

/** Drags through scope coordinates ([-1, 1], +Y up) on the canvas. */
async function drag(page: Page, points: [number, number][], steps = 12) {
  const box = await canvas(page).boundingBox()
  if (!box) throw new Error('canvas has no box')
  const px = ([x, y]: [number, number]) =>
    [box.x + ((x + 1) / 2) * box.width, box.y + ((1 - y) / 2) * box.height] as const
  await page.mouse.move(...px(points[0]))
  await page.mouse.down()
  for (const p of points.slice(1)) await page.mouse.move(...px(p), { steps })
  await page.mouse.up()
}

async function sendAndCapture(page: Page, recorded: Recorded): Promise<UploadBody> {
  await button(page, '送信').click()
  const dialog = page.getByRole('dialog', { name: 'この絵を送信しますか？' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: '送信する' }).click()
  await expect(page.getByRole('status')).toHaveText('送信しました')
  return recorded.uploads.at(-1)!.postDataJSON() as UploadBody
}

test('a drag on the canvas creates a path and enables send and undo', async ({ page }) => {
  await setup(page)
  await expect(button(page, '送信')).toBeDisabled()
  await expect(button(page, '元に戻す')).toBeDisabled()
  await expect(button(page, 'やり直す')).toBeDisabled()

  await drag(page, [
    [-0.5, 0],
    [0.5, 0.2],
  ])

  await expect(button(page, '送信')).toBeEnabled()
  await expect(button(page, '元に戻す')).toBeEnabled()
  await expect(button(page, 'やり直す')).toBeDisabled()
})

test('undo and redo step through drags', async ({ page }) => {
  await setup(page)
  await drag(page, [
    [-0.5, 0],
    [0.5, 0],
  ])
  await drag(page, [
    [-0.5, 0.4],
    [0.5, 0.4],
  ])

  await button(page, '元に戻す').click()
  await expect(button(page, 'やり直す')).toBeEnabled()
  await expect(button(page, '送信')).toBeEnabled()

  await button(page, '元に戻す').click()
  await expect(button(page, '元に戻す')).toBeDisabled()
  await expect(button(page, '送信')).toBeDisabled()

  await button(page, 'やり直す').click()
  await button(page, 'やり直す').click()
  await expect(button(page, 'やり直す')).toBeDisabled()
  await expect(button(page, '元に戻す')).toBeEnabled()
})

test('the eraser cuts a stroke it crosses into two paths', async ({ page }) => {
  const recorded = await setup(page)
  await drag(page, [
    [-0.6, 0],
    [0.6, 0],
  ])

  await button(page, '消しゴム（大）').click()
  await expect(button(page, '消しゴム（大）')).toHaveAttribute('aria-pressed', 'true')
  await expect(button(page, 'ペン')).toHaveAttribute('aria-pressed', 'false')
  await drag(page, [
    [0, 0.3],
    [0, -0.3],
  ])

  const body = await sendAndCapture(page, recorded)
  expect(body.frame.paths).toHaveLength(2)
  const xs = body.frame.paths.flatMap((p) => p.points.map((q) => q.x))
  expect(xs.every((x) => Math.abs(x) >= 0.07)).toBe(true)
})

test('undo restores what the eraser removed', async ({ page }) => {
  const recorded = await setup(page)
  await drag(page, [
    [-0.6, 0],
    [0.6, 0],
  ])
  await button(page, '消しゴム（小）').click()
  await drag(page, [
    [0, 0.2],
    [0, -0.2],
  ])
  await button(page, '元に戻す').click()

  const body = await sendAndCapture(page, recorded)
  expect(body.frame.paths).toHaveLength(1)
})

test('strokes are kept inside the band of the aspect ratio', async ({ page }) => {
  const recorded = await setup(page)
  await drag(page, [
    [-0.8, 0.99],
    [0.8, 0.95],
    [0.9, 0.5],
  ])

  const body = await sendAndCapture(page, recorded)
  const ys = body.frame.paths.flatMap((p) => p.points.map((q) => q.y))
  expect(ys.length).toBeGreaterThan(0)
  expect(ys.every((y) => Math.abs(y) <= 0.8)).toBe(true)
  expect(ys).toContain(0.8)
})

test('send asks for confirmation and uploads the frame with the session ID', async ({ page }) => {
  const recorded = await setup(page)
  await drag(page, [
    [-0.5, -0.5],
    [0.5, 0.5],
  ])

  await button(page, '送信').click()
  const dialog = page.getByRole('dialog', { name: 'この絵を送信しますか？' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('button', { name: '送信する' })).toBeFocused()
  expect(recorded.uploads).toHaveLength(0)

  await dialog.getByRole('button', { name: '送信する' }).click()
  await expect(page.getByRole('status')).toHaveText('送信しました')
  await expect(dialog).toBeHidden()

  expect(recorded.uploads).toHaveLength(1)
  const request = recorded.uploads[0]
  expect(request.headers()['x-session-id']).toMatch(/^[A-Za-z0-9_-]{16,64}$/)
  const body = request.postDataJSON() as UploadBody
  expect(body.frame.paths).toHaveLength(1)
  expect(body.frame.paths[0].closed).toBe(false)
  // A straight drag simplifies to its two end points.
  expect(body.frame.paths[0].points).toHaveLength(2)

  await expect(button(page, '送信')).toBeEnabled()
})

test('escape cancels the send dialog without uploading', async ({ page }) => {
  const recorded = await setup(page)
  await drag(page, [
    [-0.5, 0],
    [0.5, 0],
  ])
  await button(page, '送信').click()
  const dialog = page.getByRole('dialog', { name: 'この絵を送信しますか？' })
  await expect(dialog).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  expect(recorded.uploads).toHaveLength(0)
})

test('a rate-limited upload shows a message', async ({ page }) => {
  await setup(page, 429)
  await drag(page, [
    [-0.5, 0],
    [0.5, 0],
  ])
  await button(page, '送信').click()
  await page.getByRole('button', { name: '送信する' }).click()
  await expect(page.getByRole('status')).toHaveText('送信が多すぎます。しばらく待ってください')
})

test('the menu deletes uploaded drawings with the same session ID', async ({ page }) => {
  const recorded = await setup(page)
  await drag(page, [
    [-0.5, 0],
    [0.5, 0],
  ])
  await sendAndCapture(page, recorded)

  await button(page, 'メニュー').click()
  const menu = page.getByRole('dialog', { name: 'メニュー' })
  await expect(menu.getByRole('link', { name: '浮遊デモを見る' })).toHaveAttribute('href', '/float')
  await menu.getByRole('button', { name: 'アップロードした絵の消去…' }).click()

  const dialog = page.getByRole('dialog', { name: 'アップロードした絵を消去しますか？' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: '消去する' }).click()
  await expect(page.getByRole('status')).toHaveText('3枚の絵を消去しました')

  expect(recorded.deletes).toHaveLength(1)
  const uploaded = recorded.uploads[0].headers()['x-session-id']
  expect(recorded.deletes[0].headers()['x-session-id']).toBe(uploaded)
})

test('the session ID survives a reload', async ({ page }) => {
  const recorded = await setup(page)
  await button(page, 'メニュー').click()
  await page.getByRole('button', { name: 'アップロードした絵の消去…' }).click()
  await page.getByRole('button', { name: '消去する' }).click()
  await expect(page.getByRole('status')).toBeVisible()

  await page.reload()
  await button(page, 'メニュー').click()
  await page.getByRole('button', { name: 'アップロードした絵の消去…' }).click()
  await page.getByRole('button', { name: '消去する' }).click()
  await expect(page.getByRole('status')).toBeVisible()

  expect(recorded.deletes).toHaveLength(2)
  const [first, second] = recorded.deletes.map((r) => r.headers()['x-session-id'])
  expect(second).toBe(first)
})

test('a leave warning is registered only while a path exists', async ({ page }) => {
  await setup(page)
  const warns = () =>
    page.evaluate(() => {
      const event = new Event('beforeunload', { cancelable: true })
      window.dispatchEvent(event)
      return event.defaultPrevented
    })

  expect(await warns()).toBe(false)
  await drag(page, [
    [-0.5, 0],
    [0.5, 0],
  ])
  expect(await warns()).toBe(true)
  await button(page, '元に戻す').click()
  await expect(button(page, '送信')).toBeDisabled()
  expect(await warns()).toBe(false)
})

test('leaving with a drawing shows the native warning', async ({ page }) => {
  await setup(page)
  await drag(page, [
    [-0.5, 0],
    [0.5, 0],
  ])
  const dialog = new Promise<string>((resolve) =>
    page.once('dialog', async (d) => {
      resolve(d.type())
      await d.accept()
    }),
  )
  await page.close({ runBeforeUnload: true })
  expect(await dialog).toBe('beforeunload')
})

test('the page fits the viewport and does not scroll', async ({ page }) => {
  await setup(page)
  const overflow = await page.evaluate(() => {
    const doc = document.scrollingElement!
    return { scroll: doc.scrollHeight - doc.clientHeight, width: doc.scrollWidth - doc.clientWidth }
  })
  expect(overflow).toEqual({ scroll: 0, width: 0 })
  const box = await canvas(page).boundingBox()
  const viewport = page.viewportSize()!
  expect(box!.width).toBeCloseTo(box!.height, 0)
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height)
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width)
})

test('a second finger is ignored while the first one draws', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'touch is dispatched through the Chrome DevTools Protocol')
  const recorded = await setup(page)
  const box = (await canvas(page).boundingBox())!
  const at = (x: number, y: number, id: number) => ({
    x: box.x + ((x + 1) / 2) * box.width,
    y: box.y + ((1 - y) / 2) * box.height,
    id,
  })
  const cdp = await page.context().newCDPSession(page)
  const touch = (
    type: 'touchStart' | 'touchMove' | 'touchEnd',
    touchPoints: ReturnType<typeof at>[],
  ) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints })

  await touch('touchStart', [at(-0.6, 0, 1)])
  await touch('touchMove', [at(-0.3, 0, 1)])
  await touch('touchMove', [at(-0.3, 0, 1), at(0, 0.5, 2)])
  for (let i = 1; i <= 5; i++)
    await touch('touchMove', [at(-0.3 + i * 0.1, 0, 1), at(0, 0.5 - i * 0.1, 2)])
  await touch('touchEnd', [])

  const body = await sendAndCapture(page, recorded)
  expect(body.frame.paths).toHaveLength(1)
  expect(body.frame.paths[0].points.every((p) => p.y === 0)).toBe(true)
})
