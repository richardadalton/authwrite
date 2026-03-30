import { describe, it, expect, vi } from 'vitest'
import { createAuthHook } from '@authwrite/fastify'
import { createAuthEngine, createEnforcer } from '@authwrite/core'
import type { FastifyRequest, FastifyReply } from 'fastify'
import type { PolicyDefinition, Subject, Resource } from '@authwrite/core'

// ─── Domain types ─────────────────────────────────────────────────────────────

type User = Subject
type Doc  = Resource & { status?: string }

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const user  = (attrs: Partial<User> = {}): User => ({ id: 'u1', roles: [], ...attrs })
const doc   = (attrs: Partial<Doc>  = {}): Doc  => ({ type: 'document', id: 'doc-1', ...attrs })

const denyAll:  PolicyDefinition<User, Doc> = { id: 'deny-all',  defaultEffect: 'deny',  rules: [] }
const allowAll: PolicyDefinition<User, Doc> = { id: 'allow-all', defaultEffect: 'allow', rules: [] }

// ─── Test helpers ─────────────────────────────────────────────────────────────

function makeMocks(reqAttrs: Record<string, unknown> = {}) {
  const req   = { params: {}, query: {}, body: {}, headers: {}, ...reqAttrs } as unknown as FastifyRequest
  const reply = {
    status: vi.fn().mockReturnThis(),
    send:   vi.fn().mockReturnThis(),
    code:   vi.fn().mockReturnThis(),
  } as unknown as FastifyReply
  return { req, reply }
}

type HookFn = (req: FastifyRequest, reply: FastifyReply) => Promise<void>

async function run(hook: ReturnType<typeof createAuthHook>, req: FastifyRequest, reply: FastifyReply) {
  await (hook as HookFn)(req, reply)
}

// ─── Basic allow / deny ───────────────────────────────────────────────────────

describe('createAuthHook', () => {
  it('returns without sending when the policy allows', async () => {
    const engine = createAuthEngine({ policy: allowAll })
    const hook = createAuthHook({ engine, subject: () => user(), resource: () => doc(), action: 'read' })
    const { req, reply } = makeMocks()
    await run(hook, req, reply)

    expect(reply.status).not.toHaveBeenCalled()
    expect(reply.send).not.toHaveBeenCalled()
  })

  it('sends 403 with default shape when policy denies', async () => {
    const engine = createAuthEngine({ policy: denyAll })
    const hook = createAuthHook({ engine, subject: () => user(), resource: () => doc(), action: 'read' })
    const { req, reply } = makeMocks()
    await run(hook, req, reply)

    expect(reply.status).toHaveBeenCalledWith(403)
    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'forbidden', reason: expect.any(String) })
    )
  })

  it('default 403 includes the deciding rule reason', async () => {
    const policy: PolicyDefinition<User, Doc> = {
      id: 'p', defaultEffect: 'deny',
      rules: [{ id: 'archived-blocks-write', match: ({ resource }) => resource?.status === 'archived', deny: ['write'] }],
    }
    const engine = createAuthEngine({ policy })
    const hook = createAuthHook({ engine, subject: () => user(), resource: () => doc({ status: 'archived' }), action: 'write' })
    const { req, reply } = makeMocks()
    await run(hook, req, reply)

    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'archived-blocks-write' })
    )
  })
})

// ─── Resolvers ────────────────────────────────────────────────────────────────

describe('resolvers', () => {
  it('subject resolver receives the request', async () => {
    const engine = createAuthEngine({ policy: allowAll })
    const subjectFn = vi.fn().mockReturnValue(user())
    const { req, reply } = makeMocks({ params: { id: 'doc-1' } })
    const hook = createAuthHook({ engine, subject: subjectFn, resource: () => doc(), action: 'read' })
    await run(hook, req, reply)

    expect(subjectFn).toHaveBeenCalledWith(req)
  })

  it('resource resolver receives the request', async () => {
    const engine = createAuthEngine({ policy: allowAll })
    const resourceFn = vi.fn().mockReturnValue(doc())
    const { req, reply } = makeMocks()
    const hook = createAuthHook({ engine, subject: () => user(), resource: resourceFn, action: 'read' })
    await run(hook, req, reply)

    expect(resourceFn).toHaveBeenCalledWith(req)
  })

  it('async resolvers are awaited', async () => {
    const engine = createAuthEngine({ policy: allowAll })
    const hook = createAuthHook({
      engine,
      subject:  async () => { await Promise.resolve(); return user() },
      resource: async () => { await Promise.resolve(); return doc() },
      action:   'read',
    })
    const { req, reply } = makeMocks()
    await run(hook, req, reply)

    expect(reply.status).not.toHaveBeenCalled()
  })

  it('action can be a function of the request', async () => {
    const engine = createAuthEngine({ policy: allowAll })
    const actionFn = vi.fn().mockReturnValue('write')
    const { req, reply } = makeMocks()
    const hook = createAuthHook({ engine, subject: () => user(), resource: () => doc(), action: actionFn })
    await run(hook, req, reply)

    expect(actionFn).toHaveBeenCalledWith(req)
  })

  it('resource can be undefined for subject-level actions', async () => {
    const policy: PolicyDefinition<User, Doc> = {
      id: 'p', defaultEffect: 'deny',
      rules: [{ id: 'change-password', match: ({ resource }) => resource === undefined, allow: ['change-password'] }],
    }
    const engine = createAuthEngine({ policy })
    const hook = createAuthHook({ engine, subject: () => user(), resource: () => undefined, action: 'change-password' })
    const { req, reply } = makeMocks()
    await run(hook, req, reply)

    expect(reply.status).not.toHaveBeenCalled()
  })
})

