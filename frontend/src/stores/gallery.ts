import { defineStore } from 'pinia'
import { computed, ref, shallowReactive } from 'vue'
import { socketURL } from '../lib/api'
import { JsonSocket } from '../lib/socket'
import type { Drawing, DrawingSummary, ServerMessage } from '../lib/types'

/** The backend's limit on ids per `get`. */
const GET_BATCH = 100

export interface GalleryEntry {
  drawing: Drawing
  /** Deleted on the server; kept until the next purge so a sprite can finish. */
  removed: boolean
}

/** Every drawing sent so far, mirrored from the WebSocket. */
export const useGalleryStore = defineStore('gallery', () => {
  // Shallow so that thousands of frame points are not made reactive.
  const entries = shallowReactive(new Map<string, GalleryEntry>())
  const connected = ref(false)
  let socket: JsonSocket | null = null
  // Drawings announced by `added`, shown before any random pick so that a
  // visitor sees theirs appear soon after sending it.
  let fresh: string[] = []

  const drawings = computed(() =>
    [...entries.values()].filter((e) => !e.removed).map((e) => e.drawing),
  )

  function connect() {
    if (socket) return
    socket = new JsonSocket(socketURL(), {
      open() {
        connected.value = true
        socket?.send({ type: 'list' })
      },
      close() {
        connected.value = false
      },
      message: handle,
    })
  }

  function close() {
    socket?.close()
    socket = null
    connected.value = false
  }

  function handle(msg: ServerMessage) {
    switch (msg.type) {
      case 'list':
        reconcile(msg.drawings)
        break
      case 'drawings':
        for (const d of msg.drawings) {
          if (!entries.has(d.id)) entries.set(d.id, { drawing: d, removed: false })
        }
        break
      case 'added':
        purge()
        entries.set(msg.drawing.id, { drawing: msg.drawing, removed: false })
        fresh.push(msg.drawing.id)
        break
      case 'removed':
        for (const id of msg.ids) {
          const e = entries.get(id)
          if (e) entries.set(id, { ...e, removed: true })
        }
        break
      case 'error':
        console.warn('gallery: server error:', msg.message)
        break
    }
  }

  function reconcile(listed: DrawingSummary[]) {
    purge()
    const ids = new Set(listed.map((d) => d.id))
    for (const id of [...entries.keys()]) {
      if (!ids.has(id)) entries.delete(id)
    }
    const missing = listed.map((d) => d.id).filter((id) => !entries.has(id))
    for (let i = 0; i < missing.length; i += GET_BATCH) {
      socket?.send({ type: 'get', ids: missing.slice(i, i + GET_BATCH) })
    }
  }

  function purge() {
    for (const [id, e] of [...entries]) {
      if (e.removed) entries.delete(id)
    }
    fresh = fresh.filter((id) => entries.has(id))
  }

  /**
   * Drops flagged drawings, then returns the oldest unshown `added` one, or
   * else one picked uniformly from `extra` and the gallery.
   */
  function pickRandom(extra: readonly Drawing[] = []): Drawing | undefined {
    purge()
    const id = fresh.shift()
    if (id) return entries.get(id)?.drawing
    const pool = drawings.value
    const n = extra.length + pool.length
    if (n === 0) return undefined
    const i = Math.floor(Math.random() * n)
    return i < extra.length ? extra[i] : pool[i - extra.length]
  }

  return { entries, drawings, connected, connect, close, pickRandom }
})
