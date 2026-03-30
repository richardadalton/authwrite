import { describe, it, expect } from 'vitest'
import { createAuthEngine, createEnforcer } from '@authwrite/core'
import { decisionRecorder } from '@authwrite/testing'
import type { PolicyDefinition, Subject, Resource } from '@authwrite/core'

// ─── Test domain types ────────────────────────────────────────────────────────

type User = Subject
type Doc  = Resource & { status?: string; sensitivity?: string }

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const user = (attrs: Partial<User> = {}): User => ({ id: 'u1', roles: [], ...attrs })
const doc  = (attrs: Partial<Doc>  = {}): Doc  => ({ type: 'document', id: 'doc-1', ...attrs })

const denyAll: PolicyDefinition<User, Doc> = { id: 'deny-all', defaultEffect: 'deny',  rules: [] }
const allowAll: PolicyDefinition<User, Doc> = { id: 'allow-all', defaultEffect: 'allow', rules: [] }

// ─── enforce mode ─────────────────────────────────────────────────────────────

describe('enforce mode', () => {
  it('passes allow decisions through unchanged', async () => {
    const enforcer = createEnforcer(createAuthEngine({ policy: allowAll }), { mode: 'enforce' })
    const d = await enforcer.evaluate({ subject: user(), resource: doc(), action: 'read' })

    expect(d.allowed).toBe(true)
    expect(d.override).toBeUndefined()
  })

  it('passes deny decisions through unchanged', async () => {
    const enforcer = createEnforcer(createAuthEngine({ policy: denyAll }), { mode: 'enforce' })
    const d = await enforcer.evaluate({ subject: user(), resource: doc(), action: 'read' })

    expect(d.allowed).toBe(false)
    expect(d.override).toBeUndefined()
  })

  it('mode getter returns "enforce"', () => {
    const enforcer = createEnforcer(createAuthEngine({ policy: denyAll }), { mode: 'enforce' })
    expect(enforcer.mode).toBe('enforce')
  })
})

// ─── audit mode ───────────────────────────────────────────────────────────────

