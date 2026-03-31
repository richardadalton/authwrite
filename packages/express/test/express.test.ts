import { describe, it, expect, vi } from 'vitest'
import { createAuthMiddleware } from '@daltonr/authwrite-express'
import { createAuthEngine } from "@daltonr/authwrite-core"
import type { RequestHandler, Request, Response, NextFunction } from 'express'
import type { PolicyDefinition, Subject, Resource } from '@daltonr/authwrite-core'

// ─── Test domain types ────────────────────────────────────────────────────────

type User = Subject
type Doc  = Resource & { status?: string }

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const user  = (attrs: Partial<User> = {}): User => ({ id: 'u1', roles: [], ...attrs })
const doc   = (attrs: Partial<Doc>  = {}): Doc  => ({ type: 'document', id: 'doc-1', ...attrs })

const denyAll: PolicyDefinition<User, Doc> = { id: 'deny-all',  defaultEffect: 'deny',  rules: [] }
const allowAll: PolicyDefinition<User, Doc> = { id: 'allow-all', defaultEffect: 'allow', rules: [] }

// ─── Test helpers ─────────────────────────────────────────────────────────────

function makeMocks(reqAttrs: Record<string, unknown> = {}) {
  const req  = { params: {}, query: {}, body: {}, headers: {}, ...reqAttrs } as unknown as Request
  const res  = {
    status: vi.fn().mockReturnThis(),
    json:   vi.fn().mockReturnThis(),
    send:   vi.fn().mockReturnThis(),
  } as unknown as Response
  const next = vi.fn() as unknown as NextFunction
  return { req, res, next }
}

async function run(mw: RequestHandler, req: Request, res: Response, next: NextFunction) {
  await (mw as (r: Request, s: Response, n: NextFunction) => Promise<void>)(req, res, next)
}

// ─── Basic allow / deny ───────────────────────────────────────────────────────

describe('createAuthMiddleware', () => {
  it('calls next() when the policy allows', async () => {
    const engine = createAuthEngine({ policy: allowAll })
    const mw = createAuthMiddleware({
      engine,
      subject:  () => user(),
      resource: () => doc(),
      action:   'read',
    })
    const { req, res, next } = makeMocks()
    await run(mw, req, res, next)

    expect(next).toHaveBeenCalledWith()          // next() with no args = proceed
    expect(res.status).not.toHaveBeenCalled()
  })

  it('returns 403 with default shape when policy denies', async () => {
    const engine = createAuthEngine({ policy: denyAll })
    const mw = createAuthMiddleware({
      engine,
      subject:  () => user(),
      resource: () => doc(),
      action:   'read',
    })
    const { req, res, next } = makeMocks()
    await run(mw, req, res, next)

    expect(next).not.toHaveBeenCalled()
    expect(res.status).toHaveBeenCalledWith(403)
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'forbidden', reason: expect.any(String) })
    )
  })

  it('default 403 response includes the deciding rule reason', async () => {
    const policy: PolicyDefinition<User, Doc> = {
      id: 'p',
      defaultEffect: 'deny',
      rules: [
        { id: 'archived-blocks-write', match: ({ resource }) => resource?.status === 'archived', deny: ['write'] },
      ],
    }
    const engine = createAuthEngine({ policy })
    const mw = createAuthMiddleware({
      engine,
      subject:  () => user(),
      resource: () => doc({ status: 'archived' }),
      action:   'write',
    })
    const { req, res, next } = makeMocks()
    await run(mw, req, res, next)

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'archived-blocks-write' })
    )
  })
})

// ─── Resolvers ────────────────────────────────────────────────────────────────

