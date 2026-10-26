import type { Frame } from './types'

export interface RenderOptions {
  /** Pixel size of the square the [-1, 1] frame maps to. */
  size: number
  /** Canvas origin of that square. */
  x?: number
  y?: number
  color?: string
  glow?: string
  lineWidth?: number
  /** Blur radius of the glow, 0 for none. */
  shadowBlur?: number
}

/**
 * Strokes a frame onto a 2D context with the oscilloscope's phosphor look.
 * +Y is up in the frame and down on the canvas. The caller sets any global
 * transform (rotation, opacity) before calling.
 */
export function renderFrame(ctx: CanvasRenderingContext2D, frame: Frame, o: RenderOptions) {
  const ox = o.x ?? 0
  const oy = o.y ?? 0
  const px = (x: number) => ox + ((x + 1) / 2) * o.size
  const py = (y: number) => oy + ((1 - y) / 2) * o.size

  ctx.save()
  ctx.strokeStyle = o.color ?? '#7dffa8'
  ctx.fillStyle = o.color ?? '#7dffa8'
  ctx.shadowColor = o.glow ?? '#3dff7f'
  ctx.shadowBlur = o.shadowBlur ?? 0
  ctx.lineWidth = o.lineWidth ?? 2
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'

  for (const path of frame.paths) {
    const pts = path.points
    if (pts.length === 0) continue
    ctx.beginPath()
    if (pts.length === 1) {
      ctx.arc(px(pts[0].x), py(pts[0].y), ctx.lineWidth, 0, 2 * Math.PI)
      ctx.fill()
      continue
    }
    ctx.moveTo(px(pts[0].x), py(pts[0].y))
    const segments = path.closed ? pts.length : pts.length - 1
    for (let i = 0; i < segments; i++) {
      const a = pts[i]
      const b = pts[(i + 1) % pts.length]
      if (!a.out && !b.in) {
        ctx.lineTo(px(b.x), py(b.y))
        continue
      }
      const [c1x, c1y] = a.out ?? [a.x, a.y]
      const [c2x, c2y] = b.in ?? [b.x, b.y]
      ctx.bezierCurveTo(px(c1x), py(c1y), px(c2x), py(c2y), px(b.x), py(b.y))
    }
    ctx.stroke()
  }
  ctx.restore()
}
