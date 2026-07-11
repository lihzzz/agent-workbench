# harnss-remote

Public relay and mobile web console for Harnss remote control.

## Development

```bash
pnpm install
pnpm dev
pnpm dev:web
```

The server listens on `http://127.0.0.1:3000`. The web dev server listens on
`http://127.0.0.1:5175` and proxies `/api` and `/ws` to the server.

On first server start, an admin user is created from:

```bash
REMOTE_ADMIN_EMAIL=admin@example.com
REMOTE_ADMIN_PASSWORD=changeme
```

Set both variables in production.

## Pairing

1. Sign in to the mobile web UI.
2. Call `POST /api/pairing/start` or use an API client to create a desktop device record.
3. In Harnss desktop, open Settings -> Remote Control and enter the server URL, desktop name, returned `deviceId`, and returned `deviceToken`.

All write commands are relayed to the desktop for final authorization. The server stores command summaries, snapshots, and audit rows, but does not execute local desktop operations.