describe('resolvers', () => {
  it('subject resolver receives the request', async () => {
    const engine = createAuthEngine({ policy: allowAll })
    const subjectFn = vi.fn().mockReturnValue(user())
    const { req, res, next } = makeMocks({ params: { id: 'doc-1' } })

    const mw = createAuthMiddleware({
      engine,
      subject:  subjectFn,
      resource: () => doc(),
      action:   'read',
    })
    await run(mw, req, res, next)

    expect(subjectFn).toHaveBeenCalledWith(req)
  })

  it('resource resolver receives the request', async () => {
    const engine = createAuthEngine({ policy: allowAll })
    const resourceFn = vi.fn().mockReturnValue(doc())
    const { req, res, next } = makeMocks({ params: { id: 'doc-1' } })

    const mw = createAuthMiddleware({
      engine,
      subject:  () => user(),
      resource: resourceFn,
      action:   'read',
    })
    await run(mw, req, res, next)

    expect(resourceFn).toHaveBeenCalledWith(req)
  })

  it('async subject resolver is awaited', async () => {
    const engine = createAuthEngine({ policy: allowAll })
    const mw = createAuthMiddleware({
      engine,
      subject:  async () => { await Promise.resolve(); return user() },
      resource: () => doc(),
      action:   'read',
    })
    const { req, res, next } = makeMocks()
    await run(mw, req, res, next)

    expect(next).toHaveBeenCalledWith()
  })

  it('async resource resolver is awaited (e.g. DB fetch)', async () => {
    const engine = createAuthEngine({ policy: allowAll })
    const mw = createAuthMiddleware({
      engine,
      subject:  () => user(),
      resource: async (req) => {
        await Promise.resolve()
        return doc({ id: (req.params as Record<string, string>).id })
      },
      action: 'read',
    })
    const { req, res, next } = makeMocks({ params: { id: 'doc-99' } })
    await run(mw, req, res, next)

    expect(next).toHaveBeenCalledWith()
  })

  it('action can be a function of the request', async () => {
    const engine = createAuthEngine({ policy: allowAll })
    const actionFn = vi.fn().mockReturnValue('write')
    const { req, res, next } = makeMocks()

    const mw = createAuthMiddleware({
      engine,
      subject:  () => user(),
      resource: () => doc(),
      action:   actionFn,
    })
    await run(mw, req, res, next)

    expect(actionFn).toHaveBeenCalledWith(req)
    expect(next).toHaveBeenCalledWith()
  })

  it('resource can be undefined for subject-level actions', async () => {
    const policy: PolicyDefinition<User, Doc> = {
      id: 'p',
      defaultEffect: 'deny',
      rules: [{ id: 'anyone-can-change-password', match: ({ resource }) => resource === undefined, allow: ['change-password'] }],
    }
    const engine = createAuthEngine({ policy })
    const mw = createAuthMiddleware({
      engine,
      subject:  () => user(),
      resource: () => undefined,
      action:   'change-password',
    })
    const { req, res, next } = makeMocks()
    await run(mw, req, res, next)

    expect(next).toHaveBeenCalledWith()
  })
})

// ─── onDeny ───────────────────────────────────────────────────────────────────

describe('onDeny', () => {
  it('calls custom onDeny handler instead of default 403', async () => {
    const engine = createAuthEngine({ policy: denyAll })
    const onDeny = vi.fn()
    const mw = createAuthMiddleware({
      engine,
      subject:  () => user(),
      resource: () => doc(),
      action:   'read',
      onDeny,
    })
    const { req, res, next } = makeMocks()
    await run(mw, req, res, next)

    expect(onDeny).toHaveBeenCalledWith(req, res, expect.objectContaining({ allowed: false }))
    expect(res.status).not.toHaveBeenCalled()  // default handler not used
    expect(next).not.toHaveBeenCalled()
  })

  it('custom onDeny receives the full decision', async () => {
    const policy: PolicyDefinition<User, Doc> = {
      id: 'p',
      defaultEffect: 'deny',
      rules: [{ id: 'my-deny-rule', match: () => true, deny: ['read'] }],
    }
    const engine = createAuthEngine({ policy })
    let capturedDecision: unknown
    const mw = createAuthMiddleware({
      engine,
      subject:  () => user(),
      resource: () => doc(),
      action:   'read',
      onDeny: (_req, _res, decision) => { capturedDecision = decision },
    })
    const { req, res, next } = makeMocks()
    await run(mw, req, res, next)

    expect(capturedDecision).toMatchObject({ allowed: false, reason: 'my-deny-rule' })
  })

  it('async onDeny is awaited', async () => {
    const log: string[] = []
    const engine = createAuthEngine({ policy: denyAll })
    const mw = createAuthMiddleware({
      engine,
      subject:  () => user(),
      resource: () => doc(),
      action:   'read',
      onDeny: async (_req, res, _decision) => {
        await new Promise(r => setTimeout(r, 10))
        log.push('deny handled')
        ;(res as Response).status(403)
      },
    })
    const { req, res, next } = makeMocks()
    await run(mw, req, res, next)
    log.push('run complete')

    expect(log).toEqual(['deny handled', 'run complete'])
  })
})

