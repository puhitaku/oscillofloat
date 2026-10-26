import { expect, test, type Page, type Request } from '@playwright/test'
import type { AppConfig, Drawing } from '../src/lib/types'

test.use({ locale: 'ja-JP', timezoneId: 'Asia/Tokyo' })

const square = {
  closed: true,
  points: [-0.5, 0.5, 0.5, -0.5].map((v, i) => ({ x: v, y: i % 2 ? v : -v })),
}

const drawings: Drawing[] = [
  { id: 'd3', createdAt: '2026-10-26T03:00:03Z', frame: { paths: [square] } },
  { id: 'd2', createdAt: '2026-10-26T03:00:02Z', frame: { paths: [square] } },
  {
    id: 'd1',
    createdAt: '2026-10-26T03:00:01Z',
    frame: { paths: [{ closed: false, points: [{ x: 0, y: 0 }] }] },
  },
]

// createdAt rendered in Asia/Tokyo with the page's ja-JP format.
const label = (second: number) => `2026/10/26 12:00:0${second} の絵`

interface Mock {
  requests: Request[]
  amplifyRequests: string[]
  list: Drawing[]
}

async function mockApi(page: Page, config: AppConfig): Promise<Mock> {
  const mock: Mock = { requests: [], amplifyRequests: [], list: [...drawings] }
  await page.route('**/api/config', (route) => route.fulfill({ json: config }))
  await page.route('**/api/admin/**', async (route) => {
    const req = route.request()
    mock.requests.push(req)
    const path = new URL(req.url()).pathname
    if (path === '/api/admin/drawings' && req.method() === 'GET') {
      return route.fulfill({ json: { drawings: mock.list } })
    }
    if (path === '/api/admin/drawings' && req.method() === 'DELETE') {
      const { ids } = req.postDataJSON() as { ids: string[] }
      mock.list = mock.list.filter((d) => !ids.includes(d.id))
      return route.fulfill({ json: { deleted: ids.length } })
    }
    if (path === '/api/admin/settings' && req.method() === 'PUT') {
      return route.fulfill({ json: req.postDataJSON() })
    }
    return route.fulfill({ status: 404, json: { error: 'not found' } })
  })
  await page.route(/amazonaws\.com/, (route) => {
    mock.amplifyRequests.push(route.request().url())
    return route.abort()
  })
  return mock
}

const noAuth: AppConfig = { auth: null, settings: { aspect: '5:4' } }

