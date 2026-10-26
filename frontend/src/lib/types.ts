// The drawing format and the APIs shared with the backend (internal/shape,
// internal/server) and, for the curve format, with oscilloshape.
//
// Both axes span [-1, 1], +X is right and +Y is up. A stored drawing is
// always the 1:1 square; see lib/aspect.ts for the display band.

export type Vec = [x: number, y: number]

/**
 * An anchor point in the Illustrator sense. `in` and `out` are the absolute
 * positions of the Bezier handles of the segments arriving at and leaving
 * from the anchor. A segment is a straight line when neither facing handle is
 * set and a cubic Bezier curve otherwise. The drawing page only produces
 * straight polylines.
 */
export interface Point {
  x: number
  y: number
  in?: Vec
  out?: Vec
}

/** An open or closed chain of anchors. A single point is a dot. */
export interface Path {
  closed: boolean
  points: Point[]
}

/** Everything the beam draws during one trace. */
export interface Frame {
  paths: Path[]
}

/** Limits enforced by the backend on upload. */
export const MAX_PATHS_PER_FRAME = 512
export const MAX_POINTS_PER_FRAME = 8000

export interface Drawing {
  id: string
  /** RFC 3339. */
  createdAt: string
  frame: Frame
}

/** What `list` returns: everything but the frame. */
export interface DrawingSummary {
  id: string
  createdAt: string
}

export interface AuthConfig {
  region: string
  userPoolId: string
  clientId: string
}

export interface Settings {
  /** Width to height of the oscilloscope screen as "W:H". */
  aspect: string
}

export interface AppConfig {
  /** Null when the backend runs without Cognito. */
  auth: AuthConfig | null
  settings: Settings
}

export const SESSION_HEADER = 'X-Session-Id'

// WebSocket messages on /ws.

export type ClientMessage = { type: 'list' } | { type: 'get'; ids: string[] }

export type ServerMessage =
  | { type: 'added'; drawing: Drawing }
  | { type: 'removed'; ids: string[] }
  | { type: 'list'; drawings: DrawingSummary[] }
  | { type: 'drawings'; drawings: Drawing[] }
  | { type: 'error'; message: string }
