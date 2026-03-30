import type { RequestHandler, Request, Response } from 'express'
import type { Action, AuthEvaluator, Decision, Subject, Resource } from '@authwrite/core'

// ─── Request augmentation ─────────────────────────────────────────────────────

declare global {
  namespace Express {
    interface Request {
      authDecision?: Decision
    }
  }
}

// ─── Config ───────────────────────────────────────────────────────────────────

export interface AuthMiddlewareConfig<
  S extends Subject = Subject,
  R extends Resource = Resource,
> {
  engine:   AuthEvaluator<S, R>
  subject:  (req: Request) => S | Promise<S>
  resource: (req: Request) => R | undefined | Promise<R | undefined>
  action:   Action | ((req: Request) => Action)
  onDeny?:  (req: Request, res: Response, decision: Decision) => void | Promise<void>
}

// ─── Middleware factory ───────────────────────────────────────────────────────

export function createAuthMiddleware<
  S extends Subject = Subject,
  R extends Resource = Resource,
>(config: AuthMiddlewareConfig<S, R>): RequestHandler {
  return async (req, res, next) => {
    try {
      const subject  = await config.subject(req)
      const resource = await config.resource(req)
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
