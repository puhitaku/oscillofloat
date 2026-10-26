<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, useId, watch } from 'vue'

const props = defineProps<{
  open: boolean
  title: string
  message?: string
  confirmLabel: string
  cancelLabel?: string
}>()

const emit = defineEmits<{ confirm: []; cancel: [] }>()

const id = useId()
const confirmButton = ref<HTMLButtonElement | null>(null)
const cancelButton = ref<HTMLButtonElement | null>(null)
let returnFocus: HTMLElement | null = null

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.preventDefault()
    emit('cancel')
    return
  }
  if (e.key !== 'Tab') return
  // Only two focusable elements: Tab keeps cycling between them.
  e.preventDefault()
  const next = document.activeElement === confirmButton.value ? cancelButton : confirmButton
  next.value?.focus()
}

watch(
  () => props.open,
  async (open) => {
    if (open) {
      returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
      document.addEventListener('keydown', onKeydown)
      await nextTick()
      confirmButton.value?.focus()
    } else {
      document.removeEventListener('keydown', onKeydown)
      returnFocus?.focus()
      returnFocus = null
    }
  },
  { immediate: true },
)

onBeforeUnmount(() => document.removeEventListener('keydown', onKeydown))
</script>

<template>
  <Transition
    enter-from-class="opacity-0"
    leave-to-class="opacity-0"
    enter-active-class="transition duration-150"
    leave-active-class="transition duration-150"
  >
    <div
      v-if="open"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4"
      @click.self="emit('cancel')"
    >
      <div
        role="dialog"
        aria-modal="true"
        :aria-labelledby="`${id}-title`"
        :aria-describedby="message ? `${id}-message` : undefined"
        class="w-full max-w-xs rounded-xl border border-zinc-800 bg-zinc-950 p-5 shadow-2xl shadow-black"
      >
        <h2 :id="`${id}-title`" class="text-base font-semibold text-zinc-100">{{ title }}</h2>
        <p v-if="message" :id="`${id}-message`" class="mt-2 text-sm leading-relaxed text-zinc-400">
          {{ message }}
        </p>
        <div class="mt-5 flex justify-end gap-2">
          <button
            ref="cancelButton"
            type="button"
            class="rounded-lg px-4 py-2 text-sm text-zinc-300 outline-none hover:bg-zinc-800 focus-visible:ring-2 focus-visible:ring-zinc-500"
            @click="emit('cancel')"
          >
            {{ cancelLabel ?? 'キャンセル' }}
          </button>
          <button
            ref="confirmButton"
            type="button"
            class="rounded-lg bg-scope-500 px-4 py-2 text-sm font-semibold text-black outline-none hover:bg-scope-400 focus-visible:ring-2 focus-visible:ring-scope-200 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
            @click="emit('confirm')"
          >
            {{ confirmLabel }}
          </button>
        </div>
      </div>
    </div>
  </Transition>
</template>
