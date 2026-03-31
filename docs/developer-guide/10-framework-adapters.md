# Chapter 10: Framework Adapters

The `AuthEngine` is framework-agnostic by design. It knows nothing about HTTP requests, response objects, or middleware chains. That is a deliberate constraint — it keeps the core testable in isolation and makes it portable across different server frameworks. But your application runs in a specific framework, and you need the authorization check to happen in the request lifecycle without writing the same boilerplate on every route. Framework adapters are thin wrappers that translate between an `AuthEvaluator` and the middleware or plugin shape a framework expects. This chapter covers the Express adapter in detail, including resolver patterns, error handling, and using the Enforcer in place of the engine.

---

## How adapters work

An adapter's job is straightforward: extract the subject, resource, and action from an incoming request; call `engine.evaluate()`; and either call `next()` to continue the request or terminate it with a 403. The adapter does not make any authorization decisions itself — it delegates entirely to whatever `AuthEvaluator` it was given.

```
Incoming request
      │
      ▼
┌─────────────────────────────────────────────┐
│              createAuthMiddleware            │
│                                             │
│  subject(req)   ──► S                       │
│  resource(req)  ──► R | undefined           │
│  action(req)    ──► Action                  │
│                      │                      │
│             engine.evaluate(ctx)            │
│                      │                      │
│            decision.allowed?                │
│            ┌────────┴────────┐              │
│           yes               no              │
│            │                 │              │
│        next()           onDeny()/403        │
│                              │              │
│         req.authDecision set on both paths  │
└─────────────────────────────────────────────┘
```

---

## createAuthMiddleware

The Express adapter is in `@authwrite/express`. Its configuration object has five fields: a required `engine`, required resolver functions for `subject`, `resource`, and `action`, and an optional `onDeny` handler.

```typescript
import express from 'express'
import { createEngine } from '@authwrite/core'
import { createAuthMiddleware } from '@authwrite/express'
import type { AuthMiddlewareConfig } from '@authwrite/express'

const app = express()
const engine = createEngine({ policy: documentPolicy })

const authMiddleware = createAuthMiddleware<Subject, Resource>({
  engine,
  subject: (req) => req.user as Subject,
  resource: async (req) => {
    const doc = await db.documents.findById(req.params.id)
    return doc ?? undefined
  },
  action: (req) => {
    const methodMap: Record<string, Action> = {
      GET: 'read',
      POST: 'write',
      PUT: 'write',
      PATCH: 'write',
      DELETE: 'delete',
    }
    return methodMap[req.method] ?? 'read'
  },
})

app.use('/documents/:id', authMiddleware)
```

A few things to notice:

- `subject` and `resource` are async-capable. Both may return a `Promise`, and the middleware awaits them before calling the engine. You can fetch from a database, call a remote service, or do any async work needed to resolve the subject or resource.
- `resource` may return `undefined`. If there is no resource for the route (for example, a collection endpoint where no specific document is being acted on), returning `undefined` is correct. The engine will evaluate the policy with `resource: undefined`.
- `action` can be a static string or a function. For most REST APIs, deriving the action from the HTTP method is the right pattern.
- `req.authDecision` is set on every request, including denials. Downstream handlers and error handlers can always read it.

---

## The default 403 response

If `onDeny` is not provided and the policy denies the request, the middleware responds with HTTP 403 and the following JSON body:

```json
{
  "error": "forbidden",
  "reason": "archived-blocks-mutation"
}
```

The `reason` field is the ID of the rule that triggered the denial, or `"default"` if the policy's `defaultEffect` applied. This gives API clients enough information to understand what happened without exposing policy internals.

---

## Custom onDeny

Supply `onDeny` to override the default 403 response. The handler receives the full `Request`, `Response`, and `Decision` objects, so you can return any shape you need, redirect instead of responding, or emit an event before responding.

