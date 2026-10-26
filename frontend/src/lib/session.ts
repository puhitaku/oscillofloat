// The session ID that scopes "delete my drawings" (X-Session-Id). The backend
// accepts ^[A-Za-z0-9_-]{16,64}$.

const STORAGE_KEY = 'oscillofloat.sessionId'
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
const LENGTH = 32
const VALID = /^[A-Za-z0-9_-]{16,64}$/

let memory: string | null = null

function generate(): string {
  // 64 symbols divide 256 evenly, so masking a byte keeps the choice uniform.
  const bytes = crypto.getRandomValues(new Uint8Array(LENGTH))
  return Array.from(bytes, (b) => ALPHABET[b & 63]).join('')
}

/**
 * A stable ID kept in localStorage, generated on first use. When storage is
 * unavailable (private mode, blocked site data) the ID lives in memory for
 * the lifetime of the page.
 */
export function sessionId(): string {
  if (memory) return memory
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored && VALID.test(stored)) {
      memory = stored
      return stored
    }
  } catch {
    // Storage is unavailable; fall through to a fresh in-memory ID.
  }
  memory = generate()
  try {
    localStorage.setItem(STORAGE_KEY, memory)
  } catch {
    // Same as above: the in-memory ID still works for this page.
  }
  return memory
}