// ─── req.authDecision ─────────────────────────────────────────────────────────

describe('req.authDecision', () => {
  it('attaches the decision to req so downstream handlers can use it', async () => {
    const engine = createAuthEngine({ policy: allowAll })
    const mw = createAuthMiddleware({
      engine,
      subject:  () => user(),
      resource: () => doc(),
      action:   'read',
    })
    const { req, res, next } = makeMocks()
    await run(mw, req, res, next)

    expect((req as Request & { authDecision: unknown }).authDecision).toMatchObject({
      allowed: true,
    })
  })

  it('attaches the decision even when denied', async () => {
    const engine = createAuthEngine({ policy: denyAll })
    const mw = createAuthMiddleware({
      engine,
      subject:  () => user(),
      resource: () => doc(),
      action:   'read',
    })
    const { req, res, next } = makeMocks()
    await run(mw, req, res, next)

    expect((req as Request & { authDecision: unknown }).authDecision).toMatchObject({
      allowed: false,
    })
  })
})

// ─── Error handling ───────────────────────────────────────────────────────────

describe('error handling', () => {
  it('passes subject resolver errors to next(err)', async () => {
    const engine = createAuthEngine({ policy: allowAll })
    const mw = createAuthMiddleware({
      engine,
      subject:  () => { throw new Error('auth service down') },
      resource: () => doc(),
      action:   'read',
    })
    const { req, res, next } = makeMocks()
    await run(mw, req, res, next)

    expect(next).toHaveBeenCalledWith(expect.any(Error))
    expect((next as ReturnType<typeof vi.fn>).mock.calls[0][0].message).toBe('auth service down')
  })

  it('passes resource resolver errors to next(err)', async () => {
    const engine = createAuthEngine({ policy: allowAll })
    const mw = createAuthMiddleware({
      engine,
      subject:  () => user(),
      resource: () => { throw new Error('db unavailable') },
      action:   'read',
    })
    const { req, res, next } = makeMocks()
    await run(mw, req, res, next)

    expect(next).toHaveBeenCalledWith(expect.any(Error))
  })

  it('passes async resolver rejections to next(err)', async () => {
    const engine = createAuthEngine({ policy: allowAll })
    const mw = createAuthMiddleware({
      engine,
      subject:  () => user(),
      resource: async () => { throw new Error('timeout') },
      action:   'read',
    })
    const { req, res, next } = makeMocks()
    await run(mw, req, res, next)

    expect(next).toHaveBeenCalledWith(expect.any(Error))
  })
})

// ─── Enforcer integration ─────────────────────────────────────────────────────

describe('enforcer integration', () => {
  it('audit mode — denied policy still allows through', async () => {
    const engine = createAuthEngine({ policy: denyAll, mode: 'audit' })
    const mw = createAuthMiddleware({
      engine,
      subject:  () => user(),
      resource: () => doc(),
      action:   'read',
    })
    const { req, res, next } = makeMocks()
    await run(mw, req, res, next)

    expect(next).toHaveBeenCalledWith()
    expect((req as Request & { authDecision: { override: string } }).authDecision?.override)
      .toBe('permissive')
  })

  it('suspended mode — allowed policy still denies', async () => {
    const engine = createAuthEngine({ policy: allowAll, mode: 'suspended' })
    const mw = createAuthMiddleware({
      engine,
      subject:  () => user(),
      resource: () => doc(),
      action:   'read',
    })
    const { req, res, next } = makeMocks()
    await run(mw, req, res, next)

    expect(next).not.toHaveBeenCalled()
    expect(res.status).toHaveBeenCalledWith(403)
  })
})
