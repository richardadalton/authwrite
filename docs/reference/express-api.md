# Express API Reference

This reference covers `@authwrite/express` — the Express middleware adapter for `@authwrite/core`.

---

## `createAuthMiddleware(config)`

```typescript
export function createAuthMiddleware<S extends Subject, R extends Resource>(
  config: AuthMiddlewareConfig<S, R>
): RequestHandler
```

Factory function that returns an Express `RequestHandler`. The middleware resolves the subject, resource, and action from the incoming request, calls the evaluator, and either calls `next()` or sends a 403 response.

### `AuthMiddlewareConfig` options

| Option | Type | Default | Description |
|---|---|---|---|
| `engine` | `AuthEvaluator<S, R>` | required | The evaluator used to make authorization decisions. Accepts an `AuthEngine` or `Enforcer`. |
| `subject` | `(req: Request) => S \| Promise<S>` | required | Resolver that extracts the subject from the request. |
| `resource` | `(req: Request) => R \| undefined \| Promise<R \| undefined>` | required | Resolver that extracts the resource from the request. Return `undefined` when no resource context is needed. |
| `action` | `Action \| ((req: Request) => Action)` | required | The action to evaluate. Provide a static string or a function that derives the action from the request. |
| `onDeny` | `(req: Request, res: Response, decision: Decision) => void \| Promise<void>` | — | (optional) Custom handler invoked when access is denied. When omitted, the middleware sends the default 403 response. |

---

## Behaviour

The middleware executes the following steps on every request.

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
5. If `onDeny` is configured: `onDeny(req, res, decision)` is awaited. The middleware does not call `next()` or send any response — that responsibility belongs to the `onDeny` handler.

### On error

If any resolver or `engine.evaluate()` throws, the middleware calls `next(err)` with the caught error. `req.authDecision` is not set in this case.

---

## `req.authDecision`

```typescript
req.authDecision: Decision
```

The `Decision` object produced by `engine.evaluate()` is attached to the Express `Request` as `authDecision`. It is set on every request where evaluation completes, regardless of the outcome. Downstream handlers and error middleware can inspect it for audit logging or custom responses.

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

| Field | Type | Description |
|---|---|---|
| `error` | `string` | Always `"forbidden"`. |
| `reason` | `string` | The `reason` string from the `Decision`, identifying which rule denied access or why the default effect applied. |

HTTP status code is always `403`.

---

## Resolver signatures

### Subject resolver

```typescript
subject: (req: Request) => S | Promise<S>
```

Called once per request. Should extract and return the authenticated subject. Throwing from this resolver passes the error to `next(err)`.

### Resource resolver

```typescript
resource: (req: Request) => R | undefined | Promise<R | undefined>
```

Called once per request. Should extract the resource being acted upon. Return `undefined` when the action has no associated resource (e.g. listing endpoints). Throwing from this resolver passes the error to `next(err)`.

### Action resolver

```typescript
action: Action | ((req: Request) => Action)
```

Provide a static `Action` string when all requests through this middleware share the same action. Provide a function when the action must be derived from the request (e.g. mapping HTTP method to action name).

---

## `onDeny` handler

```typescript
onDeny: (req: Request, res: Response, decision: Decision) => void | Promise<void>
```

| Parameter | Type | Description |
|---|---|---|
| `req` | `Request` | The Express request object. `req.authDecision` is already set. |
| `res` | `Response` | The Express response object. The handler is responsible for sending a response. |
| `decision` | `Decision` | The denial decision from the evaluator. |

The handler may be async. The middleware awaits its completion before considering the request handled. The handler must send a response or call `next()` — the middleware does not do so after `onDeny` returns.

---

© 2026 Devjoy Ltd. MIT License.
