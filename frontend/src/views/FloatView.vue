<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { pose, Scheduler } from '../lib/float'
import { PRESETS } from '../lib/presets'
import { renderFrame } from '../lib/render'
import { useGalleryStore } from '../stores/gallery'

const gallery = useGalleryStore()
const canvas = ref<HTMLCanvasElement | null>(null)
const scheduler = new Scheduler(() => gallery.pickRandom(PRESETS))
let raf = 0

if (import.meta.env.DEV) (window as { __gallery?: unknown }).__gallery = gallery

function draw(ms: number) {
  raf = requestAnimationFrame(draw)
  const el = canvas.value
  const ctx = el?.getContext('2d')
  if (!el || !ctx) return

  // Sized here rather than on resize events: moving the window to the
  // projector changes devicePixelRatio without resizing anything.
  const dpr = window.devicePixelRatio || 1
  const width = el.clientWidth
  const height = el.clientHeight
  const pw = Math.round(width * dpr)
  const ph = Math.round(height * dpr)
  if (el.width !== pw || el.height !== ph) {
    el.width = pw
    el.height = ph
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, pw, ph)

  const now = ms / 1000
  for (const s of scheduler.update(now, { width, height })) {
    const p = pose(s, now)
    if (p.opacity <= 0) continue
    ctx.save()
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.translate(p.x, p.y)
    ctx.rotate(p.angle)
    ctx.globalAlpha = p.opacity
    // The growth goes through `size`, not ctx.scale(), so the stroke keeps
    // its width. shadowBlur ignores the transform, hence the dpr.
    renderFrame(ctx, s.drawing.frame, {
      size: p.size,
      x: -p.size / 2,
      y: -p.size / 2,
      lineWidth: 2,
      shadowBlur: 10 * dpr,
    })
    ctx.restore()
  }
}

onMounted(() => {
  gallery.connect()
  raf = requestAnimationFrame(draw)
})

onUnmounted(() => {
  cancelAnimationFrame(raf)
  gallery.close()
})
</script>

<template>
  <div class="relative h-full cursor-none bg-black">
    <canvas ref="canvas" role="img" aria-label="みんなの絵" class="block h-full w-full" />
    <Transition leave-active-class="transition-opacity duration-1000" leave-to-class="opacity-0">
      <p
        v-if="!gallery.connected"
        role="status"
        class="pointer-events-none absolute right-4 bottom-3 text-xs text-zinc-600"
      >
        接続中…
      </p>
    </Transition>
  </div>
</template>