test.describe('without Cognito', () => {
  test('shows the development note and one thumbnail per drawing', async ({ page }) => {
    await mockApi(page, noAuth)
    await page.goto('/admin')

    await expect(page.getByText('認証なしモード（開発用）')).toBeVisible()
    await expect(page.getByRole('button', { name: 'ログアウト' })).toHaveCount(0)
    const list = page.getByRole('list', { name: '絵' })
    await expect(list.getByRole('listitem')).toHaveCount(drawings.length)
    for (const s of [1, 2, 3]) {
      await expect(page.getByRole('img', { name: label(s) })).toBeVisible()
    }
  })

  test('deletes the selected drawings after confirmation and reloads the list', async ({
    page,
  }) => {
    const mock = await mockApi(page, noAuth)
    await page.goto('/admin')

    const remove = page.getByRole('button', { name: '選択した絵を削除' })
    await expect(remove).toBeDisabled()
    await page.getByRole('checkbox', { name: `${label(3)}を選択` }).check()
    await page.getByRole('checkbox', { name: `${label(1)}を選択` }).check()
    await remove.click()

    const dialog = page.getByRole('dialog', { name: '絵を削除しますか？' })
    await expect(dialog).toBeVisible()
    expect(mock.requests.filter((r) => r.method() === 'DELETE')).toHaveLength(0)
    const listsBefore = mock.requests.filter((r) => r.method() === 'GET').length
    await dialog.getByRole('button', { name: '削除' }).click()

    await expect(dialog).toBeHidden()
    await expect(page.getByRole('list', { name: '絵' }).getByRole('listitem')).toHaveCount(1)
    await expect(page.getByRole('img', { name: label(2) })).toBeVisible()
    const deletes = mock.requests.filter((r) => r.method() === 'DELETE')
    expect(deletes).toHaveLength(1)
    expect((deletes[0].postDataJSON() as { ids: string[] }).ids.sort()).toEqual(['d1', 'd3'])
    expect(mock.requests.filter((r) => r.method() === 'GET').length).toBe(listsBefore + 1)
    await expect(remove).toBeDisabled()
  })

  test('cancelling the confirmation deletes nothing', async ({ page }) => {
    const mock = await mockApi(page, noAuth)
    await page.goto('/admin')

    await page.getByRole('button', { name: 'すべて選択' }).click()
    await page.getByRole('button', { name: '選択した絵を削除' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'キャンセル' }).click()

    await expect(page.getByRole('dialog')).toBeHidden()
    await expect(page.getByRole('list', { name: '絵' }).getByRole('listitem')).toHaveCount(3)
    expect(mock.requests.filter((r) => r.method() === 'DELETE')).toHaveLength(0)
    await page.getByRole('button', { name: '選択解除' }).click()
    await expect(page.getByRole('button', { name: '選択した絵を削除' })).toBeDisabled()
  })

  test('saves a valid aspect ratio', async ({ page }) => {
    const mock = await mockApi(page, noAuth)
    await page.goto('/admin')

    const input = page.getByLabel('オシロスコープ画面のアスペクト比（W:H）')
    await expect(input).toHaveValue('5:4')
    await input.fill('4:3')
    await page.getByRole('button', { name: '保存' }).click()

    await expect(page.getByText('アスペクト比を保存しました')).toBeVisible()
    const puts = mock.requests.filter((r) => r.method() === 'PUT')
    expect(puts).toHaveLength(1)
    expect(new URL(puts[0].url()).pathname).toBe('/api/admin/settings')
    expect(puts[0].postDataJSON()).toEqual({ aspect: '4:3' })
  })

  test('rejects an invalid aspect ratio without a request', async ({ page }) => {
    const mock = await mockApi(page, noAuth)
    await page.goto('/admin')

    const input = page.getByLabel('オシロスコープ画面のアスペクト比（W:H）')
    await input.fill('abc')
    await page.getByRole('button', { name: '保存' }).click()

    await expect(input).toHaveAttribute('aria-invalid', 'true')
    await expect(page.getByRole('alert')).toContainText('正の整数')
    expect(mock.requests.filter((r) => r.method() === 'PUT')).toHaveLength(0)
  })
})

test.describe('with Cognito', () => {
  const withAuth: AppConfig = {
    auth: { region: 'xx-test-1', userPoolId: 'xx-test-1_placeholder', clientId: 'placeholder' },
    settings: { aspect: '5:4' },
  }

  test('shows the passkey login and the first-time setup without calling Cognito', async ({
    page,
  }) => {
    const mock = await mockApi(page, withAuth)
    await page.goto('/admin')

    await expect(page.getByRole('heading', { name: '管理ページにログイン' })).toBeVisible()
    await expect(page.getByLabel('メールアドレス').first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'パスキーでログイン' })).toBeVisible()
    await expect(page.getByText('認証なしモード（開発用）')).toHaveCount(0)

    const setup = page.getByRole('button', { name: '初回設定' })
    await expect(setup).toHaveAttribute('aria-expanded', 'false')
    await expect(page.getByLabel('仮パスワード')).toBeHidden()
    await setup.click()
    await expect(setup).toHaveAttribute('aria-expanded', 'true')
    await expect(page.getByLabel('仮パスワード')).toBeVisible()
    await expect(
      page.getByRole('button', { name: '仮パスワードでログインしてパスキーを登録' }),
    ).toBeVisible()

    expect(mock.amplifyRequests).toEqual([])
    expect(mock.requests).toEqual([])
  })
})
