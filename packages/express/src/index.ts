import type { RequestHandler, Request, Response } from 'express'
import type { AuthEvaluator, Decision, Subject, Resource } from '@daltonr/authwrite-core'

// ─── Request augmentation ─────────────────────────────────────────────────────

declare global {
  namespace Express {
    interface Request {
      authDecision?: Decision
    }
  }
}

// ─── Per-middleware config ────────────────────────────────────────────────────

export interface AuthMiddlewareConfig<
  S extends Subject = Subject,
  R extends Resource = Resource,
> {
  engine:    AuthEvaluator<S, R>
  subject:   (req: Request) => S | Promise<S>
  resource?: (req: Request) => R | undefined | Promise<R | undefined>
  action:    string | ((req: Request) => string)
  onDeny?:   (req: Request, res: Response, decision: Decision) => void | Promise<void>
}

// ─── Middleware factory ───────────────────────────────────────────────────────

export function createAuthMiddleware<
  S extends Subject = Subject,
  R extends Resource = Resource,
>(config: AuthMiddlewareConfig<S, R>): RequestHandler {
  return async (req, res, next) => {
    try {
      const subject  = await config.subject(req)
      const resource = config.resource ? await config.resource(req) : undefined
      const action   = typeof config.action === 'function' ? config.action(req) : config.action

      const decision = await config.engine.evaluate({ subject, resource, action })

      ;(req as Request & { authDecision: Decision }).authDecision = decision

      if (decision.allowed) {
        next()
        return
      }

      if (config.onDeny) {
        await config.onDeny(req, res, decision)
        return
      }

      res.status(403).json({ error: 'forbidden', reason: decision.reason })
    } catch (err) {
      next(err)
    }
  }
}

// ─── Bound auth factory ───────────────────────────────────────────────────────
//
// Captures the engine, subject resolver, resource resolver, and default onDeny
// once. Returns a function that produces middleware for a specific action.
// Eliminates the wrapper function pattern every integration reinvents:
//
//   // Before:
//   function authFor(action: string) {
//     return createAuthMiddleware({ engine, subject: getUser, resource: getDoc, action, onDeny })
//   }
//
//   // After:
//   const auth = createExpressAuth({ engine, subject: getUser, resource: getDoc, onDeny })
//   app.get('/docs/:id', auth('read'), handler)
//   app.post('/docs/:id', auth('write'), handler)
//
// Per-route overrides are supported:
//   app.get('/docs/:id/admin', auth('admin-view', { resource: () => undefined }), handler)

export interface ExpressAuthConfig<
  S extends Subject = Subject,
  R extends Resource = Resource,
> {
  engine:    AuthEvaluator<S, R>
  subject:   (req: Request) => S | Promise<S>
  resource?: (req: Request) => R | undefined | Promise<R | undefined>
  onDeny?:   (req: Request, res: Response, decision: Decision) => void | Promise<void>
}

export function createExpressAuth<
  S extends Subject = Subject,
  R extends Resource = Resource,
>(base: ExpressAuthConfig<S, R>) {
  return function auth(
    action: string | ((req: Request) => string),
    overrides?: Partial<ExpressAuthConfig<S, R>>,
  ): RequestHandler {
    return createAuthMiddleware<S, R>({ ...base, ...overrides, action })
  }
}
