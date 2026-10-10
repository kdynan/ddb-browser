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

### Releases

Pushing a version tag builds the packages on GitHub and publishes a release with them attached:

```sh
npm version patch   # or minor / major: bumps package.json and creates the tag
git push --follow-tags
```

The release has an AppImage for Linux, an installer and a portable zip for Windows, and a `.dmg`
for macOS (Apple silicon and Intel). The tag must match the version in `package.json`. To try the
build without releasing, run the Release workflow by hand from the Actions tab; the packages are
attached to the run.

The packages are not code signed. Windows shows a SmartScreen warning (More info → Run anyway).
macOS reports a downloaded app as damaged until its quarantine flag is cleared:
`xattr -cr "/Applications/DDB Browser.app"`.

## Tests

```sh
npm test               # unit tests, plus API tests against a real DynamoDB Local
npm run test:e2e       # browser tests of the whole app (first run: npx playwright install chromium)
npm run test:desktop   # builds the Electron app and smoke-tests it
npm run test:all       # everything
```

The API and browser tests need a DynamoDB to talk to. By default they download DynamoDB Local
once (into `node_modules/.cache`) and run it with Java. To use one that is already running,
set `DYNAMODB_ENDPOINT`, e.g. `DYNAMODB_ENDPOINT=http://localhost:8000 npm test`.

Tests never use your real AWS profiles: they point the AWS config at files that don't exist
and connect only to the local database. `.github/workflows/ci.yml` runs all of this on every
push and pull request.

## Layout

- `server/` – Hono API that talks to DynamoDB with the AWS SDK. Listens on 127.0.0.1 only and
  rejects cross-origin requests, since it acts with your AWS credentials.
- `electron/main.ts` – desktop entry point; starts the server and opens the window.
- `src/` – React UI (Vite, Tailwind, CodeMirror).
- `shared/types.ts` – request/response types used by both.
- `tests/` – `unit/` and `api/` (Vitest), `e2e/` (Playwright in a browser), `desktop/` (Playwright driving Electron).

## License

[MIT](LICENSE)
