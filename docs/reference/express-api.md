# Express API Reference

This reference covers `@daltonr/authwrite-express` — the Express middleware adapter for `@daltonr/authwrite-core`.

---

## `createExpressAuth(config)`

```typescript
export function createExpressAuth<S extends Subject, R extends Resource>(
  base: ExpressAuthConfig<S, R>
): (action: string | ((req: Request) => string), overrides?: Partial<ExpressAuthConfig<S, R>>) => RequestHandler
```

Factory that captures the engine, subject resolver, resource resolver, and default `onDeny` handler once, then returns a function that produces per-route middleware with a single action argument. This is the recommended way to wire authorization in Express applications.

```typescript
const auth = createExpressAuth<User, Doc>({
  engine,
  subject:  (req) => getUser(req),
  resource: (req) => getDoc(req),
  onDeny:   (req, res, decision) =>
    res.status(403).json({ error: 'forbidden', reason: decision.reason }),
})

// Per-route — action is the only argument that changes
app.get('/documents/:id',         auth('read'),    handler)
app.post('/documents/:id/edit',   auth('write'),   handler)
app.post('/documents/:id/delete', auth('delete'),  handler)
```

Per-route overrides are supported for the resource resolver or `onDeny`:

```typescript
app.get('/profile', auth('view-profile', { resource: () => undefined }), handler)
```

### `ExpressAuthConfig` options

| Option | Type | Default | Description |
|---|---|---|---|
| `engine` | `AuthEvaluator<S, R>` | required | The evaluator used to make authorization decisions. |
| `subject` | `(req: Request) => S \| Promise<S>` | required | Resolver that extracts the subject from the request. |
| `resource` | `(req: Request) => R \| undefined \| Promise<R \| undefined>` | — | (optional) Resolver that extracts the resource. Return `undefined` for subject-level actions. |
| `onDeny` | `(req: Request, res: Response, decision: Decision) => void \| Promise<void>` | — | (optional) Custom handler invoked when access is denied. |

---

## `createAuthMiddleware(config)`

```typescript
export function createAuthMiddleware<S extends Subject, R extends Resource>(
  config: AuthMiddlewareConfig<S, R>
): RequestHandler
```

Lower-level factory. Returns a single Express `RequestHandler` for one specific action. Prefer `createExpressAuth` to avoid repeating the engine, subject resolver, and `onDeny` handler on every route.

### `AuthMiddlewareConfig` options

| Option | Type | Default | Description |
|---|---|---|---|
| `engine` | `AuthEvaluator<S, R>` | required | The evaluator used to make authorization decisions. |
| `subject` | `(req: Request) => S \| Promise<S>` | required | Resolver that extracts the subject from the request. |
| `resource` | `(req: Request) => R \| undefined \| Promise<R \| undefined>` | — | (optional) Resolver that extracts the resource. |
| `action` | `string \| ((req: Request) => string)` | required | The action to evaluate. Provide a static string or a function. |
| `onDeny` | `(req: Request, res: Response, decision: Decision) => void \| Promise<void>` | — | (optional) Custom deny handler. |

---

## Behaviour

### On allow

1. Subject, resource, and action resolvers are called.
2. `engine.evaluate()` is called with the resolved context.
3. `req.authDecision` is set to the resulting `Decision`.
4. `next()` is called to pass control to the next handler.

### On deny

1. Subject, resource, and action resolvers are called.
2. `engine.evaluate()` is called with the resolved context.
3. `req.authDecision` is set to the resulting `Decision`.
4. If `onDeny` is not configured: `res.status(403).json({ error: 'forbidden', reason: decision.reason })` is sent.
5. If `onDeny` is configured: `onDeny(req, res, decision)` is awaited. The middleware does not call `next()` — the handler is responsible for sending a response.

### On error

If any resolver or `engine.evaluate()` throws, the middleware calls `next(err)`. `req.authDecision` is not set.

---

## `req.authDecision`

```typescript
req.authDecision: Decision
```

The `Decision` object produced by `engine.evaluate()` is attached to the Express `Request` as `authDecision`. It is set on every request where evaluation completes, regardless of outcome. Downstream handlers and error middleware can inspect it for audit logging or custom responses.

See the [`Decision`](./core-api.md#decision) type reference for the full property table.

---

## Default deny response

When `onDeny` is not provided and the decision is a denial, the middleware sends:

```json
{
  "error": "forbidden",
  "reason": "<decision.reason>"
}
```

HTTP status code is always `403`.

---

## Resolver signatures

### Subject resolver

```typescript
subject: (req: Request) => S | Promise<S>
```

Called once per request. Should extract and return the authenticated subject (from session, JWT, etc.). Throwing passes the error to `next(err)`.

### Resource resolver

```typescript
resource: (req: Request) => R | undefined | Promise<R | undefined>
```

Called once per request. Return the resource being acted upon, or `undefined` for subject-level actions (those that don't operate on a specific resource instance).

### Action

```typescript
action: string | ((req: Request) => string)
```

Provide a static string when all requests through this middleware share the same action. Provide a function when the action must be derived from the request (e.g. mapping HTTP method to action name).

---

## `onDeny` handler

```typescript
onDeny: (req: Request, res: Response, decision: Decision) => void | Promise<void>
```

| Parameter | Type | Description |
|---|---|---|
| `req` | `Request` | The Express request object. `req.authDecision` is already set. |
| `res` | `Response` | The Express response object. The handler must send a response. |
| `decision` | `Decision` | The denial decision. Includes `reason`, `context`, and `override` if mode-adjusted. |

---

© 2026 Devjoy Ltd. MIT License.
