<script setup lang="ts">
import { CheckCheck, LoaderCircle, RefreshCw, Trash2, X } from 'lucide-vue-next'
import { computed, ref } from 'vue'
import { useAdminStore } from '../stores/admin'
import { useConfigStore } from '../stores/config'
import AdminConfirmDialog from './AdminConfirmDialog.vue'
import AdminDrawingCard from './AdminDrawingCard.vue'

const admin = useAdminStore()
const config = useConfigStore()

const confirming = ref(false)
const count = computed(() => admin.selection.size)

const timeFormat = new Intl.DateTimeFormat('ja-JP', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
})

function formatTime(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : timeFormat.format(date)
}

async function confirmDelete() {
  await admin.deleteSelected()
  confirming.value = false
}

const button =
  'flex items-center gap-1.5 rounded-md border border-zinc-700 px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-800 disabled:opacity-40 disabled:hover:bg-transparent'
</script>

<template>
  <section aria-labelledby="admin-drawings-title" class="flex flex-col gap-3">
    <div class="flex flex-wrap items-center gap-2">
      <h2 id="admin-drawings-title" class="mr-auto text-sm font-semibold text-zinc-200">
        絵の一覧
        <span class="ml-1 font-normal text-zinc-500">{{ admin.drawings.length }} 枚</span>
        <span v-if="count" class="ml-1 font-normal text-scope-400">（{{ count }} 枚選択中）</span>
      </h2>
      <button type="button" :class="button" :disabled="admin.loading" @click="admin.refresh()">
        <RefreshCw class="size-4" :class="admin.loading && 'animate-spin'" aria-hidden="true" />
        再読み込み
      </button>
      <button
        type="button"
        :class="button"
        :disabled="admin.drawings.length === 0"
        @click="admin.selectAll()"
      >
        <CheckCheck class="size-4" aria-hidden="true" />
        すべて選択
      </button>
      <button type="button" :class="button" :disabled="count === 0" @click="admin.clearSelection()">
        <X class="size-4" aria-hidden="true" />
        選択解除
      </button>
      <button
        type="button"
        class="flex items-center gap-1.5 rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-500 disabled:bg-zinc-800 disabled:text-zinc-500"
        :disabled="count === 0 || admin.busy"
        @click="confirming = true"
      >
        <Trash2 class="size-4" aria-hidden="true" />
        選択した絵を削除
      </button>
    </div>

    <p
      v-if="admin.loading && admin.drawings.length === 0"
      class="flex items-center gap-2 py-8 text-sm text-zinc-500"
    >
      <LoaderCircle class="size-4 animate-spin" aria-hidden="true" />
      読み込み中…
    </p>
    <p v-else-if="admin.drawings.length === 0" class="py-8 text-sm text-zinc-500">
      まだ絵がありません。
    </p>
    <ul v-else class="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-3" aria-label="絵">
      <li v-for="d in admin.drawings" :key="d.id">
        <AdminDrawingCard
          :drawing="d"
          :area="config.area"
          :label="formatTime(d.createdAt)"
          :selected="admin.selection.has(d.id)"
          @toggle="(selected) => admin.toggle(d.id, selected)"
        />
      </li>
    </ul>

    <AdminConfirmDialog
      :open="confirming"
      title="絵を削除しますか？"
      :message="`選択した ${count} 枚の絵を削除します。投影中の画面からも消え、元に戻せません。`"
      confirm-label="削除"
      :busy="admin.busy"
      @confirm="confirmDelete"
      @cancel="confirming = false"
    />
  </section>
</template>