```typescript
const authMiddleware = createAuthMiddleware<Subject, Resource>({
  engine,
  subject: (req) => req.user as Subject,
  resource: async (req) => db.documents.findById(req.params.id),
  action: 'read',
  onDeny: async (req, res, decision) => {
    // Log the denial with request context before responding
    await auditLog.write({
      userId: (req.user as Subject).id,
      path: req.path,
      reason: decision.reason,
      policy: decision.policy,
    })

    res.status(403).json({
      error: 'access_denied',
      code: decision.reason,
      requestId: req.headers['x-request-id'],
    })
  },
})
```

A few things to notice:

- `onDeny` is async-capable. The middleware awaits it before the request cycle ends.
- You are responsible for sending the response inside `onDeny`. The middleware does not call `res.end()` or `next()` after `onDeny` returns.
- If you need to redirect on denial — for example, in a server-side rendered application — call `res.redirect()` inside `onDeny` rather than returning a JSON response.

---

## Resolver errors

If `subject()`, `resource()`, or `action()` throws, the middleware calls `next(err)` with the thrown error. The request is handed to Express's error-handling middleware. The middleware does not call `onDeny` in this case — a resolver failure is an application error, not an authorization denial.

This means your Express error handler will receive resolver failures and can return an appropriate 500 response, log the stack trace, and so on, without the authorization layer swallowing the error.

```typescript
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  logger.error('Unhandled error', { message: err.message, path: req.path })
  res.status(500).json({ error: 'internal_server_error' })
})
```

---

## Using the Enforcer with Express

The `engine` field in `AuthMiddlewareConfig` accepts any `AuthEvaluator`. Both `AuthEngine` and `Enforcer` implement `AuthEvaluator`, so you can pass either one. Switch to the Enforcer during rollout and the rest of the middleware configuration stays identical.

```typescript
import { createEnforcer } from '@authwrite/core'

const engine = createEngine({ policy: documentPolicy })
const enforcer = createEnforcer(engine, { mode: 'audit' })

// Pass the enforcer instead of the engine — everything else is unchanged
const authMiddleware = createAuthMiddleware<Subject, Resource>({
  engine: enforcer,
  subject: (req) => req.user as Subject,
  resource: async (req) => db.documents.findById(req.params.id),
  action: (req) => httpMethodToAction(req.method),
})
```

When you are confident in the policy, switch the Enforcer to `enforce` mode. You do not need to change the middleware configuration.

---

## Per-route middleware

The same `createAuthMiddleware` pattern works for per-route middleware where different routes have different action mappings or different resource resolvers.

```typescript
const readMiddleware = createAuthMiddleware<Subject, Resource>({
  engine,
  subject: (req) => req.user as Subject,
  resource: async (req) => db.documents.findById(req.params.id),
  action: 'read',
})

const writeMiddleware = createAuthMiddleware<Subject, Resource>({
  engine,
  subject: (req) => req.user as Subject,
  resource: async (req) => db.documents.findById(req.params.id),
  action: 'write',
})

app.get('/documents/:id', readMiddleware, documentController.get)
app.put('/documents/:id', writeMiddleware, documentController.update)
app.delete('/documents/:id', writeMiddleware, documentController.delete)
```

Per-route middleware is more explicit than a single catch-all middleware with a dynamic action resolver, and it makes the authorization intent of each route visible at a glance.

---

## Complete route example

```typescript
import express, { Request, Response, NextFunction } from 'express'
import { createEngine } from '@authwrite/core'
import { createAuthMiddleware } from '@authwrite/express'
import { createFileLoader } from '@authwrite/loader-yaml'

interface Subject { id: string; role: string }
interface Resource { id: string; ownerId: string; status: string }

async function startServer() {
  const loader = createFileLoader<Subject, Resource>({
    path: './policy.yaml',
    rules: {
      'owner-full-access': {
        match: ({ subject, resource }) => resource?.ownerId === subject.id,
      },
      'archived-blocks-mutation': {
        match: ({ resource }) => resource?.status === 'archived',
      },
    },
  })

  const policy = await loader.load()
  const engine = createEngine({ policy })
  loader.watch((updated) => engine.reload(updated))

  const app = express()
  app.use(express.json())

  const docAuth = createAuthMiddleware<Subject, Resource>({
    engine,
    subject: (req) => req.user as Subject,
    resource: async (req) => {
      if (!req.params.id) return undefined
      return db.documents.findById(req.params.id)
    },
    action: (req) => {
      const map: Record<string, Action> = { GET: 'read', PUT: 'write', DELETE: 'delete' }
      return map[req.method] ?? 'read'
    },
    onDeny: (req, res, decision) => {
      res.status(403).json({
        error: 'forbidden',
        reason: decision.reason,
        requestId: req.headers['x-request-id'],
      })
    },
  })

  app.get('/documents/:id', docAuth, async (req, res) => {
    const doc = await db.documents.findById(req.params.id)
    res.json(doc)
  })

  app.put('/documents/:id', docAuth, async (req, res) => {
    const doc = await db.documents.update(req.params.id, req.body)
    res.json(doc)
  })

  app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
    logger.error(err)
    res.status(500).json({ error: 'internal_server_error' })
  })

  app.listen(3000)
}
```