describe('audit mode', () => {
  it('overrides deny to allow', async () => {
    const enforcer = createEnforcer(createAuthEngine({ policy: denyAll }), { mode: 'audit' })
    const d = await enforcer.evaluate({ subject: user(), resource: doc(), action: 'read' })

    expect(d.allowed).toBe(true)
    expect(d.effect).toBe('allow')
  })

  it('marks the overridden decision with override: "permissive"', async () => {
    const enforcer = createEnforcer(createAuthEngine({ policy: denyAll }), { mode: 'audit' })
    const d = await enforcer.evaluate({ subject: user(), resource: doc(), action: 'read' })

    expect(d.override).toBe('permissive')
  })

  it('preserves the original reason so observers know which rule fired', async () => {
    const policy: PolicyDefinition<User, Doc> = {
      id: 'p',
      defaultEffect: 'deny',
      rules: [{ id: 'archived-blocks-write', match: ({ resource }) => resource?.status === 'archived', deny: ['write'] }],
    }
    const enforcer = createEnforcer(createAuthEngine({ policy }), { mode: 'audit' })
    const d = await enforcer.evaluate({ subject: user(), resource: doc({ status: 'archived' }), action: 'write' })

    expect(d.allowed).toBe(true)
    expect(d.override).toBe('permissive')
    expect(d.reason).toBe('archived-blocks-write')
  })

  it('allows that are already allowed pass through without an override marker', async () => {
    const enforcer = createEnforcer(createAuthEngine({ policy: allowAll }), { mode: 'audit' })
    const d = await enforcer.evaluate({ subject: user(), resource: doc(), action: 'read' })

    expect(d.allowed).toBe(true)
    expect(d.override).toBeUndefined()
  })

  it('engine observers receive the real (un-overridden) decision', async () => {
    const recorder = decisionRecorder()
    const engine = createAuthEngine({ policy: denyAll, observers: [recorder] })
    const enforcer = createEnforcer(engine, { mode: 'audit' })

    const returned = await enforcer.evaluate({ subject: user(), resource: doc(), action: 'read' })
    const observed = recorder.all()[0].decision

    // Caller sees overridden decision
    expect(returned.allowed).toBe(true)
    expect(returned.override).toBe('permissive')

    // Observer sees honest engine decision
    expect(observed.allowed).toBe(false)
    expect(observed.override).toBeUndefined()
  })

  it('can() returns true even when policy would deny', async () => {
    const enforcer = createEnforcer(createAuthEngine({ policy: denyAll }), { mode: 'audit' })
    expect(await enforcer.can(user(), doc(), 'delete')).toBe(true)
  })

  it('evaluateAll overrides every denied decision', async () => {
    const policy: PolicyDefinition<User, Doc> = {
      id: 'p',
      defaultEffect: 'deny',
      rules: [{ id: 'can-read', match: () => true, allow: ['read'] }],
    }
    const enforcer = createEnforcer(createAuthEngine({ policy }), { mode: 'audit' })
    const results = await enforcer.evaluateAll({
      subject: user(),
      resource: doc(),
      actions: ['read', 'write', 'delete'],
    })

    // read was already allowed — no override
    expect(results['read'].allowed).toBe(true)
    expect(results['read'].override).toBeUndefined()

    // write and delete were denied — overridden
    expect(results['write'].allowed).toBe(true)
    expect(results['write'].override).toBe('permissive')
    expect(results['delete'].allowed).toBe(true)
    expect(results['delete'].override).toBe('permissive')
  })

  it('evaluateRead returns all resource fields when policy would deny the read', async () => {
    const enforcer = createEnforcer(createAuthEngine({ policy: denyAll }), { mode: 'audit' })
    const resource = doc({ status: 'draft', sensitivity: 'public' })

    const { decision, allowedFields } = await enforcer.evaluateRead({ subject: user(), resource })

    expect(decision.allowed).toBe(true)
    expect(decision.override).toBe('permissive')
    expect(allowedFields).toEqual(expect.arrayContaining(Object.keys(resource)))
  })

  it('evaluateRead respects fieldRules when the policy allows the read', async () => {
    const policy: PolicyDefinition<User, Doc> = {
      id: 'p',
      defaultEffect: 'allow',
      rules: [],
      fieldRules: [
        { id: 'limited-fields', match: () => true, expose: ['id', 'status'], redact: [] },
      ],
    }
    const enforcer = createEnforcer(createAuthEngine({ policy }), { mode: 'audit' })
    const { decision, allowedFields } = await enforcer.evaluateRead({
      subject: user(),
      resource: doc({ status: 'draft', sensitivity: 'public' }),
    })

    // Already allowed — fieldRules still apply, no override
    expect(decision.override).toBeUndefined()
    expect(allowedFields).toContain('id')
    expect(allowedFields).toContain('status')
    expect(allowedFields).not.toContain('sensitivity')
  })
})

// ─── lockdown mode ────────────────────────────────────────────────────────────

