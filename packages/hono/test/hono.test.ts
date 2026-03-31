import { describe, it, expect, vi } from 'vitest'
import { createAuthMiddleware, AUTH_DECISION_KEY } from '@daltonr/authwrite-hono'
import { createAuthEngine } from '@daltonr/authwrite-core'
import type { Context, Next } from 'hono'
import type { PolicyDefinition, Subject, Resource, Decision } from '@daltonr/authwrite-core'

// ─── Domain types ─────────────────────────────────────────────────────────────

type User = Subject
type Doc  = Resource & { status?: string }

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const user  = (attrs: Partial<User> = {}): User => ({ id: 'u1', roles: [], ...attrs })
const doc   = (attrs: Partial<Doc>  = {}): Doc  => ({ type: 'document', id: 'doc-1', ...attrs })

const denyAll:  PolicyDefinition<User, Doc> = { id: 'deny-all',  defaultEffect: 'deny',  rules: [] }
const allowAll: PolicyDefinition<User, Doc> = { id: 'allow-all', defaultEffect: 'allow', rules: [] }

// ─── Mock Hono context ────────────────────────────────────────────────────────

function makeContext(paramOverrides: Record<string, string> = {}) {
  const vars: Record<string, unknown> = {}
  const jsonResponse = { body: null as unknown, status: 200 }

  const c = {
    req: {
      param: (key: string) => paramOverrides[key],
      raw:   new Request('https://example.com/'),
    },
    set: vi.fn((key: string, value: unknown) => { vars[key] = value }),
    get: vi.fn((key: string) => vars[key]),
    json: vi.fn((body: unknown, status = 200) => {
      jsonResponse.body   = body
      jsonResponse.status = status
      return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
    }),
    _vars:          vars,
    _jsonResponse:  jsonResponse,
  } as unknown as Context & { _vars: typeof vars; _jsonResponse: typeof jsonResponse }

  return c
}

type MiddlewareFn = (c: Context, next: Next) => Promise<void>

async function run(
  mw: ReturnType<typeof createAuthMiddleware>,
  c: Context,
  next: Next = vi.fn().mockResolvedValue(undefined),
) {
  await (mw as MiddlewareFn)(c, next)
  return next
}

// ─── Basic allow / deny ───────────────────────────────────────────────────────

describe('createAuthMiddleware', () => {
  it('calls next() when the policy allows', async () => {
    const engine = createAuthEngine({ policy: allowAll })
    const mw = createAuthMiddleware({ engine, subject: () => user(), resource: () => doc(), action: 'read' })
    const c = makeContext()
    const next = await run(mw, c)

    expect(next).toHaveBeenCalled()
    expect((c as ReturnType<typeof makeContext>)._jsonResponse.status).toBe(200)
  })

  it('returns 403 with default shape when denied', async () => {
    const engine = createAuthEngine({ policy: denyAll })
    const mw = createAuthMiddleware({ engine, subject: () => user(), resource: () => doc(), action: 'read' })
    const c = makeContext()
    const next = await run(mw, c)

    expect(next).not.toHaveBeenCalled()
    expect(c.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'forbidden', reason: expect.any(String) }), 403
    )
  })

  it('default 403 includes the deciding rule reason', async () => {
    const policy: PolicyDefinition<User, Doc> = {
      id: 'p', defaultEffect: 'deny',
      rules: [{ id: 'archived-blocks-write', match: ({ resource }) => resource?.status === 'archived', deny: ['write'] }],
    }
    const engine = createAuthEngine({ policy })
    const mw = createAuthMiddleware({ engine, subject: () => user(), resource: () => doc({ status: 'archived' }), action: 'write' })
    const c = makeContext()
    await run(mw, c)

    expect(c.json).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'archived-blocks-write' }), 403
    )
  })
})

// ─── Resolvers ────────────────────────────────────────────────────────────────

describe('resolvers', () => {
  it('subject resolver receives the context', async () => {
    const engine = createAuthEngine({ policy: allowAll })
    const subjectFn = vi.fn().mockReturnValue(user())
    const c = makeContext()
    const mw = createAuthMiddleware({ engine, subject: subjectFn, resource: () => doc(), action: 'read' })
    await run(mw, c)

    expect(subjectFn).toHaveBeenCalledWith(c)
  })

  it('resource resolver receives the context', async () => {
    const engine = createAuthEngine({ policy: allowAll })
    const resourceFn = vi.fn().mockReturnValue(doc())
    const c = makeContext({ id: 'doc-1' })
    const mw = createAuthMiddleware({ engine, subject: () => user(), resource: resourceFn, action: 'read' })
    await run(mw, c)

    expect(resourceFn).toHaveBeenCalledWith(c)
  })

  it('async resolvers are awaited', async () => {
    const engine = createAuthEngine({ policy: allowAll })
    const mw = createAuthMiddleware({
      engine,
      subject:  async () => { await Promise.resolve(); return user() },
      resource: async () => { await Promise.resolve(); return doc() },
      action:   'read',
    })
    const c = makeContext()
    const next = await run(mw, c)

    expect(next).toHaveBeenCalled()
  })

  it('action can be a function of the context', async () => {
    const engine = createAuthEngine({ policy: allowAll })
    const actionFn = vi.fn().mockReturnValue('write')
    const c = makeContext()
    const mw = createAuthMiddleware({ engine, subject: () => user(), resource: () => doc(), action: actionFn })
    await run(mw, c)

    expect(actionFn).toHaveBeenCalledWith(c)
  })

  it('resource can be undefined for subject-level actions', async () => {
    const policy: PolicyDefinition<User, Doc> = {
      id: 'p', defaultEffect: 'deny',
      rules: [{ id: 'change-password', match: ({ resource }) => resource === undefined, allow: ['change-password'] }],
    }
    const engine = createAuthEngine({ policy })
    const mw = createAuthMiddleware({ engine, subject: () => user(), resource: () => undefined, action: 'change-password' })
    const c = makeContext()
    const next = await run(mw, c)

    expect(next).toHaveBeenCalled()
  })
})

