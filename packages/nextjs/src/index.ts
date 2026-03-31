import type { Action, AuthEvaluator, Decision, Subject, Resource } from '@daltonr/authwrite-core'

// ─── Next.js App Router types ─────────────────────────────────────────────────
//
// Defined locally to avoid a hard dependency on the `next` package in tests and
// non-Next environments. The shapes match next/server exactly.

export interface RouteContext {
  params: Promise<Record<string, string>>
}

type RouteHandler = (req: Request, ctx: RouteContext) => Promise<Response>

// ─── Config ───────────────────────────────────────────────────────────────────

export interface WithAuthConfig<
  S extends Subject = Subject,
  R extends Resource = Resource,
> {
  engine:   AuthEvaluator<S, R>
  subject:  (req: Request, ctx: RouteContext) => S | Promise<S>
  resource: (req: Request, ctx: RouteContext) => R | undefined | Promise<R | undefined>
  action:   Action | ((req: Request, ctx: RouteContext) => Action)
  onDeny?:  (req: Request, ctx: RouteContext, decision: Decision) => Promise<Response>
}

// ─── Route handler wrapper ────────────────────────────────────────────────────

export function withAuth<
  S extends Subject = Subject,
  R extends Resource = Resource,
>(config: WithAuthConfig<S, R>, handler: RouteHandler): RouteHandler {
  return async (req: Request, ctx: RouteContext) => {
    const subject  = await config.subject(req, ctx)
    const resource = await config.resource(req, ctx)
    const action   = typeof config.action === 'function' ? config.action(req, ctx) : config.action

    const decision = await config.engine.evaluate({ subject, resource, action })

    if (decision.allowed) return handler(req, ctx)

    if (config.onDeny) return config.onDeny(req, ctx, decision)

    return Response.json(
      { error: 'forbidden', reason: decision.reason },
      { status: 403 },
    )
  }
}