describe('lockdown mode', () => {
  it('overrides allow to deny', async () => {
    const enforcer = createEnforcer(createAuthEngine({ policy: allowAll }), { mode: 'lockdown' })
    const d = await enforcer.evaluate({ subject: user(), resource: doc(), action: 'read' })

    expect(d.allowed).toBe(false)
    expect(d.effect).toBe('deny')
  })

  it('marks the overridden decision with override: "lockdown"', async () => {
    const enforcer = createEnforcer(createAuthEngine({ policy: allowAll }), { mode: 'lockdown' })
    const d = await enforcer.evaluate({ subject: user(), resource: doc(), action: 'read' })

    expect(d.override).toBe('lockdown')
  })

  it('preserves the original reason', async () => {
    const policy: PolicyDefinition<User, Doc> = {
      id: 'p',
      defaultEffect: 'deny',
      rules: [{ id: 'owner-access', match: () => true, allow: ['read'] }],
    }
    const enforcer = createEnforcer(createAuthEngine({ policy }), { mode: 'lockdown' })
    const d = await enforcer.evaluate({ subject: user(), resource: doc(), action: 'read' })

    expect(d.allowed).toBe(false)
    expect(d.override).toBe('lockdown')
    expect(d.reason).toBe('owner-access')
  })

  it('denials that are already denied pass through without an override marker', async () => {
    const enforcer = createEnforcer(createAuthEngine({ policy: denyAll }), { mode: 'lockdown' })
    const d = await enforcer.evaluate({ subject: user(), resource: doc(), action: 'read' })

    expect(d.allowed).toBe(false)
    expect(d.override).toBeUndefined()
  })

  it('engine observers receive the real (un-overridden) decision', async () => {
    const recorder = decisionRecorder()
    const engine = createAuthEngine({ policy: allowAll, observers: [recorder] })
    const enforcer = createEnforcer(engine, { mode: 'lockdown' })

    const returned = await enforcer.evaluate({ subject: user(), resource: doc(), action: 'read' })
    const observed = recorder.all()[0].decision

    expect(returned.allowed).toBe(false)
    expect(returned.override).toBe('lockdown')

    expect(observed.allowed).toBe(true)
    expect(observed.override).toBeUndefined()
  })

  it('can() returns false even when policy would allow', async () => {
    const enforcer = createEnforcer(createAuthEngine({ policy: allowAll }), { mode: 'lockdown' })
    expect(await enforcer.can(user(), doc(), 'read')).toBe(false)
  })

  it('evaluateAll overrides every allowed decision', async () => {
    const enforcer = createEnforcer(createAuthEngine({ policy: allowAll }), { mode: 'lockdown' })
    const results = await enforcer.evaluateAll({
      subject: user(),
      resource: doc(),
      actions: ['read', 'write', 'delete'],
    })

    for (const action of ['read', 'write', 'delete']) {
      expect(results[action].allowed).toBe(false)
      expect(results[action].override).toBe('lockdown')
    }
  })

  it('evaluateRead returns empty fields even when policy would allow', async () => {
    const enforcer = createEnforcer(createAuthEngine({ policy: allowAll }), { mode: 'lockdown' })
    const { decision, allowedFields } = await enforcer.evaluateRead({
      subject: user(),
      resource: doc({ status: 'draft' }),
    })

    expect(decision.allowed).toBe(false)
    expect(decision.override).toBe('lockdown')
    expect(allowedFields).toEqual([])
  })
})

// ─── setMode() ────────────────────────────────────────────────────────────────

describe('setMode()', () => {
  it('mode getter reflects the current mode', () => {
    const enforcer = createEnforcer(createAuthEngine({ policy: denyAll }), { mode: 'audit' })
    expect(enforcer.mode).toBe('audit')

    enforcer.setMode('enforce')
    expect(enforcer.mode).toBe('enforce')

    enforcer.setMode('lockdown')
    expect(enforcer.mode).toBe('lockdown')
  })

  it('switching from audit to enforce causes subsequent denials to actually deny', async () => {
    const engine = createAuthEngine({ policy: denyAll })
    const enforcer = createEnforcer(engine, { mode: 'audit' })

    const inAudit = await enforcer.evaluate({ subject: user(), resource: doc(), action: 'read' })
    expect(inAudit.allowed).toBe(true)

    enforcer.setMode('enforce')

    const inEnforce = await enforcer.evaluate({ subject: user(), resource: doc(), action: 'read' })
    expect(inEnforce.allowed).toBe(false)
  })

  it('switching from enforce to lockdown causes subsequent allows to actually deny', async () => {
    const engine = createAuthEngine({ policy: allowAll })
    const enforcer = createEnforcer(engine, { mode: 'enforce' })

    const inEnforce = await enforcer.evaluate({ subject: user(), resource: doc(), action: 'read' })
    expect(inEnforce.allowed).toBe(true)

    enforcer.setMode('lockdown')

    const inLockdown = await enforcer.evaluate({ subject: user(), resource: doc(), action: 'read' })
    expect(inLockdown.allowed).toBe(false)
    expect(inLockdown.override).toBe('lockdown')
  })

  it('in-flight calls complete with the mode they started under', async () => {
    // Both evaluations are in flight simultaneously.
    // The first resolves in audit mode; the second should too
    // since setMode is called after both are started.
    const engine = createAuthEngine({ policy: denyAll })
    const enforcer = createEnforcer(engine, { mode: 'audit' })

    const [first, second] = await Promise.all([
      enforcer.evaluate({ subject: user(), resource: doc(), action: 'read' }),
      enforcer.evaluate({ subject: user(), resource: doc(), action: 'write' }),
    ])

    enforcer.setMode('enforce')

    // Both started in audit mode — both should have been allowed
    expect(first.allowed).toBe(true)
    expect(second.allowed).toBe(true)
  })
})
