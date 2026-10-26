import type { ClientMessage, ServerMessage } from './types'

const MIN_RETRY_MS = 1000
const MAX_RETRY_MS = 30_000

export interface SocketHandlers {
  open?(): void
  close?(): void
  message?(msg: ServerMessage): void
}

/**
 * A JSON WebSocket that reconnects with exponential backoff until close() is
 * called. Handlers are never called after close().
 */
export class JsonSocket {
  private ws: WebSocket | null = null
  private retryMs = MIN_RETRY_MS
  private timer: ReturnType<typeof setTimeout> | undefined
  private stopped = false

  constructor(
    readonly url: string,
    private readonly handlers: SocketHandlers,
  ) {
    this.dial()
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN
  }

  /** False when the socket is not open; the message is not queued. */
  send(msg: ClientMessage): boolean {
    if (!this.ws || !this.connected) return false
    this.ws.send(JSON.stringify(msg))
    return true
  }

  close() {
    this.stopped = true
    clearTimeout(this.timer)
    const ws = this.ws
    this.ws = null
    if (!ws) return
    ws.onopen = ws.onmessage = ws.onclose = null
    ws.close()
  }

  private dial() {
    const ws = new WebSocket(this.url)
    this.ws = ws
    ws.onopen = () => {
      this.retryMs = MIN_RETRY_MS
      this.handlers.open?.()
    }
    ws.onmessage = (e: MessageEvent) => {
      let msg: ServerMessage
      try {
        msg = JSON.parse(String(e.data))
      } catch {
        // Dropped rather than closing the socket: the next message may be fine.
        return
      }
      this.handlers.message?.(msg)
    }
    ws.onclose = () => {
      this.ws = null
      this.handlers.close?.()
      if (this.stopped) return
      this.timer = setTimeout(() => this.dial(), this.retryMs)
      this.retryMs = Math.min(this.retryMs * 2, MAX_RETRY_MS)
    }
  }
}
