# DDB Browser

A fast local browser for DynamoDB: search, view, edit and delete items, and create or delete tables.

## Run

```sh
npm install
npm start        # builds the UI and serves it at http://localhost:4577
```

Pick an AWS profile and region in the sidebar. Profiles come from `~/.aws/config` and
`~/.aws/credentials` (SSO profiles work after `aws sso login --profile <name>`). Choose
**DynamoDB Local** to connect to a local endpoint instead.

For development, `npm run dev` runs the API with reload and Vite at http://localhost:5173.
Set `PORT` to change the API port.

## Desktop app

```sh
npm run desktop    # build and open the app in its own window
npm run dist       # package for this OS into release/ (AppImage on Linux, installer on Windows)
npm run dist:win   # from Linux/WSL: portable Windows zip (no installer, which would need Wine)
```

The desktop app runs the same server inside the Electron process on a local port, so nothing
else needs to be started. On Windows it reads profiles from `%USERPROFILE%\.aws`, not from WSL.

If `npm run desktop` reports that Electron failed to install, run `node node_modules/electron/install.js`.

## Layout

- `server/` – Hono API that talks to DynamoDB with the AWS SDK. Listens on 127.0.0.1 only and
  rejects cross-origin requests, since it acts with your AWS credentials.
- `electron/main.ts` – desktop entry point; starts the server and opens the window.
- `src/` – React UI (Vite, Tailwind, CodeMirror).
- `shared/types.ts` – request/response types used by both.
