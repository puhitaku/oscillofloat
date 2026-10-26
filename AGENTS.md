# AGENTS.md

Notes for coding agents working on this repository. `README.md` documents the
pages, how to run it, the drawing format and both APIs; read it first. This
file covers rules and what is not obvious from there.

## What this is

oscillofloat is the web side of an oscilloscope installation. Visitors draw
on `/`, the drawing is stored by the Go backend and announced over a
WebSocket, oscilloshape (a separate repository, the oscilloscope side) picks
it up and draws it on the scope, and `/float` shows every drawing drifting
on a projector. `/admin` is the operator's page behind a Cognito passkey.

## Rules that must hold

These lines are the user's, recorded verbatim; the English below them is the
working translation.

> コードには How、テストコードには What、コミットログには Why、コードコメントには Why not を書くこと
> 上記ルールにそぐわないコードコメントは、本当に必要であると考えうる相当の理由がない限り書かないこと

- Code says **how**. Tests say **what**. Commit messages say **why**. Code
  comments say **why not**: the alternative that was rejected and the reason.
  A comment that does not fit this rule is not written unless there is a
  substantial reason it is really needed.
- **English everywhere** in code: identifiers, string literals, comments,
  commit messages, documentation. The single exception is text the frontend
  shows to visitors and the operator, which is **Japanese**. A string that
  ends up on a page is Japanese; a string that ends up in a log, an error
  body or a test name is English.
- **Nothing tied to a deployment is committed**: no domain names, bucket
  names, account IDs, pool or client IDs, email addresses, tokens. They come
  from `deploy.env` (git-ignored; `deploy.env.example` shows the keys), stack
  parameters, or the backend's `/api/config` at run time. The repository is
  public.
- **Commit only when asked.** Commit messages are short.
- **The stored drawing is the 1:1 square.** The aspect ratio is a display
  concern: the drawing page keeps strokes inside the band for the configured
  aspect, and consumers scale the frame uniformly by its width. Never store
  anisotropically scaled data.
- **The WebSocket is read-only** and accepts any origin; every mutation goes
  through HTTP with a session header or an admin token.
- **The drawing page never moves.** The layout fills the dynamic viewport
  (`100dvh`), `overflow: hidden` on the document, `overscroll-behavior:
  none`, and `touch-action: none` on the canvas. Do not fight the browser
  from JavaScript by resetting scroll positions.
- **Dark theme only**, black and greys with the oscilloscope green as the
  single accent. Icons, not words, on the toolbar; labels live in
  `aria-label` and `title`, in Japanese.

## Layout

```
cmd/oscillofloat/          flags, HTTP server
internal/shape/            drawing format and its limits (mirrors oscilloshape's)
internal/store/            SQLite: drawings and settings
internal/server/           HTTP API, WebSocket hub, rate limiting
internal/auth/             Cognito ID token verification
frontend/src/lib/          types, API client, renderer, drawing geometry, socket, presets
frontend/src/stores/       Pinia stores, one per concern
frontend/src/views/        DrawView (/), FloatView (/float), AdminView (/admin)
frontend/src/components/   toolbar, dialogs, canvases
frontend/e2e/              Playwright tests against mocked /api and /ws
infra/                     CloudFormation templates
scripts/                   awscli scripts for what CloudFormation does not do
docs/                      deployment guide
prompts/                   the user's original task descriptions, kept for the record
```

## Commands

```sh
make test      # go vet, go test, vue-tsc, prettier --check, Playwright
make fmt       # gofmt and prettier
make build     # linux/arm64 backend binary for EC2, and the frontend bundle
go run ./cmd/oscillofloat -insecure-admin
cd frontend && npm run dev
```

Run `make test` before reporting work as done. Playwright starts its own
Vite server on port 5184 and needs `npx playwright install chromium` once.

## Conventions

- Go: standard library style, `gofmt`, pure Go only (no cgo; the binary is
  cross-compiled for linux/arm64). SQLite through `modernc.org/sqlite`.
- Frontend: Vue 3 `<script setup>`, Pinia setup stores, Tailwind classes
  inline, Prettier (no semicolons, single quotes, 100 columns), icons from
  `lucide-vue-next`. Tests select by role and label, not by CSS.
- The drawing format and the APIs are defined in three places that change
  together: `internal/shape` + `internal/server`, `frontend/src/lib/types.ts`,
  and the tables in `README.md`. oscilloshape's `frontend/src/lib/types.ts`
  mirrors the curve format too.

## Gotchas

- Passkeys are bound to the deployed domain (Cognito's relying party ID), so
  `/admin` cannot sign in on localhost. The backend's `-insecure-admin` flag
  and the frontend's mocked tests cover local work.
- CloudFront drops idle WebSocket connections; the server pings every 20 s.
- The backend's client address comes from `X-Forwarded-For` only with
  `-trust-proxy`; without it, everything behind a proxy shares one rate
  limit bucket.
- `go vet ./...` walks `frontend/node_modules`; slow but harmless.
