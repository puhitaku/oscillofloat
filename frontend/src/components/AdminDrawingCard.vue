<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { renderFrame } from '../lib/render'
import type { Drawing, Vec } from '../lib/types'

const props = defineProps<{
  drawing: Drawing
  /** Half extents of the drawable band, from drawableArea. */
  area: Vec
  label: string
  selected: boolean
}>()
const emit = defineEmits<{ toggle: [selected: boolean] }>()

const SIZE = 160
const canvas = ref<HTMLCanvasElement | null>(null)

function draw() {
  const el = canvas.value
  const ctx = el?.getContext('2d')
  if (!el || !ctx) return
  const dpr = window.devicePixelRatio || 1
  el.width = SIZE * dpr
  el.height = SIZE * dpr
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.fillStyle = '#050505'
  ctx.fillRect(0, 0, SIZE, SIZE)
  const [ax, ay] = props.area
  const bw = ax * SIZE
  const bh = ay * SIZE
  ctx.fillStyle = '#0a120d'
  ctx.fillRect((SIZE - bw) / 2, (SIZE - bh) / 2, bw, bh)
  renderFrame(ctx, props.drawing.frame, { size: SIZE, lineWidth: 1.5, shadowBlur: 4 })
}

onMounted(draw)
watch(() => [props.drawing, props.area], draw)
</script>

<template>
  <label
    class="group flex cursor-pointer flex-col gap-2 rounded-lg border p-2 transition-colors"
    :class="
      selected
        ? 'border-scope-500 bg-scope-950'
        : 'border-zinc-800 bg-zinc-950 hover:border-zinc-600'
    "
  >
    <canvas
      ref="canvas"
      class="aspect-square w-full rounded"
      role="img"
      :aria-label="`${label} の絵`"
    />
    <span class="flex items-center gap-2 text-xs text-zinc-400">
      <input
        type="checkbox"
        class="size-4 accent-scope-500"
        :checked="selected"
        :aria-label="`${label} の絵を選択`"
        @change="emit('toggle', ($event.target as HTMLInputElement).checked)"
      />
      <time :datetime="drawing.createdAt" class="tabular-nums">{{ label }}</time>
    </span>
  </label>
</template>
