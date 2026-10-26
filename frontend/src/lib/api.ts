import { SESSION_HEADER, type AppConfig, type Drawing, type Frame, type Settings } from './types'

/** Thrown for any non-2xx response, with the backend's message when it sent one. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init.headers },
  })
  if (!res.ok) {
    let message = res.statusText
    try {
      message = ((await res.json()) as { error?: string }).error ?? message
    } catch {
      // The body was not JSON; the status text will do.
    }
    throw new ApiError(res.status, message)
  }
  return (await res.json()) as T
}

export const api = {
  config: () => request<AppConfig>('/api/config'),

  upload: (sessionId: string, frame: Frame) =>
    request<{ id: string; createdAt: string }>('/api/drawings', {
      method: 'POST',
      headers: { [SESSION_HEADER]: sessionId },
      body: JSON.stringify({ frame }),
    }),

  deleteMine: (sessionId: string) =>
    request<{ deleted: number }>('/api/drawings', {
      method: 'DELETE',
      headers: { [SESSION_HEADER]: sessionId },
    }),

  admin: {
    drawings: (token: string) =>
      request<{ drawings: Drawing[] }>('/api/admin/drawings', { headers: bearer(token) }),

    deleteDrawings: (token: string, ids: string[]) =>
      request<{ deleted: number }>('/api/admin/drawings', {
        method: 'DELETE',
        headers: bearer(token),
        body: JSON.stringify({ ids }),
      }),

    setSettings: (token: string, settings: Settings) =>
      request<Settings>('/api/admin/settings', {
        method: 'PUT',
        headers: bearer(token),
        body: JSON.stringify(settings),
      }),
  },
}

function bearer(token: string): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {}
}

export function socketURL(): string {
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws'
  return `${scheme}://${location.host}/ws`
}
