<script setup lang="ts">
defineProps<{ message: string | null }>()
</script>

<template>
  <div
    role="status"
    aria-live="polite"
    class="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex justify-center px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]"
  >
    <Transition
      enter-from-class="translate-y-2 opacity-0"
      leave-to-class="translate-y-2 opacity-0"
      enter-active-class="transition duration-200"
      leave-active-class="transition duration-200"
    >
      <p
        v-if="message"
        :key="message"
        class="max-w-sm rounded-lg border border-scope-900 bg-zinc-900/95 px-4 py-2.5 text-center text-sm text-scope-200 shadow-lg shadow-black"
      >
        {{ message }}
      </p>
    </Transition>
  </div>
</template>