// ─── onDeny ───────────────────────────────────────────────────────────────────

describe('onDeny', () => {
  it('calls custom onDeny instead of default 403', async () => {
    const engine = createAuthEngine({ policy: denyAll })
    const customResponse = new Response('custom', { status: 401 })
    const onDeny = vi.fn().mockResolvedValue(customResponse)
    const mw = createAuthMiddleware({ engine, subject: () => user(), resource: () => doc(), action: 'read', onDeny })
    const c = makeContext()
    const next = await run(mw, c)

    expect(onDeny).toHaveBeenCalledWith(c, expect.objectContaining({ allowed: false }))
    expect(next).not.toHaveBeenCalled()
    expect(c.json).not.toHaveBeenCalled()
  })

  it('custom onDeny receives the full decision', async () => {
    const policy: PolicyDefinition<User, Doc> = {
      id: 'p', defaultEffect: 'deny',
      rules: [{ id: 'my-deny-rule', match: () => true, deny: ['read'] }],
    }
    const engine = createAuthEngine({ policy })
    let captured: unknown
    const mw = createAuthMiddleware({
      engine, subject: () => user(), resource: () => doc(), action: 'read',
      onDeny: async (_c, decision) => {
        captured = decision
        return new Response(null, { status: 403 })
      },
    })
    const c = makeContext()
    await run(mw, c)

    expect(captured).toMatchObject({ allowed: false, reason: 'my-deny-rule' })
  })
})

// ─── c.set(authDecision) ──────────────────────────────────────────────────────

describe('context authDecision variable', () => {
  it('stores the decision on the context when allowed', async () => {
    const engine = createAuthEngine({ policy: allowAll })
    const mw = createAuthMiddleware({ engine, subject: () => user(), resource: () => doc(), action: 'read' })
    const c = makeContext()
    await run(mw, c)

    expect(c.set).toHaveBeenCalledWith(AUTH_DECISION_KEY, expect.objectContaining({ allowed: true }))
  })

  it('stores the decision on the context when denied', async () => {
    const engine = createAuthEngine({ policy: denyAll })
    const mw = createAuthMiddleware({ engine, subject: () => user(), resource: () => doc(), action: 'read' })
    const c = makeContext()
    await run(mw, c)

    expect(c.set).toHaveBeenCalledWith(AUTH_DECISION_KEY, expect.objectContaining({ allowed: false }))
  })

  it('stored decision is retrievable via c.get', async () => {
    const engine = createAuthEngine({ policy: allowAll })
    const mw = createAuthMiddleware({ engine, subject: () => user(), resource: () => doc(), action: 'read' })
    const c = makeContext()
    await run(mw, c)

    const decision = (c as ReturnType<typeof makeContext>)._vars[AUTH_DECISION_KEY] as Decision
    expect(decision.allowed).toBe(true)
    expect(decision.policy).toBe('allow-all')
  })
})

// ─── Enforcer integration ─────────────────────────────────────────────────────

describe('enforcer integration', () => {
  it('audit mode — denied policy allows through', async () => {
    const engine = createAuthEngine({ policy: denyAll, mode: 'audit' })
    const mw = createAuthMiddleware({ engine, subject: () => user(), resource: () => doc(), action: 'read' })
    const c = makeContext()
    const next = await run(mw, c)

    expect(next).toHaveBeenCalled()
    const decision = (c as ReturnType<typeof makeContext>)._vars[AUTH_DECISION_KEY] as Decision
    expect(decision.override).toBe('permissive')
  })

  it('suspended mode — allowed policy is denied', async () => {
    const engine = createAuthEngine({ policy: allowAll, mode: 'suspended' })
    const mw = createAuthMiddleware({ engine, subject: () => user(), resource: () => doc(), action: 'read' })
    const c = makeContext()
    const next = await run(mw, c)

    expect(next).not.toHaveBeenCalled()
    expect(c.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'forbidden' }), 403)
  })
})
