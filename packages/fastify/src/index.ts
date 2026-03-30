import type { FastifyRequest, FastifyReply, preHandlerHookHandler } from 'fastify'
import type { Action, AuthEvaluator, Decision, Subject, Resource } from '@authwrite/core'

// ─── Request augmentation ─────────────────────────────────────────────────────

declare module 'fastify' {
  interface FastifyRequest {
    authDecision?: Decision
  }
}

// ─── Config ───────────────────────────────────────────────────────────────────

export interface AuthHookConfig<
  S extends Subject = Subject,
  R extends Resource = Resource,
> {
  engine:   AuthEvaluator<S, R>
  subject:  (req: FastifyRequest) => S | Promise<S>
  resource: (req: FastifyRequest) => R | undefined | Promise<R | undefined>
  action:   Action | ((req: FastifyRequest) => Action)
  onDeny?:  (req: FastifyRequest, reply: FastifyReply, decision: Decision) => void | Promise<void>
}

// ─── Hook factory ─────────────────────────────────────────────────────────────

export function createAuthHook<
  S extends Subject = Subject,
  R extends Resource = Resource,
>(config: AuthHookConfig<S, R>): preHandlerHookHandler {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const subject  = await config.subject(req)
    const resource = await config.resource(req)
    const action   = typeof config.action === 'function' ? config.action(req) : config.action

    const decision = await config.engine.evaluate({ subject, resource, action })

    req.authDecision = decision

    if (decision.allowed) return

    if (config.onDeny) {
      await config.onDeny(req, reply, decision)
      return
    }

    reply.status(403).send({ error: 'forbidden', reason: decision.reason })
  }
}
