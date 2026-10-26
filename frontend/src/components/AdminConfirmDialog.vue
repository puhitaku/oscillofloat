<script setup lang="ts">
import { nextTick, ref, useId, watch } from 'vue'

const props = defineProps<{
  open: boolean
  title: string
  message: string
  confirmLabel: string
  busy?: boolean
}>()
const emit = defineEmits<{ confirm: []; cancel: [] }>()

const titleId = useId()
const messageId = useId()
const cancelButton = ref<HTMLButtonElement | null>(null)
let returnFocus: HTMLElement | null = null

watch(
  () => props.open,
  async (open) => {
    if (open) {
      returnFocus = document.activeElement as HTMLElement | null
      await nextTick()
      cancelButton.value?.focus()
    } else {
      returnFocus?.focus()
      returnFocus = null
    }
  },
)

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && !props.busy) emit('cancel')
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      @click.self="!busy && emit('cancel')"
      @keydown="onKeydown"
    >
      <div
        role="dialog"
        aria-modal="true"
        :aria-labelledby="titleId"
        :aria-describedby="messageId"
        class="w-full max-w-sm rounded-xl border border-zinc-700 bg-zinc-950 p-5 shadow-2xl"
      >
        <h2 :id="titleId" class="text-base font-semibold text-zinc-100">{{ title }}</h2>
        <p :id="messageId" class="mt-2 text-sm text-zinc-400">{{ message }}</p>
        <div class="mt-5 flex justify-end gap-2">
          <button
            ref="cancelButton"
            type="button"
            class="rounded-md border border-zinc-700 px-4 py-2 text-sm text-zinc-200 hover:bg-zinc-800 disabled:opacity-50"
            :disabled="busy"
            @click="emit('cancel')"
          >
            キャンセル
          </button>
          <button
            type="button"
            class="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-50"
            :disabled="busy"
            @click="emit('confirm')"
          >
            {{ confirmLabel }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
