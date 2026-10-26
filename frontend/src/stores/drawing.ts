import { defineStore } from 'pinia'
import { computed, ref, shallowRef, triggerRef } from 'vue'
import { clampToArea, DEFAULT_ASPECT, drawableArea } from '../lib/aspect'
import {
  countPoints,
  ERASER_LARGE_RADIUS,
  ERASER_SMALL_RADIUS,
  eraseAlong,
  eraseCircle,
  frameForUpload,
  MIN_POINT_DISTANCE,
} from '../lib/draw'
import {
  MAX_PATHS_PER_FRAME,
  MAX_POINTS_PER_FRAME,
  type Frame,
  type Path,
  type Vec,
} from '../lib/types'

export type Tool = 'pen' | 'eraserSmall' | 'eraserLarge'

export function eraserRadius(tool: Tool): number | null {
  if (tool === 'eraserSmall') return ERASER_SMALL_RADIUS
  if (tool === 'eraserLarge') return ERASER_LARGE_RADIUS
  return null
}

type Drag =
  | { kind: 'pen'; before: Path[]; path: Path | null; full: boolean }
  | { kind: 'erase'; before: Path[]; radius: number; last: Vec; full: boolean }

/**
 * The drawing being made on `/`: its paths, the tool, and undo/redo. Input
 * arrives as drags in scope coordinates (start, move, end); one drag is one
 * undo step. Path arrays and committed paths are never mutated, so a
 * snapshot is just the array reference.
 */
export const useDrawingStore = defineStore('drawing', () => {
  const paths = shallowRef<Path[]>([])
  const tool = ref<Tool>('pen')
  const area = ref<Vec>(drawableArea(DEFAULT_ASPECT))
  const undoStack = shallowRef<Path[][]>([])
  const redoStack = shallowRef<Path[][]>([])
  /** Incremented once per drag whose input was refused because the frame is full. */
  const limitHits = ref(0)

  let drag: Drag | null = null

  const pointCount = computed(() => countPoints(paths.value))
  const isEmpty = computed(() => paths.value.length === 0)
  const canUndo = computed(() => undoStack.value.length > 0)
  const canRedo = computed(() => redoStack.value.length > 0)

  function setArea(value: Vec) {
    area.value = value
  }

  function setTool(value: Tool) {
    tool.value = value
  }

  function refuse() {
    if (drag && !drag.full) {
      drag.full = true
      limitHits.value++
    }
  }

  function addPenPoint(p: Vec) {
    if (drag?.kind !== 'pen') return
    const [x, y] = clampToArea(p, area.value)
    if (!drag.path) {
      if (paths.value.length >= MAX_PATHS_PER_FRAME || pointCount.value >= MAX_POINTS_PER_FRAME) {
        refuse()
        return
      }
      drag.path = { closed: false, points: [{ x, y }] }
      paths.value = [...paths.value, drag.path]
      return
    }
    const points = drag.path.points
    const last = points[points.length - 1]
    if (Math.hypot(x - last.x, y - last.y) < MIN_POINT_DISTANCE) return
    if (pointCount.value >= MAX_POINTS_PER_FRAME) {
      refuse()
      return
    }
    points.push({ x, y })
    triggerRef(paths)
  }

  function applyErase(next: Path[]) {
    if (next === paths.value) return
    if (next.length > MAX_PATHS_PER_FRAME || countPoints(next) > MAX_POINTS_PER_FRAME) {
      refuse()
      return
    }
    paths.value = next
  }

  function start(p: Vec) {
    if (drag) end()
    const radius = eraserRadius(tool.value)
    if (radius === null) {
      drag = { kind: 'pen', before: paths.value, path: null, full: false }
      addPenPoint(p)
      return
    }
    drag = { kind: 'erase', before: paths.value, radius, last: p, full: false }
    applyErase(eraseCircle(paths.value, p, radius))
  }

  function move(p: Vec) {
    if (!drag) return
    if (drag.kind === 'pen') {
      addPenPoint(p)
      return
    }
    applyErase(eraseAlong(paths.value, drag.last, p, drag.radius))
    drag.last = p
  }

  function end() {
    if (!drag) return
    const { before } = drag
    drag = null
    if (paths.value === before) return
    undoStack.value = [...undoStack.value, before]
    redoStack.value = []
  }

  function undo() {
    if (drag || undoStack.value.length === 0) return
    const stack = undoStack.value.slice()
    redoStack.value = [...redoStack.value, paths.value]
    paths.value = stack.pop()!
    undoStack.value = stack
  }

  function redo() {
    if (drag || redoStack.value.length === 0) return
    const stack = redoStack.value.slice()
    undoStack.value = [...undoStack.value, paths.value]
    paths.value = stack.pop()!
    redoStack.value = stack
  }

  function frame(): Frame {
    return frameForUpload(paths.value, area.value)
  }

  return {
    paths,
    tool,
    area,
    limitHits,
    pointCount,
    isEmpty,
    canUndo,
    canRedo,
    setArea,
    setTool,
    start,
    move,
    end,
    undo,
    redo,
    frame,
  }
})
