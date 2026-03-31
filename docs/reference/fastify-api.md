# Fastify API Reference

This reference covers `@authwrite/fastify` — the Fastify pre-handler hook adapter for `@authwrite/core`.

---

## `createAuthHook(config)`

```typescript
export function createAuthHook<S extends Subject, R extends Resource>(
  config: AuthHookConfig<S, R>
): preHandlerHookHandler
```

Factory function that returns a Fastify `preHandlerHookHandler`. The hook resolves the subject, resource, and action from the incoming request, calls the evaluator, and either sets `req.authDecision` and calls `done()` (on allow) or sends a 403 response (on deny).

### `AuthHookConfig` options

| Option | Type | Default | Description |
|---|---|---|---|
| `engine` | `AuthEvaluator<S, R>` | required | The evaluator used to make authorization decisions. Accepts an `AuthEngine` or `Enforcer`. |
| `subject` | `(req: FastifyRequest) => S \| Promise<S>` | required | Resolver that extracts the subject from the request. |
| `resource` | `(req: FastifyRequest) => R \| undefined \| Promise<R \| undefined>` | required | Resolver that extracts the resource from the request. Return `undefined` when no resource context is needed. |
| `action` | `Action \| ((req: FastifyRequest) => Action)` | required | The action to evaluate. Provide a static string or a function that derives the action from the request. |
| `onDeny` | `(req: FastifyRequest, reply: FastifyReply, decision: Decision) => void \| Promise<void>` | — | (optional) Custom handler invoked when access is denied. When omitted, the hook sends the default 403 response. |

---

## Behaviour

### On allow

1. Subject, resource, and action resolvers are called.
2. `engine.evaluate()` is called with the resolved context.
3. `req.authDecision` is set to the resulting `Decision`.
4. The hook calls `done()` / resolves to pass control to the route handler.

### On deny

1. Subject, resource, and action resolvers are called.
2. `engine.evaluate()` is called with the resolved context.
3. `req.authDecision` is set to the resulting `Decision`.
4. If `onDeny` is not configured: `reply.status(403).send({ error: 'forbidden', reason: decision.reason })` is called.
5. If `onDeny` is configured: `onDeny(req, reply, decision)` is awaited. The hook does not send any response — that responsibility belongs to the `onDeny` handler.

### On error

If any resolver or `engine.evaluate()` throws, the hook calls `done(err)` with the caught error. `req.authDecision` is not set.

---

## `req.authDecision`

```typescript
req.authDecision: Decision
```

The `Decision` object produced by `engine.evaluate()` is attached to the Fastify `Request` as `authDecision` via module augmentation. It is set on every request where evaluation completes, regardless of the outcome.

To use `req.authDecision` in TypeScript, the `@authwrite/fastify` module augments `@fastify/request` automatically — no additional declaration is needed.

See the [`Decision`](./core-api.md#decision) type reference for the full property table.

---

## Default deny response

When `onDeny` is not provided and the decision is a denial, the hook sends:

```json
{
  "error": "forbidden",
  "reason": "<decision.reason>"
}
```

HTTP status code is always `403`.

---

## Registering the hook

### Per-route

```typescript
app.get('/documents/:id', { preHandler: authHook }, async (req, reply) => {
  reply.send(await db.documents.findById(req.params.id))
})
```

### Route-level hook on a prefix

```typescript
app.register(async (instance) => {
  instance.addHook('preHandler', authHook)

  instance.get('/documents/:id', async (req, reply) => {
    reply.send(await db.documents.findById(req.params.id))
  })
}, { prefix: '/api' })
```

---

## Resolver signatures

### Subject resolver

```typescript
subject: (req: FastifyRequest) => S | Promise<S>
```

### Resource resolver

```typescript
resource: (req: FastifyRequest) => R | undefined | Promise<R | undefined>
```

### Action resolver

```typescript
action: Action | ((req: FastifyRequest) => Action)
```

---

## `onDeny` handler

```typescript
onDeny: (req: FastifyRequest, reply: FastifyReply, decision: Decision) => void | Promise<void>
```

| Parameter | Type | Description |
|---|---|---|
| `req` | `FastifyRequest` | The Fastify request. `req.authDecision` is already set. |
| `reply` | `FastifyReply` | The Fastify reply. The handler is responsible for sending a response. |
| `decision` | `Decision` | The denial decision from the evaluator. |

---

© 2026 Devjoy Ltd. MIT License.
