import { Amplify } from 'aws-amplify'
import {
  associateWebAuthnCredential,
  confirmSignIn,
  fetchAuthSession,
  signIn,
  signOut as amplifySignOut,
  type SignInOutput,
} from 'aws-amplify/auth'
import type { AuthConfig } from './types'

/** How a sign-in attempt ended when it did not throw. */
export type SignInOutcome =
  | { kind: 'done' }
  /** The user has no passkey yet and must go through the first-time setup. */
  | { kind: 'needsSetup' }
  /** The pool asked for a step this page does not handle. */
  | { kind: 'unexpected'; step: string }

export function configure(auth: AuthConfig) {
  Amplify.configure({
    Auth: { Cognito: { userPoolId: auth.userPoolId, userPoolClientId: auth.clientId } },
  })
}

/** The current ID token, refreshed by Amplify when needed, or '' when not signed in. */
export async function getToken(): Promise<string> {
  try {
    const session = await fetchAuthSession()
    return session.tokens?.idToken?.toString() ?? ''
  } catch {
    return ''
  }
}

export async function signInWithPasskey(email: string): Promise<SignInOutcome> {
  const { nextStep } = await signInFresh(() =>
    signIn({
      username: email,
      options: { authFlowType: 'USER_AUTH', preferredChallenge: 'WEB_AUTHN' },
    }),
  )
  switch (nextStep.signInStep) {
    case 'DONE':
      return { kind: 'done' }
    case 'CONTINUE_SIGN_IN_WITH_FIRST_FACTOR_SELECTION':
      return { kind: 'needsSetup' }
    default:
      return { kind: 'unexpected', step: nextStep.signInStep }
  }
}

/**
 * Signs in with the temporary password the pool's administrator issued and
 * replaces it with a random password nobody keeps: from then on the passkey
 * is the only way in. Call registerPasskey after a 'done' outcome.
 */
export async function signInWithTemporaryPassword(
  email: string,
  temporaryPassword: string,
): Promise<SignInOutcome> {
  let { nextStep } = await signInFresh(() =>
    signIn({
      username: email,
      password: temporaryPassword,
      options: { authFlowType: 'USER_AUTH', preferredChallenge: 'PASSWORD' },
    }),
  )
  if (nextStep.signInStep === 'CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED') {
    ;({ nextStep } = await confirmSignIn({ challengeResponse: generatePassword() }))
  }
  return nextStep.signInStep === 'DONE'
    ? { kind: 'done' }
    : { kind: 'unexpected', step: nextStep.signInStep }
}

/** Registers a passkey for the signed-in user; also used to add another one. */
export function registerPasskey(): Promise<void> {
  return associateWebAuthnCredential()
}

export async function signOut() {
  try {
    await amplifySignOut()
  } catch {
    // Revoking the refresh token can fail offline; the local tokens are gone either way.
  }
}

/**
 * Runs a sign-in, clearing a leftover session first if Amplify still holds
 * one. Not signing out unconditionally beforehand: that would revoke a
 * session that is perfectly valid when nothing is left over.
 */
async function signInFresh(run: () => Promise<SignInOutput>): Promise<SignInOutput> {
  try {
    return await run()
  } catch (e) {
    if (!(e instanceof Error) || e.name !== 'UserAlreadyAuthenticatedException') throw e
    await signOut()
    return run()
  }
}

const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const LOWER = 'abcdefghijklmnopqrstuvwxyz'
const DIGITS = '0123456789'
const SYMBOLS = '!@#$%^&*()-_=+[]{}?'
const PASSWORD_LENGTH = 32

/** A random password satisfying Cognito's default policy: one of each class at least. */
export function generatePassword(): string {
  const all = UPPER + LOWER + DIGITS + SYMBOLS
  const chars = [UPPER, LOWER, DIGITS, SYMBOLS].map(pick)
  while (chars.length < PASSWORD_LENGTH) chars.push(pick(all))
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1)
    ;[chars[i], chars[j]] = [chars[j], chars[i]]
  }
  return chars.join('')
}

function pick(alphabet: string): string {
  return alphabet[randomInt(alphabet.length)]
}

/** Uniform in [0, n): values from the incomplete last block are rejected instead of folded. */
function randomInt(n: number): number {
  const limit = Math.floor(0x1_0000_0000 / n) * n
  const buf = new Uint32Array(1)
  do crypto.getRandomValues(buf)
  while (buf[0] >= limit)
  return buf[0] % n
}
