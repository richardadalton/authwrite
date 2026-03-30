import { describe, it, expect, vi, beforeEach } from 'vitest'
import { withAuth } from '@authwrite/nextjs'
import { createAuthEngine, createEnforcer } from '@authwrite/core'
import type { RouteContext } from '@authwrite/nextjs'
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

function makeRequest(method = 'GET', url = 'https://example.com/api'): Request {
  return new Request(url, { method })
}

function makeCtx(params: Record<string, string> = {}): RouteContext {
  return { params: Promise.resolve(params) }
}

const okHandler = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }))
beforeEach(() => { okHandler.mockClear() })

async function parseJson(res: Response) {
  return res.json()
}

// ─── Basic allow / deny ───────────────────────────────────────────────────────

describe('withAuth', () => {
  it('calls the handler and returns its response when allowed', async () => {
    const engine = createAuthEngine({ policy: allowAll })
    const handler = withAuth({ engine, subject: () => user(), resource: () => doc(), action: 'read' }, okHandler)
    const res = await handler(makeRequest(), makeCtx())

    expect(res.status).toBe(200)
    expect(okHandler).toHaveBeenCalled()
  })

  it('returns 403 with default shape when denied', async () => {
    const engine = createAuthEngine({ policy: denyAll })
    const handler = withAuth({ engine, subject: () => user(), resource: () => doc(), action: 'read' }, okHandler)
    const res = await handler(makeRequest(), makeCtx())

    expect(res.status).toBe(403)
    const body = await parseJson(res)
    expect(body).toMatchObject({ error: 'forbidden', reason: expect.any(String) })
  })

  it('default 403 includes the deciding rule reason', async () => {
    const policy: PolicyDefinition<User, Doc> = {
      id: 'p', defaultEffect: 'deny',
      rules: [{ id: 'archived-blocks-write', match: ({ resource }) => resource?.status === 'archived', deny: ['write'] }],
    }
    const engine = createAuthEngine({ policy })
    const handler = withAuth({ engine, subject: () => user(), resource: () => doc({ status: 'archived' }), action: 'write' }, okHandler)
    const res = await handler(makeRequest('PUT'), makeCtx({ id: 'doc-1' }))
    const body = await parseJson(res)

    expect(body.reason).toBe('archived-blocks-write')
  })
})

// ─── Resolvers ────────────────────────────────────────────────────────────────

describe('resolvers', () => {
  it('subject resolver receives request and ctx', async () => {
    const engine = createAuthEngine({ policy: allowAll })
    const subjectFn = vi.fn().mockReturnValue(user())
    const req = makeRequest()
    const ctx = makeCtx({ id: 'doc-1' })
    const handler = withAuth({ engine, subject: subjectFn, resource: () => doc(), action: 'read' }, okHandler)
    await handler(req, ctx)

    expect(subjectFn).toHaveBeenCalledWith(req, ctx)
  })

  it('resource resolver receives request and ctx', async () => {
    const engine = createAuthEngine({ policy: allowAll })
    const resourceFn = vi.fn().mockReturnValue(doc())
    const req = makeRequest()
    const ctx = makeCtx({ id: 'doc-1' })
    const handler = withAuth({ engine, subject: () => user(), resource: resourceFn, action: 'read' }, okHandler)
    await handler(req, ctx)

    expect(resourceFn).toHaveBeenCalledWith(req, ctx)
  })

  it('async resolvers are awaited', async () => {
    const engine = createAuthEngine({ policy: allowAll })
    const handler = withAuth({
      engine,
      subject:  async () => { await Promise.resolve(); return user() },
      resource: async () => { await Promise.resolve(); return doc() },
      action:   'read',
    }, okHandler)
    const res = await handler(makeRequest(), makeCtx())

    expect(res.status).toBe(200)
  })

  it('action can be a function of request and ctx', async () => {
    const engine = createAuthEngine({ policy: allowAll })
    const actionFn = vi.fn().mockReturnValue('write')
    const req = makeRequest()
    const ctx = makeCtx()
    const handler = withAuth({ engine, subject: () => user(), resource: () => doc(), action: actionFn }, okHandler)
    await handler(req, ctx)

    expect(actionFn).toHaveBeenCalledWith(req, ctx)
  })

  it('resource can be undefined for subject-level actions', async () => {
    const policy: PolicyDefinition<User, Doc> = {
      id: 'p', defaultEffect: 'deny',
      rules: [{ id: 'change-password', match: ({ resource }) => resource === undefined, allow: ['change-password'] }],
    }
    const engine = createAuthEngine({ policy })
    const handler = withAuth({ engine, subject: () => user(), resource: () => undefined, action: 'change-password' }, okHandler)
    const res = await handler(makeRequest('POST'), makeCtx())

    expect(res.status).toBe(200)
  })
})

// ─── onDeny ───────────────────────────────────────────────────────────────────

describe('onDeny', () => {
  it('calls custom onDeny instead of default 403', async () => {
    const engine = createAuthEngine({ policy: denyAll })
    const customDenyResponse = new Response('custom', { status: 401 })
    const onDeny = vi.fn().mockResolvedValue(customDenyResponse)
    const handler = withAuth({ engine, subject: () => user(), resource: () => doc(), action: 'read', onDeny }, okHandler)
    const res = await handler(makeRequest(), makeCtx())

    expect(res.status).toBe(401)
    expect(onDeny).toHaveBeenCalledWith(
      expect.any(Request),
      expect.anything(),
      expect.objectContaining({ allowed: false }),
    )
    expect(okHandler).not.toHaveBeenCalled()
  })

  it('custom onDeny receives the full decision', async () => {
    const policy: PolicyDefinition<User, Doc> = {
      id: 'p', defaultEffect: 'deny',
      rules: [{ id: 'my-deny-rule', match: () => true, deny: ['read'] }],
    }
    const engine = createAuthEngine({ policy })
    let captured: unknown
    const handler = withAuth({
      engine, subject: () => user(), resource: () => doc(), action: 'read',
      onDeny: async (_req, _ctx, decision) => {
        captured = decision
        return new Response(null, { status: 403 })
      },
    }, okHandler)
    await handler(makeRequest(), makeCtx())

    expect(captured).toMatchObject({ allowed: false, reason: 'my-deny-rule' })
  })
})

// ─── Enforcer integration ─────────────────────────────────────────────────────

describe('enforcer integration', () => {
  it('audit mode — denied policy allows through', async () => {
    const enforcer = createEnforcer(createAuthEngine({ policy: denyAll }), { mode: 'audit' })
    const handler = withAuth({ engine: enforcer, subject: () => user(), resource: () => doc(), action: 'read' }, okHandler)
    const res = await handler(makeRequest(), makeCtx())

    expect(res.status).toBe(200)
  })

  it('lockdown mode — allowed policy is denied', async () => {
    const enforcer = createEnforcer(createAuthEngine({ policy: allowAll }), { mode: 'lockdown' })
    const handler = withAuth({ engine: enforcer, subject: () => user(), resource: () => doc(), action: 'read' }, okHandler)
    const res = await handler(makeRequest(), makeCtx())

    expect(res.status).toBe(403)
  })
})
