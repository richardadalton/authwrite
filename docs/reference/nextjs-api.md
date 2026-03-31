# Next.js API Reference

This reference covers `@daltonr/authwrite-nextjs` — the App Router route handler wrapper for `@daltonr/authwrite-core`.

---

## `withAuth(config, handler)`

```typescript
export function withAuth<S extends Subject, R extends Resource>(
  config:  WithAuthConfig<S, R>,
  handler: RouteHandler,
): RouteHandler
```

Higher-order function that wraps a Next.js App Router route handler. The returned function evaluates authorization before calling `handler`, and returns a 403 `Response` if the policy denies the request.

### `WithAuthConfig` options

| Option | Type | Default | Description |
|---|---|---|---|
| `engine` | `AuthEvaluator<S, R>` | required | The evaluator used to make authorization decisions. Accepts an `AuthEngine` or `Enforcer`. |
| `subject` | `(req: Request, ctx: RouteContext) => S \| Promise<S>` | required | Resolver that extracts the subject from the request. |
| `resource` | `(req: Request, ctx: RouteContext) => R \| undefined \| Promise<R \| undefined>` | required | Resolver that extracts the resource from the request. Return `undefined` when no resource context is needed. |
| `action` | `Action \| ((req: Request, ctx: RouteContext) => Action)` | required | The action to evaluate. Provide a static string or a function that derives the action from the request. |
| `onDeny` | `(req: Request, ctx: RouteContext, decision: Decision) => Promise<Response>` | — | (optional) Custom handler that returns a `Response` when access is denied. When omitted, the wrapper returns the default 403 response. |

---

## `RouteContext`

```typescript
export interface RouteContext {
  params: Promise<Record<string, string>>
}
```

Matches the Next.js 15 App Router shape where route params are async. Await `ctx.params` inside resolvers to access path parameters.

```typescript
resource: async (req, ctx) => {
  const { id } = await ctx.params
  return db.documents.findById(id)
},
```

---

## Behaviour

### On allow

1. Subject, resource, and action resolvers are called.
2. `engine.evaluate()` is called with the resolved context.
3. `handler(req, ctx)` is called and its `Response` is returned.

### On deny

1. Subject, resource, and action resolvers are called.
2. `engine.evaluate()` is called with the resolved context.
3. If `onDeny` is not configured: `Response.json({ error: 'forbidden', reason }, { status: 403 })` is returned.
4. If `onDeny` is configured: `onDeny(req, ctx, decision)` is awaited and its return value is returned as the response.

### On error

If any resolver or `engine.evaluate()` throws, the error propagates to Next.js's error boundary.

---

## Default deny response

When `onDeny` is not provided and the decision is a denial, the wrapper returns:

```json
{
  "error": "forbidden",
  "reason": "<decision.reason>"
}
```

HTTP status code is always `403`. The response is constructed with the standard `Response.json()` API and has no dependency on `next/server`.

---

## No hard next dependency

`@daltonr/authwrite-nextjs` uses only standard Web API types (`Request`, `Response`) and defines `RouteContext` locally to match the Next.js 15 async params shape. It has no hard peer dependency on the `next` package and works with any Next.js version that uses App Router route handlers.

---

## Usage

```typescript
// app/documents/[id]/route.ts
import { createAuthEngine } from '@daltonr/authwrite-core'
import { withAuth } from '@daltonr/authwrite-nextjs'

const engine = createAuthEngine({ policy: documentPolicy })

export const GET = withAuth<Subject, Resource>(
  {
    engine,
    subject:  async (req) => getSessionUser(req),
    resource: async (req, ctx) => {
      const { id } = await ctx.params
      return db.documents.findById(id)
    },
    action: 'read',
  },
  async (req, ctx) => {
    const { id } = await ctx.params
    const doc = await db.documents.findById(id)
    return Response.json(doc)
  },
)

export const PUT = withAuth<Subject, Resource>(
  {
    engine,
    subject:  async (req) => getSessionUser(req),
    resource: async (req, ctx) => {
      const { id } = await ctx.params
      return db.documents.findById(id)
    },
    action: 'write',
  },
  async (req, ctx) => {
    const { id } = await ctx.params
    const body = await req.json()
    const doc = await db.documents.update(id, body)
    return Response.json(doc)
  },
)
```

---

## Resolver signatures

### Subject resolver

```typescript
subject: (req: Request, ctx: RouteContext) => S | Promise<S>
```

### Resource resolver

```typescript
resource: (req: Request, ctx: RouteContext) => R | undefined | Promise<R | undefined>
```

### Action resolver

```typescript
action: Action | ((req: Request, ctx: RouteContext) => Action)
```

---

## `onDeny` handler

```typescript
onDeny: (req: Request, ctx: RouteContext, decision: Decision) => Promise<Response>
```

| Parameter | Type | Description |
|---|---|---|
| `req` | `Request` | The Web API `Request` object. |
| `ctx` | `RouteContext` | The route context with async params. |
| `decision` | `Decision` | The denial decision from the evaluator. |

The handler must return a `Response`. The wrapper returns whatever `onDeny` returns without additional processing.

---

© 2026 Devjoy Ltd. MIT License.
