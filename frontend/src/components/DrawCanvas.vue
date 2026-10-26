<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { renderFrame } from '../lib/render'
import type { Vec } from '../lib/types'
import { eraserRadius, useDrawingStore } from '../stores/drawing'

const MARGIN = 12
const BACKGROUND = '#04110a'

const drawing = useDrawingStore()

const container = ref<HTMLDivElement | null>(null)
const canvas = ref<HTMLCanvasElement | null>(null)
const size = ref(0)
const cursor = ref<Vec | null>(null)

let activePointer: number | null = null
let observer: ResizeObserver | null = null
let frameRequest = 0

const radius = computed(() => eraserRadius(drawing.tool))

function toScope(e: PointerEvent): Vec {
  const rect = canvas.value!.getBoundingClientRect()
  return [
    ((e.clientX - rect.left) / rect.width) * 2 - 1,
    1 - ((e.clientY - rect.top) / rect.height) * 2,
  ]
}

function samples(e: PointerEvent): PointerEvent[] {
  const coalesced = e.getCoalescedEvents?.()
  return coalesced && coalesced.length > 0 ? coalesced : [e]
}

function onPointerDown(e: PointerEvent) {
  if (activePointer !== null) return
  if (e.pointerType === 'mouse' && e.button !== 0) return
  e.preventDefault()
  activePointer = e.pointerId
  canvas.value!.setPointerCapture(e.pointerId)
  const p = toScope(e)
  cursor.value = p
  drawing.start(p)
}

function onPointerMove(e: PointerEvent) {
  if (e.pointerId !== activePointer) {
    if (activePointer === null && e.pointerType === 'mouse') cursor.value = toScope(e)
    return
  }
  for (const sample of samples(e)) drawing.move(toScope(sample))
  cursor.value = toScope(e)
}

function onPointerEnd(e: PointerEvent) {
  if (e.pointerId !== activePointer) return
  activePointer = null
  drawing.end()
  if (e.pointerType !== 'mouse') cursor.value = null
}

function onPointerLeave(e: PointerEvent) {
  if (activePointer === null && e.pointerType === 'mouse') cursor.value = null
}

function drawBackground(ctx: CanvasRenderingContext2D, s: number) {
  const px = (x: number) => ((x + 1) / 2) * s
  const py = (y: number) => ((1 - y) / 2) * s

  ctx.fillStyle = BACKGROUND
  ctx.fillRect(0, 0, s, s)

  ctx.lineWidth = 1
  for (let i = -4; i <= 4; i++) {
    const v = i / 5
    ctx.strokeStyle = i === 0 ? 'rgba(61, 255, 127, 0.14)' : 'rgba(61, 255, 127, 0.06)'
    ctx.beginPath()
    ctx.moveTo(px(v), 0)
    ctx.lineTo(px(v), s)
    ctx.moveTo(0, py(v))
    ctx.lineTo(s, py(v))
    ctx.stroke()
  }

  const [ax, ay] = drawing.area
  const keepOut: [number, number, number, number][] = []
  if (ay < 1) keepOut.push([0, 0, s, py(ay)], [0, py(-ay), s, s - py(-ay)])
  if (ax < 1) keepOut.push([0, 0, px(-ax), s], [px(ax), 0, s - px(ax), s])
  if (keepOut.length === 0) return

  ctx.save()
  ctx.beginPath()
  for (const [x, y, w, h] of keepOut) ctx.rect(x, y, w, h)
  ctx.clip()
  ctx.fillStyle = 'rgba(0, 0, 0, 0.6)'
  ctx.fillRect(0, 0, s, s)
  ctx.strokeStyle = 'rgba(161, 161, 170, 0.16)'
  ctx.beginPath()
  const step = 10
  for (let d = -s; d < s; d += step) {
    ctx.moveTo(d, s)
    ctx.lineTo(d + s, 0)
  }
  ctx.stroke()
  ctx.restore()

  ctx.save()
  ctx.strokeStyle = 'rgba(61, 255, 127, 0.35)'
  ctx.setLineDash([6, 6])
  ctx.strokeRect(px(-ax) + 0.5, py(ay) + 0.5, px(ax) - px(-ax) - 1, py(-ay) - py(ay) - 1)
  ctx.restore()
}

function draw() {
  frameRequest = 0
  const el = canvas.value
  const s = size.value
  if (!el || s <= 0) return
  const dpr = window.devicePixelRatio || 1
  const backing = Math.round(s * dpr)
  if (el.width !== backing || el.height !== backing) {
    el.width = backing
    el.height = backing
  }
  const ctx = el.getContext('2d')
  if (!ctx) return
  ctx.setTransform(backing / s, 0, 0, backing / s, 0, 0)

  drawBackground(ctx, s)
  // shadowBlur ignores the transform, so it is scaled by hand.
  renderFrame(ctx, { paths: drawing.paths }, { size: s, lineWidth: 2.5, shadowBlur: 6 * dpr })

  const r = radius.value
  if (r !== null && cursor.value) {
    const [cx, cy] = cursor.value
    ctx.save()
    ctx.strokeStyle = 'rgba(228, 228, 231, 0.8)'
    ctx.fillStyle = 'rgba(228, 228, 231, 0.08)'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.arc(((cx + 1) / 2) * s, ((1 - cy) / 2) * s, (r / 2) * s, 0, 2 * Math.PI)
    ctx.fill()
    ctx.stroke()
    ctx.restore()
  }
}

function scheduleDraw() {
  if (frameRequest === 0) frameRequest = requestAnimationFrame(draw)
}

function measure() {
  const el = container.value
  if (!el) return
  size.value = Math.max(0, Math.floor(Math.min(el.clientWidth, el.clientHeight) - MARGIN * 2))
  scheduleDraw()
}

watch(() => [drawing.paths, drawing.area, drawing.tool, cursor.value], scheduleDraw)

onMounted(() => {
  observer = new ResizeObserver(measure)
  observer.observe(container.value!)
  measure()
})

onBeforeUnmount(() => {
  observer?.disconnect()
  if (frameRequest !== 0) cancelAnimationFrame(frameRequest)
  if (activePointer !== null) drawing.end()
})
</script>

<template>
  <div ref="container" class="relative flex min-h-0 items-center justify-center overflow-hidden">
    <canvas
      ref="canvas"
      role="img"
      aria-label="お絵かきキャンバス"
      class="block touch-none rounded-sm ring-1 ring-zinc-800 select-none"
      :class="radius === null ? 'cursor-crosshair' : 'cursor-none'"
      :style="{ width: `${size}px`, height: `${size}px` }"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerEnd"
      @pointercancel="onPointerEnd"
      @lostpointercapture="onPointerEnd"
      @pointerleave="onPointerLeave"
      @contextmenu.prevent
    />
  </div>
</template>
