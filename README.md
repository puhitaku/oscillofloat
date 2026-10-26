# oscillofloat

An installation built on [oscilloshape](https://github.com/puhitaku/oscilloshape):
visitors open a web page on their phone, draw a line drawing with their
finger, and send it. The drawing travels over the internet to the oscilloscope,
where oscilloshape draws it in X-Y mode, and joins the "float" page, where
every drawing ever sent drifts across a projector screen.

This repository holds the web side: a Go backend, a Vue frontend and the AWS
infrastructure to run both for a few dollars a month. The oscilloscope side
is oscilloshape, which connects to the backend's WebSocket as a client.

## Pages

| path     | who          |                                                                      |
| -------- | ------------ | -------------------------------------------------------------------- |
| `/`      | visitors     | Draw with touch, erase, undo, redo, send. Japanese UI.               |
| `/float` | projector    | Every drawing appears, drifts, turns and fades on a black screen.    |
| `/admin` | the operator | Passkey sign-in (Cognito), list and delete drawings, set the aspect. |

## Coordinates and the aspect ratio

A drawing is a frame in oscilloshape's curve format: open or closed paths of
anchor points, both axes in [-1, 1], +X right and +Y up. The stored data is
always the 1:1 square so it stays generic. The oscilloscope screen is not
square, though, so the operator sets the aspect ratio of the screen (default
5:4) in `/admin`. The drawing page shows the square but keeps the bands
outside the aspect ratio out of reach: for 5:4 the visitor can only draw in
|y| <= 0.8. oscilloshape does not need to know any of this: it scales the
received frame uniformly so that the [-1, 1] width fills the width of its
valid area, and the drawing lands inside the area because the frontend kept
it in the band.

## Run locally

Requires Go 1.26 and Node.js.

```sh
go run ./cmd/oscillofloat -insecure-admin     # backend on 127.0.0.1:8081, SQLite in ./oscillofloat.sqlite
cd frontend && npm install && npm run dev     # Vite on :5173, proxies /ws and /api to the backend
make test                                     # go vet, go test, vue-tsc, prettier, Playwright
```

`-insecure-admin` lets `/admin` work without Cognito, which cannot be used on
localhost anyway because passkeys are bound to the deployed domain. Never use
it in production.

Backend flags:

| flag                    | default                  |                                                                         |
| ----------------------- | ------------------------ | ----------------------------------------------------------------------- |
| `-addr`                 | `127.0.0.1:8081`         | Address to listen on.                                                   |
| `-db`                   | `oscillofloat.sqlite`    | SQLite database file.                                                   |
| `-cognito-region`       |                          | Region of the user pool.                                                |
| `-cognito-user-pool-id` |                          | User pool whose ID tokens are accepted on `/api/admin/*`.               |
| `-cognito-client-id`    |                          | App client the tokens must be issued to.                                |
| `-insecure-admin`       | `false`                  | Accept `/api/admin/*` without a token. Development only.                |
| `-trust-proxy`          | `false`                  | Take the client address from the last `X-Forwarded-For` entry (set behind CloudFront). |
| `-upload-rate`          | `10`                     | Uploads allowed per client address per minute.                          |

## Deploy

See [docs/deploy.md](docs/deploy.md). In short: one CloudFormation stack in
`us-east-1` for the certificate, one in the main region for everything else
(CloudFront, S3, EC2, Cognito), and `scripts/` for the pieces that are kept
out of CloudFormation on purpose: the DNS record, the S3 bucket that holds the
database replica, the admin user, and the deployment of new builds. Nothing
tied to a particular deployment (domain, bucket names, emails, IDs) is in the
repository: it all comes from `deploy.env`, which is git-ignored, and stack
parameters.

## Drawing format

```jsonc
// Drawing: what the backend stores and sends
{
  "id": "0192f1a0-...",            // UUID v7, so IDs sort by creation time
  "createdAt": "2026-10-26T12:00:00Z",
  "frame": {
    "paths": [
      {
        "closed": false,
        "points": [
          // An anchor as in oscilloshape: "in" and "out" are optional
          // absolute Bezier handles. The drawing page only produces
          // straight polylines.
          { "x": 0.1, "y": 0.2 },
          { "x": 0.3, "y": 0.25, "in": [0.2, 0.3] }
        ]
      }
    ]
  }
}
```

Limits enforced on upload: at most 512 paths and 8000 points in a frame, at
least one path, at least one point per path, anchors in [-1, 1], handles in
[-2, 2], everything finite.

## HTTP API

All bodies are JSON. Errors are `{ "error": "message" }` with a 4xx or 5xx
status.

| method   | path                   | auth       | body                      | response                                                   |
| -------- | ---------------------- | ---------- | ------------------------- | ---------------------------------------------------------- |
| `GET`    | `/api/config`          |            |                           | `{ "auth": Auth \| null, "settings": Settings }`           |
| `POST`   | `/api/drawings`        | session    | `{ "frame": Frame }`      | `201 { "id", "createdAt" }`; `400`, `413`, `429`           |
| `DELETE` | `/api/drawings`        | session    |                           | `{ "deleted": n }`, every drawing of the session           |
| `GET`    | `/api/admin/drawings`  | admin      |                           | `{ "drawings": [Drawing] }`, newest first                  |
| `DELETE` | `/api/admin/drawings`  | admin      | `{ "ids": [string] }`     | `{ "deleted": n }`                                         |
| `PUT`    | `/api/admin/settings`  | admin      | `Settings`                | `Settings` as stored                                       |

- `Auth` is `{ "region", "userPoolId", "clientId" }` for the frontend to talk
  to Cognito, or `null` when the backend runs without it.
- `Settings` is `{ "aspect": "W:H" }` with positive integers; default `5:4`.
- **session** auth is the `X-Session-Id` header: 16 to 64 characters of
  `[A-Za-z0-9_-]`, generated by the browser and kept in `localStorage`. It
  only scopes "delete my drawings"; anyone holding the ID can delete them.
- **admin** auth is `Authorization: Bearer <Cognito ID token>`, verified
  against the user pool's keys with the app client as audience. `401` without
  a valid token.
- Uploads are rate limited per client address (`429`).

## WebSocket API

`/ws` carries JSON messages discriminated by `type`. It is read-only and
accepts any origin: oscilloshape connects to it from the browser on the
oscilloscope machine, and the float page from the projector. The server sends
a WebSocket ping every 20 seconds so that CloudFront does not drop an idle
connection.

Client to server:

| type   | fields | reply      |                                                        |
| ------ | ------ | ---------- | ------------------------------------------------------ |
| `list` |        | `list`     | IDs and creation times of every drawing, newest first. |
| `get`  | `ids`  | `drawings` | The named drawings, at most 100 per request.           |

Server to client:

| type       | fields     |                                                                          |
| ---------- | ---------- | ------------------------------------------------------------------------ |
| `added`    | `drawing`  | A drawing was uploaded. Sent to every connection with the full drawing.  |
| `removed`  | `ids`      | Drawings were deleted. Sent to every connection.                         |
| `list`     | `drawings` | Reply to `list`: `[{ "id", "createdAt" }]`.                              |
| `drawings` | `drawings` | Reply to `get`: `[Drawing]`; unknown IDs are left out.                   |
| `error`    | `message`  | A message was rejected.                                                  |

A client that keeps drawings in memory (the float page, oscilloshape) should
not drop a drawing the moment `removed` arrives if it is on screen: flag it and
drop it the next time the list changes or the drawing is looked up.
