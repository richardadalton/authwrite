import type { Context, Next, MiddlewareHandler } from 'hono'
import type { Action, AuthEvaluator, Decision, Subject, Resource } from '@daltonr/authwrite-core'

// ─── Context variable key ─────────────────────────────────────────────────────

export const AUTH_DECISION_KEY = 'authDecision'

// ─── Config ───────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyEnv = { Variables: Record<string, any> }

export interface AuthMiddlewareConfig<
  S extends Subject = Subject,
  R extends Resource = Resource,
  Env extends AnyEnv = AnyEnv,
> {
  engine:   AuthEvaluator<S, R>
  subject:  (c: Context<Env>) => S | Promise<S>
  resource: (c: Context<Env>) => R | undefined | Promise<R | undefined>
  action:   Action | ((c: Context<Env>) => Action)
  onDeny?:  (c: Context<Env>, decision: Decision) => Response | Promise<Response>
}

// ─── Middleware factory ───────────────────────────────────────────────────────

export function createAuthMiddleware<
  S extends Subject = Subject,
  R extends Resource = Resource,
  Env extends AnyEnv = AnyEnv,
>(config: AuthMiddlewareConfig<S, R, Env>): MiddlewareHandler<Env> {
  return async (c: Context<Env>, next: Next) => {
    const subject  = await config.subject(c)
    const resource = await config.resource(c)
    const action   = typeof config.action === 'function' ? config.action(c) : config.action

    const decision = await config.engine.evaluate({ subject, resource, action })

    c.set(AUTH_DECISION_KEY as never, decision as never)

    if (decision.allowed) {
      await next()
      return
    }

    if (config.onDeny) {
      const res = await config.onDeny(c, decision)
      return res as unknown as void
    }

    return c.json({ error: 'forbidden', reason: decision.reason }, 403) as unknown as void
  }
}
