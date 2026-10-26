<script setup lang="ts">
import { Trash2, Waves, X } from 'lucide-vue-next'
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: []; deleteMine: [] }>()

const closeButton = ref<HTMLButtonElement | null>(null)

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.preventDefault()
    emit('close')
  }
}

watch(
  () => props.open,
  async (open) => {
    if (open) {
      document.addEventListener('keydown', onKeydown)
      await nextTick()
      closeButton.value?.focus()
    } else {
      document.removeEventListener('keydown', onKeydown)
    }
  },
)

onBeforeUnmount(() => document.removeEventListener('keydown', onKeydown))
</script>

<template>
  <Transition
    enter-from-class="opacity-0"
    leave-to-class="opacity-0"
    enter-active-class="transition duration-200"
    leave-active-class="transition duration-200"
  >
    <div v-if="open" class="fixed inset-0 z-40 bg-black/60" @click="emit('close')" />
  </Transition>
  <Transition
    enter-from-class="-translate-x-full"
    leave-to-class="-translate-x-full"
    enter-active-class="transition-transform duration-200 ease-out"
    leave-active-class="transition-transform duration-150 ease-in"
  >
    <nav
      v-if="open"
      role="dialog"
      aria-modal="true"
      aria-label="メニュー"
      class="fixed inset-y-0 left-0 z-40 flex w-72 max-w-[85vw] flex-col border-r border-zinc-800 bg-zinc-950 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] shadow-2xl shadow-black"
    >
      <div class="flex items-center justify-end p-1.5">
        <button
          ref="closeButton"
          type="button"
          aria-label="閉じる"
          title="閉じる"
          class="flex size-11 items-center justify-center rounded-lg text-zinc-300 outline-none hover:bg-zinc-800 focus-visible:ring-2 focus-visible:ring-scope-500"
          @click="emit('close')"
        >
          <X :size="22" />
        </button>
      </div>
      <ul class="flex flex-col gap-1 px-2">
        <li>
          <button
            type="button"
            class="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left text-sm text-zinc-200 outline-none hover:bg-zinc-800 focus-visible:ring-2 focus-visible:ring-scope-500"
            @click="emit('deleteMine')"
          >
            <Trash2 :size="20" class="shrink-0 text-zinc-400" aria-hidden="true" />
            アップロードした絵の消去…
          </button>
        </li>
        <li>
          <RouterLink
            to="/float"
            class="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-sm text-zinc-200 outline-none hover:bg-zinc-800 focus-visible:ring-2 focus-visible:ring-scope-500"
          >
            <Waves :size="20" class="shrink-0 text-zinc-400" aria-hidden="true" />
            浮遊デモを見る
          </RouterLink>
        </li>
      </ul>
    </nav>
  </Transition>
</template>