// ─── onDeny ───────────────────────────────────────────────────────────────────

describe('onDeny', () => {
  it('calls custom onDeny instead of default 403', async () => {
    const engine = createAuthEngine({ policy: denyAll })
    const onDeny = vi.fn()
    const hook = createAuthHook({ engine, subject: () => user(), resource: () => doc(), action: 'read', onDeny })
    const { req, reply } = makeMocks()
    await run(hook, req, reply)

    expect(onDeny).toHaveBeenCalledWith(req, reply, expect.objectContaining({ allowed: false }))
    expect(reply.status).not.toHaveBeenCalled()
  })

  it('custom onDeny receives the full decision', async () => {
    const policy: PolicyDefinition<User, Doc> = {
      id: 'p', defaultEffect: 'deny',
      rules: [{ id: 'my-deny-rule', match: () => true, deny: ['read'] }],
    }
    const engine = createAuthEngine({ policy })
    let captured: unknown
    const hook = createAuthHook({
      engine, subject: () => user(), resource: () => doc(), action: 'read',
      onDeny: (_req, _reply, decision) => { captured = decision },
    })
    const { req, reply } = makeMocks()
    await run(hook, req, reply)

    expect(captured).toMatchObject({ allowed: false, reason: 'my-deny-rule' })
  })

  it('async onDeny is awaited', async () => {
    const log: string[] = []
    const engine = createAuthEngine({ policy: denyAll })
    const hook = createAuthHook({
      engine, subject: () => user(), resource: () => doc(), action: 'read',
      onDeny: async (_req, reply, _d) => {
        await new Promise(r => setTimeout(r, 10))
        log.push('deny handled')
        ;(reply as FastifyReply).status(403)
      },
    })
    const { req, reply } = makeMocks()
    await run(hook, req, reply)
    log.push('run complete')

    expect(log).toEqual(['deny handled', 'run complete'])
  })
})

// ─── req.authDecision ─────────────────────────────────────────────────────────

describe('req.authDecision', () => {
  it('attaches the decision to req when allowed', async () => {
    const engine = createAuthEngine({ policy: allowAll })
    const hook = createAuthHook({ engine, subject: () => user(), resource: () => doc(), action: 'read' })
    const { req, reply } = makeMocks()
    await run(hook, req, reply)

    expect((req as FastifyRequest).authDecision).toMatchObject({ allowed: true })
  })

  it('attaches the decision to req when denied', async () => {
    const engine = createAuthEngine({ policy: denyAll })
    const hook = createAuthHook({ engine, subject: () => user(), resource: () => doc(), action: 'read' })
    const { req, reply } = makeMocks()
    await run(hook, req, reply)

    expect((req as FastifyRequest).authDecision).toMatchObject({ allowed: false })
  })
})

// ─── Enforcer integration ─────────────────────────────────────────────────────

describe('enforcer integration', () => {
  it('audit mode — denied policy allows through', async () => {
    const enforcer = createEnforcer(createAuthEngine({ policy: denyAll }), { mode: 'audit' })
    const hook = createAuthHook({ engine: enforcer, subject: () => user(), resource: () => doc(), action: 'read' })
    const { req, reply } = makeMocks()
    await run(hook, req, reply)

    expect(reply.status).not.toHaveBeenCalled()
    expect((req as FastifyRequest).authDecision?.override).toBe('permissive')
  })

  it('lockdown mode — allowed policy is denied', async () => {
    const enforcer = createEnforcer(createAuthEngine({ policy: allowAll }), { mode: 'lockdown' })
    const hook = createAuthHook({ engine: enforcer, subject: () => user(), resource: () => doc(), action: 'read' })
    const { req, reply } = makeMocks()
    await run(hook, req, reply)

    expect(reply.status).toHaveBeenCalledWith(403)
  })
})
