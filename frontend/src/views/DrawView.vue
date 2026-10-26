<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import ConfirmDialog from '../components/ConfirmDialog.vue'
import DrawCanvas from '../components/DrawCanvas.vue'
import MenuDrawer from '../components/MenuDrawer.vue'
import Toast from '../components/Toast.vue'
import Toolbar from '../components/Toolbar.vue'
import { api, ApiError } from '../lib/api'
import { sessionId } from '../lib/session'
import { useConfigStore } from '../stores/config'
import { useDrawingStore } from '../stores/drawing'

const TOAST_MS = 2800

const config = useConfigStore()
const drawing = useDrawingStore()

const menuOpen = ref(false)
const confirmSend = ref(false)
const confirmDelete = ref(false)
const sending = ref(false)
const toast = ref<string | null>(null)
let toastTimer: ReturnType<typeof setTimeout> | undefined

function showToast(message: string) {
  clearTimeout(toastTimer)
  toast.value = message
  toastTimer = setTimeout(() => (toast.value = null), TOAST_MS)
}

watch(
  () => config.area,
  (area) => drawing.setArea(area),
  { immediate: true },
)

watch(
  () => drawing.limitHits,
  () => showToast('絵がいっぱいです。これ以上は描けません'),
)

function uploadErrorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 429) return '送信が多すぎます。しばらく待ってください'
    if (e.status === 400 || e.status === 413) return '絵が大きすぎるか不正です'
  }
  return '送信できませんでした。通信状況を確認してください'
}

async function send() {
  confirmSend.value = false
  if (drawing.isEmpty || sending.value) return
  sending.value = true
  try {
    await api.upload(sessionId(), drawing.frame())
    showToast('送信しました')
  } catch (e) {
    showToast(uploadErrorMessage(e))
  } finally {
    sending.value = false
  }
}

function openDelete() {
  menuOpen.value = false
  confirmDelete.value = true
}

async function deleteMine() {
  confirmDelete.value = false
  try {
    const { deleted } = await api.deleteMine(sessionId())
    showToast(deleted > 0 ? `${deleted}枚の絵を消去しました` : '消去する絵はありませんでした')
  } catch {
    showToast('消去できませんでした。通信状況を確認してください')
  }
}

// Returning a value as well as preventDefault: older Safari and Chrome only
// show the native warning for the legacy returnValue form.
function onBeforeUnload(e: BeforeUnloadEvent) {
  e.preventDefault()
  e.returnValue = ''
  return ''
}

watch(
  () => drawing.isEmpty,
  (empty) => {
    if (empty) window.removeEventListener('beforeunload', onBeforeUnload)
    else window.addEventListener('beforeunload', onBeforeUnload)
  },
  { immediate: true },
)

onMounted(() => {
  if (!config.config) config.load()
})

onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', onBeforeUnload)
  clearTimeout(toastTimer)
})
</script>

<template>
  <div class="flex h-full flex-col bg-black select-none">
    <Toolbar :sending="sending" @menu="menuOpen = true" @send="confirmSend = true" />
    <DrawCanvas class="flex-1" />

    <MenuDrawer :open="menuOpen" @close="menuOpen = false" @delete-mine="openDelete" />

    <ConfirmDialog
      :open="confirmSend"
      title="この絵を送信しますか？"
      message="送信した絵はオシロスコープと浮遊デモに表示されます。"
      confirm-label="送信する"
      @confirm="send"
      @cancel="confirmSend = false"
    />
    <ConfirmDialog
      :open="confirmDelete"
      title="アップロードした絵を消去しますか？"
      message="この端末から送信した絵をすべて消去します。元には戻せません。"
      confirm-label="消去する"
      @confirm="deleteMine"
      @cancel="confirmDelete = false"
    />

    <Toast :message="toast" />
  </div>
</template>
