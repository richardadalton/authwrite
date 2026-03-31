# Devtools API Reference

This reference covers `@authwrite/devtools` — a local development server and browser sidebar for inspecting live authorization decisions.

> **Development only.** Do not load the devtools client script or start the dev server in production.

---

## `createDevTools(options?)`

```typescript
export function createDevTools(options?: CreateDevToolsOptions): {
  observer: DevToolsObserver
  start():  Promise<void>
  stop():   Promise<void>
  readonly url: string
}
```

Convenience factory that creates a `DevToolsObserver` and a `DevServer` together and wires them up. Returns an object with the observer to register with the engine and `start`/`stop` methods to control the server.

```typescript
// In development only:
const devtools = createDevTools({ port: 4999 })

const engine = createAuthEngine({
  policy,
  observers: [devtools.observer],
})

await devtools.start()
// Prints: [authwrite devtools] http://localhost:4999
// Add to your HTML:
//   <script src="http://localhost:4999/devtools-client.js"></script>
```

### `CreateDevToolsOptions`

| Option | Type | Default | Description |
|---|---|---|---|
| `port` | `number` | `4999` | Port the dev server listens on. |
| `flagsFile` | `string` | `.authwrite-flags.json` | Path to the file where flagged decisions are written. |
| `policies` | `PolicySwitcherOptions` | — | (optional) Enables the policy switcher in the sidebar. See below. |

---

## `DevToolsObserver`

```typescript
export class DevToolsObserver implements AuthObserver
```

An `AuthObserver` that buffers decisions in memory and streams them to connected sidebar clients over SSE. Pass it to `createAuthEngine({ observers })` or `engine.addObserver()`.

### Constructor

```typescript
new DevToolsObserver(maxBuffer?: number)
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `maxBuffer` | `number` | `500` | Maximum number of decisions to retain in the ring buffer. Oldest decisions are evicted first. |

### Methods

#### `getBuffer()`

```typescript
getBuffer(): PersistedDecision[]
```

Returns a copy of all buffered decisions, oldest to newest.

#### `subscribe(listener)`

```typescript
subscribe(listener: (d: PersistedDecision) => void): () => void
```

Subscribes to new decisions as they arrive. Returns an unsubscribe function.

#### `clear()`

```typescript
clear(): void
```

Empties the decision buffer.

---

## `createDevServer(options)`

```typescript
export function createDevServer(options: DevServerOptions): DevServer
```

Lower-level factory. Creates the HTTP server without an observer — use `createDevTools` unless you need explicit control over the observer lifecycle.

### `DevServerOptions`

| Option | Type | Default | Description |
|---|---|---|---|
| `observer` | `DevToolsObserver` | required | The observer whose buffer and subscription the server reads from. |
| `port` | `number` | `4999` | Port to listen on. |
| `flagsFile` | `string` | `.authwrite-flags.json` | Path for persisted decision flags. |
| `policies` | `PolicySwitcherOptions` | — | (optional) Enables the policy switcher. |

### `DevServer`

```typescript
export interface DevServer {
  start():  Promise<void>
  stop():   Promise<void>
  readonly url: string
}
```

---

## Policy switcher

When `policies` is configured, the sidebar shows a dropdown of `.yaml`, `.yml`, and `.json` files found in `policies.dir`. Selecting a file and clicking Apply calls `policies.onApply` with the full file path — use this to reload the engine with a different policy at runtime.

### `PolicySwitcherOptions`

| Option | Type | Description |
|---|---|---|
| `dir` | `string` | Directory to scan for policy files. |
| `onApply` | `(filePath: string) => Promise<void>` | Called when the user applies a policy file from the sidebar. |

```typescript
import { createFileLoader, fromLoader } from '@authwrite/loader-yaml'

const devtools = createDevTools({
  policies: {
    dir: './policies',
    onApply: async (filePath) => {
      const loader = createFileLoader({ path: filePath, rules: myRegistry })
      const resolver = await fromLoader(loader)
      engine.reload(resolver)
    },
  },
})
```

---

## Decision flagging

The sidebar allows any decision to be flagged with a verdict (`should-allow` or `should-deny`) and an optional note. Flags are appended to the `flagsFile` as a JSON array of `DecisionFlag` records. Use flags to build a regression suite — each flag is a real production decision that can be replayed in tests.

---

## Types

### `PersistedDecision`

Serialisable snapshot of a decision, stored in the ring buffer and streamed to the browser.

| Field | Type | Description |
|---|---|---|
| `id` | `string` | Unique ID for this decision instance. |
| `timestamp` | `number` | Unix ms timestamp of when the decision was evaluated. |
| `subject` | `unknown` | The subject from the auth context. |
| `resource` | `unknown` | The resource from the auth context, if any. |
| `action` | `string` | The action that was evaluated. |
| `policy` | `string` | The policy ID (or composite label) that produced the decision. |
| `effect` | `'allow' \| 'deny'` | The raw policy effect before any enforcer mode override. |
| `allowed` | `boolean` | The final outcome after enforcer mode override. |
| `reason` | `string` | The rule ID that decided, or `'default'`. |
| `defaulted` | `boolean` | Whether no rule matched and the default effect applied. |
| `durationMs` | `number` | Evaluation time in milliseconds. |
| `override` | `'permissive' \| 'suspended' \| 'lockdown'` | Set when an enforcer mode changed the outcome. |

### `DecisionFlag`

A flagged decision written to `flagsFile`.

| Field | Type | Description |
|---|---|---|
| `decisionId` | `string` | ID of the flagged `PersistedDecision`. |
| `verdict` | `'should-allow' \| 'should-deny'` | The expected correct outcome. |
| `note` | `string` | Free-text note explaining the flag. |
| `flaggedAt` | `number` | Unix ms timestamp of when the flag was created. |
| `decision` | `PersistedDecision` | Full snapshot of the decision at flag time. |

---

## Dev server endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/devtools-client.js` | Serves the browser sidebar bundle. Add as a `<script>` tag in your app's HTML. |
| `GET` | `/events` | SSE stream of decisions. Replays the buffer on connect, then streams live. |
| `GET` | `/policies` | Returns the list of policy files available in `policies.dir`. |
| `POST` | `/policies/apply` | Body: `{ file: string }`. Calls `policies.onApply` with the resolved file path. |
| `POST` | `/flag` | Body: `{ id, verdict, note }`. Flags a decision and appends it to `flagsFile`. |

---

## Behaviour notes

### Buffer replay on connect

When the sidebar connects to `/events`, the server immediately replays all buffered decisions before switching to live streaming. This means decisions made before the sidebar was opened are still visible.

### CORS

The dev server sets `Access-Control-Allow-Origin: *`. This is intentional — the sidebar script runs in a browser context that may differ from the server origin in local development.

### `flagsFile` format

Flags are appended to a JSON array. If the file does not exist it is created. The file is human-readable and suitable for committing alongside test fixtures.

---

© 2026 Devjoy Ltd. MIT License.
