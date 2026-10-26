import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { api, ApiError } from '../lib/api'
import * as auth from '../lib/auth'
import type { Drawing } from '../lib/types'
import { useConfigStore } from './config'

/** Sign-in state, the drawing list and the operator's actions on the admin page. */
export const useAdminStore = defineStore('admin', () => {
  const config = useConfigStore()

  const ready = ref(false)
  const signedIn = ref(false)
  const token = ref('')
  const drawings = ref<Drawing[]>([])
  const selection = ref(new Set<string>())
  const loading = ref(false)
  const busy = ref(false)
  const error = ref('')
  const notice = ref('')

  /** True when the backend runs without Cognito and admin calls need no token. */
  const noAuth = computed(() => config.config !== null && config.auth === null)

  async function init() {
    ready.value = false
    if (!config.config) await config.load()
    if (!config.config) {
      error.value = '設定を読み込めませんでした。'
      return
    }
    error.value = ''
    if (config.auth) {
      auth.configure(config.auth)
      token.value = await auth.getToken()
      signedIn.value = token.value !== ''
    } else {
      token.value = ''
      signedIn.value = true
    }
    ready.value = true
    if (signedIn.value) await refresh()
  }

  async function signInWithPasskey(email: string) {
    await runAuth(async () => {
      const outcome = await auth.signInWithPasskey(email)
      if (outcome.kind === 'needsSetup') {
        error.value = 'パスキーがまだ登録されていません。下の「初回設定」から登録してください。'
        return
      }
      if (outcome.kind === 'unexpected') {
        error.value = `想定外のログイン手順を求められました: ${outcome.step}`
        return
      }
      await afterSignIn()
    })
  }

  async function setUpPasskey(email: string, temporaryPassword: string) {
    await runAuth(async () => {
      const outcome = await auth.signInWithTemporaryPassword(email, temporaryPassword)
      if (outcome.kind !== 'done') {
        error.value = `想定外のログイン手順を求められました: ${
          outcome.kind === 'unexpected' ? outcome.step : outcome.kind
        }`
        return
      }
      await afterSignIn()
      try {
        await auth.registerPasskey()
        notice.value = 'パスキーを登録しました'
      } catch (e) {
        error.value = `ログインしましたが、パスキーの登録に失敗しました。「パスキーを追加」からやり直してください。（${describeAuthError(e)}）`
      }
    })
  }

  async function addPasskey() {
    await runAuth(async () => {
      await auth.registerPasskey()
      notice.value = 'パスキーを登録しました'
    })
  }

  async function signOut(message = '') {
    await auth.signOut()
    signedIn.value = false
    token.value = ''
    drawings.value = []
    selection.value = new Set()
    notice.value = ''
    error.value = message
  }

  async function refresh() {
    loading.value = true
    try {
      const res = await withToken((t) => api.admin.drawings(t))
      if (!res) return
      drawings.value = res.drawings
      const ids = new Set(res.drawings.map((d) => d.id))
      selection.value = new Set([...selection.value].filter((id) => ids.has(id)))
    } finally {
      loading.value = false
    }
  }

  function toggle(id: string, selected: boolean) {
    const next = new Set(selection.value)
    if (selected) next.add(id)
    else next.delete(id)
    selection.value = next
  }

  function selectAll() {
    selection.value = new Set(drawings.value.map((d) => d.id))
  }

  function clearSelection() {
    selection.value = new Set()
  }

  async function deleteSelected() {
    const ids = [...selection.value]
    if (ids.length === 0) return
    busy.value = true
    try {
      const res = await withToken((t) => api.admin.deleteDrawings(t, ids))
      if (!res) return
      selection.value = new Set()
      notice.value = `${res.deleted} 枚の絵を削除しました`
      await refresh()
    } finally {
      busy.value = false
    }
  }

  /** Saves the aspect ratio; resolves to whether the backend accepted it. */
  async function saveAspect(aspect: string): Promise<boolean> {
    busy.value = true
    try {
      const res = await withToken((t) => api.admin.setSettings(t, { aspect }))
      if (!res) return false
      config.setAspect(res.aspect)
      notice.value = 'アスペクト比を保存しました'
      return true
    } finally {
      busy.value = false
    }
  }

  async function afterSignIn() {
    token.value = await auth.getToken()
    signedIn.value = true
    await refresh()
  }

  async function runAuth(run: () => Promise<void>) {
    busy.value = true
    error.value = ''
    notice.value = ''
    try {
      await run()
    } catch (e) {
      error.value = describeAuthError(e)
    } finally {
      busy.value = false
    }
  }

  /**
   * Calls the admin API with a fresh token, turning failures into a message.
   * Resolves to undefined on failure. The token is fetched per call rather
   * than reusing the one from sign-in because Amplify refreshes it on expiry.
   */
  async function withToken<T>(call: (token: string) => Promise<T>): Promise<T | undefined> {
    error.value = ''
    try {
      if (config.auth) token.value = await auth.getToken()
      return await call(token.value)
    } catch (e) {
      if (e instanceof ApiError && e.status === 401 && config.auth) {
        await signOut('ログインの有効期限が切れました。もう一度ログインしてください。')
      } else if (e instanceof ApiError) {
        error.value = `サーバーエラー（${e.status}）: ${e.message}`
      } else {
        error.value = 'サーバーに接続できませんでした。'
      }
      return undefined
    }
  }

  return {
    ready,
    signedIn,
    token,
    drawings,
    selection,
    loading,
    busy,
    error,
    notice,
    noAuth,
    init,
    signInWithPasskey,
    setUpPasskey,
    addPasskey,
    signOut,
    refresh,
    toggle,
    selectAll,
    clearSelection,
    deleteSelected,
    saveAspect,
  }
})

/** A Japanese message for an error thrown by Amplify or the browser during sign-in. */
function describeAuthError(e: unknown): string {
  const name = e instanceof Error ? e.name : ''
  const message = e instanceof Error ? e.message : String(e)
  switch (name) {
    case 'NotAuthorizedException':
      return 'メールアドレスまたはパスワードが正しくありません。'
    case 'UserNotFoundException':
      return 'このメールアドレスのユーザーは登録されていません。'
    case 'PasswordResetRequiredException':
      return 'パスワードのリセットが必要です。管理者に仮パスワードの再発行を依頼してください。'
    case 'PasskeyAuthenticationCanceled':
    case 'PasskeyRegistrationCanceled':
    case 'PasskeyOperationAborted':
    case 'NotAllowedError':
      return 'パスキーの操作がキャンセルされました。'
    case 'PasskeyNotSupported':
      return 'このブラウザはパスキーに対応していません。'
    case 'PasskeyAlreadyExists':
      return 'この端末のパスキーはすでに登録されています。'
    case 'RelyingPartyMismatch':
      return 'このドメインではパスキーを使えません。'
    case 'TooManyRequestsException':
    case 'LimitExceededException':
      return '試行回数が多すぎます。しばらく待ってからやり直してください。'
    default:
      return `認証処理に失敗しました（${name || 'Error'}: ${message}）`
  }
}
