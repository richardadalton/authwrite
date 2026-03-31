# Hono API Reference

This reference covers `@daltonr/authwrite-hono` — the Hono middleware adapter for `@daltonr/authwrite-core`.

---

## `createAuthMiddleware(config)`

```typescript
export function createAuthMiddleware<
  S extends Subject = Subject,
  R extends Resource = Resource,
  Env extends Hono.Env = Hono.Env,
>(config: AuthMiddlewareConfig<S, R, Env>): MiddlewareHandler<Env>
```

Factory function that returns a Hono `MiddlewareHandler`. The middleware resolves the subject, resource, and action from the context, calls the evaluator, and either stores the decision and calls `next()` (on allow) or returns a 403 JSON response (on deny).

### `AuthMiddlewareConfig` options

| Option | Type | Default | Description |
|---|---|---|---|
| `engine` | `AuthEvaluator<S, R>` | required | The evaluator used to make authorization decisions. Accepts an `AuthEngine` or `Enforcer`. |
| `subject` | `(c: Context<Env>) => S \| Promise<S>` | required | Resolver that extracts the subject from the Hono context. |
| `resource` | `(c: Context<Env>) => R \| undefined \| Promise<R \| undefined>` | required | Resolver that extracts the resource from the context. Return `undefined` when no resource context is needed. |
| `action` | `Action \| ((c: Context<Env>) => Action)` | required | The action to evaluate. Provide a static string or a function that derives the action from the context. |
| `onDeny` | `(c: Context<Env>, decision: Decision) => Response \| Promise<Response>` | — | (optional) Custom handler that returns a `Response` when access is denied. When omitted, the middleware returns the default 403 response. |

---

## `AUTH_DECISION_KEY`

```typescript
export const AUTH_DECISION_KEY = 'authDecision'
```

The key used to store the `Decision` in Hono's context store. Retrieve the decision in a route handler via `c.get(AUTH_DECISION_KEY)`.

```typescript
app.get('/documents/:id', authMiddleware, async (c) => {
  const decision = c.get(AUTH_DECISION_KEY)
  // decision.reason, decision.policy, etc.
  const doc = await db.documents.findById(c.req.param('id'))
  return c.json(doc)
})
```

To get full TypeScript support for `c.get(AUTH_DECISION_KEY)`, declare the key in your `Env` type's `Variables`:

```typescript
import type { Decision } from '@daltonr/authwrite-core'
import { AUTH_DECISION_KEY } from '@daltonr/authwrite-hono'

type Env = {
  Variables: {
    [AUTH_DECISION_KEY]: Decision
  }
}
```

---

## Behaviour

### On allow

1. Subject, resource, and action resolvers are called.
2. `engine.evaluate()` is called with the resolved context.
3. The decision is stored via `c.set(AUTH_DECISION_KEY, decision)`.
4. `next()` is called to pass control to the route handler.

### On deny

1. Subject, resource, and action resolvers are called.
2. `engine.evaluate()` is called with the resolved context.
3. The decision is stored via `c.set(AUTH_DECISION_KEY, decision)`.
4. If `onDeny` is not configured: `c.json({ error: 'forbidden', reason: decision.reason }, 403)` is returned.
5. If `onDeny` is configured: `onDeny(c, decision)` is awaited and its return value is returned as the response.

### On error

If any resolver or `engine.evaluate()` throws, the error propagates and Hono's error handling takes over.

---

## Default deny response

When `onDeny` is not provided and the decision is a denial, the middleware returns:

```json
{
  "error": "forbidden",
  "reason": "<decision.reason>"
}
```

HTTP status code is always `403`.

---

## Edge runtime compatibility

`@daltonr/authwrite-hono` has no Node.js-specific dependencies. It works in any runtime that Hono supports, including Cloudflare Workers, Deno Deploy, Bun, and Node.js.

---

## Usage

```typescript
import { Hono } from 'hono'
import { createAuthEngine } from '@daltonr/authwrite-core'
import { createAuthMiddleware, AUTH_DECISION_KEY } from '@daltonr/authwrite-hono'
import type { Decision } from '@daltonr/authwrite-core'

type Env = {
  Variables: { [AUTH_DECISION_KEY]: Decision }
}

const app    = new Hono<Env>()
const engine = createAuthEngine({ policy: documentPolicy })

const readAuth = createAuthMiddleware<Subject, Resource, Env>({
  engine,
  subject:  (c) => c.get('user') as Subject,
  resource: async (c) => db.documents.findById(c.req.param('id')),
  action:   'read',
})

const writeAuth = createAuthMiddleware<Subject, Resource, Env>({
  engine,
  subject:  (c) => c.get('user') as Subject,
  resource: async (c) => db.documents.findById(c.req.param('id')),
  action:   'write',
})

app.get('/documents/:id',  readAuth,  async (c) => c.json(await db.documents.findById(c.req.param('id'))))
app.put('/documents/:id',  writeAuth, async (c) => c.json(await db.documents.update(c.req.param('id'), await c.req.json())))
app.delete('/documents/:id', writeAuth, async (c) => { await db.documents.delete(c.req.param('id')); return c.body(null, 204) })
```

---

## Resolver signatures

### Subject resolver

```typescript
subject: (c: Context<Env>) => S | Promise<S>
```

### Resource resolver

```typescript
resource: (c: Context<Env>) => R | undefined | Promise<R | undefined>
```

### Action resolver

```typescript
action: Action | ((c: Context<Env>) => Action)
```

---

## `onDeny` handler

```typescript
onDeny: (c: Context<Env>, decision: Decision) => Response | Promise<Response>
```

| Parameter | Type | Description |
|---|---|---|
| `c` | `Context<Env>` | The Hono context. The decision is already stored under `AUTH_DECISION_KEY`. |
| `decision` | `Decision` | The denial decision from the evaluator. |

The handler must return a `Response`. Use `c.json(...)`, `c.text(...)`, or construct a `Response` directly.

---

© 2026 Devjoy Ltd. MIT License.
