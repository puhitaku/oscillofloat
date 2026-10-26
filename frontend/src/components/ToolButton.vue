<script setup lang="ts">
defineProps<{
  label: string
  /** Set for tool buttons only, so that actions are not announced as toggles. */
  pressed?: boolean
  disabled?: boolean
}>()

defineEmits<{ click: [] }>()
</script>

<template>
  <button
    type="button"
    :aria-label="label"
    :title="label"
    :aria-pressed="pressed"
    :disabled="disabled"
    class="flex size-10 shrink-0 items-center justify-center rounded-lg transition-colors outline-none focus-visible:ring-2 focus-visible:ring-scope-500 disabled:cursor-default disabled:text-zinc-700 sm:size-11"
    :class="
      pressed
        ? 'bg-scope-900 text-scope-400 ring-1 ring-scope-700'
        : 'text-zinc-300 enabled:hover:bg-zinc-800 enabled:active:bg-zinc-700'
    "
    @click="$emit('click')"
  >
    <slot />
  </button>
</template>