---

## Fastify adapter

The Fastify adapter is in `@authwrite/fastify`. It returns a `preHandlerHookHandler` — a Fastify lifecycle hook that runs before your route handler and halts the request with a 403 if the policy denies access.

```typescript
import Fastify from 'fastify'
import { createAuthEngine } from '@authwrite/core'
import { createAuthHook } from '@authwrite/fastify'

const app = Fastify()
const engine = createAuthEngine({ policy: documentPolicy })

const authHook = createAuthHook<Subject, Resource>({
  engine,
  subject:  (req) => req.user as Subject,
  resource: async (req) => db.documents.findById(req.params.id),
  action:   (req) => httpMethodToAction(req.method),
})

app.get('/documents/:id', { preHandler: authHook }, async (req, reply) => {
  const doc = await db.documents.findById(req.params.id)
  reply.send(doc)
})
```

After evaluation, `req.authDecision` is set and available to the route handler. The hook calls `reply.status(403).send({ error: 'forbidden', reason })` on denial, or invokes `onDeny` if provided.

For a complete configuration reference see [fastify-api.md](../reference/fastify-api.md).

---

## Next.js adapter

The Next.js adapter is in `@authwrite/nextjs`. It wraps an App Router route handler function, enforcing authorization before the handler executes.

```typescript
import { createAuthEngine } from '@authwrite/core'
import { withAuth } from '@authwrite/nextjs'

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
```

The adapter uses only the standard Web API `Request` and `Response` types and has no hard dependency on the `next` package — it works with any version of Next.js that uses App Router route handlers. On denial it returns `Response.json({ error: 'forbidden', reason }, { status: 403 })` unless `onDeny` is provided.

For a complete configuration reference see [nextjs-api.md](../reference/nextjs-api.md).

---

## Hono adapter

The Hono adapter is in `@authwrite/hono`. It returns a standard `MiddlewareHandler` compatible with Hono's `app.use()` or inline route middleware.

```typescript
import { Hono } from 'hono'
import { createAuthEngine } from '@authwrite/core'
import { createAuthMiddleware, AUTH_DECISION_KEY } from '@authwrite/hono'

const app   = new Hono()
const engine = createAuthEngine({ policy: documentPolicy })

const authMiddleware = createAuthMiddleware<Subject, Resource, Env>({
  engine,
  subject:  (c) => c.get('user') as Subject,
  resource: async (c) => db.documents.findById(c.req.param('id')),
  action:   (c) => httpMethodToAction(c.req.method),
})

app.get('/documents/:id', authMiddleware, async (c) => {
  const doc = await db.documents.findById(c.req.param('id'))
  return c.json(doc)
})
```

After evaluation, the decision is stored with `c.set(AUTH_DECISION_KEY, decision)` and can be retrieved in the route handler via `c.get(AUTH_DECISION_KEY)`. The adapter is edge-runtime compatible and has no Node.js-specific dependencies.

For a complete configuration reference see [hono-api.md](../reference/hono-api.md).

---

This completes the framework adapter chapter. The next chapter covers the HATEOAS package, which uses the same `AuthEvaluator` interface to build permission-aware hypermedia links.

© 2026 Devjoy Ltd. MIT License.
