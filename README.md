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

## Layout

- `server/` – Hono API that talks to DynamoDB with the AWS SDK. Listens on 127.0.0.1 only and
  rejects cross-origin requests, since it acts with your AWS credentials.
- `src/` – React UI (Vite, Tailwind, CodeMirror).
- `shared/types.ts` – request/response types used by both.
