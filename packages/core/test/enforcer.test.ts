import { describe, it, expect } from 'vitest'
import { createAuthEngine } from '@authwrite/core'
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
    const engine = createAuthEngine({ policy: allowAll, mode: 'enforce' })
    const d = await engine.evaluate({ subject: user(), resource: doc(), action: 'read' })

    expect(d.allowed).toBe(true)
    expect(d.override).toBeUndefined()
  })

  it('passes deny decisions through unchanged', async () => {
    const engine = createAuthEngine({ policy: denyAll, mode: 'enforce' })
    const d = await engine.evaluate({ subject: user(), resource: doc(), action: 'read' })

    expect(d.allowed).toBe(false)
    expect(d.override).toBeUndefined()
  })

  it('getMode() returns "enforce"', () => {
    const engine = createAuthEngine({ policy: denyAll, mode: 'enforce' })
    expect(engine.getMode()).toBe('enforce')
  })
})

// ─── audit mode ───────────────────────────────────────────────────────────────

describe('audit mode', () => {
  it('overrides deny to allow', async () => {
    const engine = createAuthEngine({ policy: denyAll, mode: 'audit' })
    const d = await engine.evaluate({ subject: user(), resource: doc(), action: 'read' })

    expect(d.allowed).toBe(true)
    expect(d.effect).toBe('allow')
  })

  it('marks the overridden decision with override: "permissive"', async () => {
    const engine = createAuthEngine({ policy: denyAll, mode: 'audit' })
    const d = await engine.evaluate({ subject: user(), resource: doc(), action: 'read' })

    expect(d.override).toBe('permissive')
  })

  it('preserves the original reason so observers know which rule fired', async () => {
    const policy: PolicyDefinition<User, Doc> = {
      id: 'p',
      defaultEffect: 'deny',
      rules: [{ id: 'archived-blocks-write', match: ({ resource }) => resource?.status === 'archived', deny: ['write'] }],
    }
    const engine = createAuthEngine({ policy, mode: 'audit' })
    const d = await engine.evaluate({ subject: user(), resource: doc({ status: 'archived' }), action: 'write' })

    expect(d.allowed).toBe(true)
    expect(d.override).toBe('permissive')
    expect(d.reason).toBe('archived-blocks-write')
  })

  it('allows that are already allowed pass through without an override marker', async () => {
    const engine = createAuthEngine({ policy: allowAll, mode: 'audit' })
    const d = await engine.evaluate({ subject: user(), resource: doc(), action: 'read' })

    expect(d.allowed).toBe(true)
    expect(d.override).toBeUndefined()
  })

  it('observers receive the real (un-overridden) policy decision', async () => {
    const recorder = decisionRecorder()
    const engine = createAuthEngine({ policy: denyAll, mode: 'audit', observers: [recorder] })

    const returned = await engine.evaluate({ subject: user(), resource: doc(), action: 'read' })
    const observed = recorder.all()[0].decision

    // Caller sees overridden decision
    expect(returned.allowed).toBe(true)
    expect(returned.override).toBe('permissive')

    // Observer sees honest policy decision
    expect(observed.allowed).toBe(false)
    expect(observed.override).toBeUndefined()
  })

  it('can() returns true even when policy would deny', async () => {
    const engine = createAuthEngine({ policy: denyAll, mode: 'audit' })
    expect(await engine.can(user(), doc(), 'delete')).toBe(true)
  })

  it('evaluateAll overrides every denied decision', async () => {
    const policy: PolicyDefinition<User, Doc> = {
      id: 'p',
      defaultEffect: 'deny',
      rules: [{ id: 'owner-read', match: ({ subject, resource }) => resource?.ownerId === subject.id, allow: ['read'] }],
    }
    const engine = createAuthEngine({ policy, mode: 'audit' })
    const docs    = [doc({ ownerId: 'u1' }), doc({ ownerId: 'u2' })]
    const results = await engine.evaluateAll(user(), docs, 'read')

    // owned doc was already allowed — no override
    expect(results[0]!.decision.allowed).toBe(true)
    expect(results[0]!.decision.override).toBeUndefined()

    // foreign doc was denied — audit overrides to allow
    expect(results[1]!.decision.allowed).toBe(true)
    expect(results[1]!.decision.override).toBe('permissive')
  })

  it('evaluateRead returns all resource fields when policy would deny the read', async () => {
    const engine = createAuthEngine({ policy: denyAll, mode: 'audit' })
    const resource = doc({ status: 'draft', sensitivity: 'public' })

    const { decision, allowedFields } = await engine.evaluateRead({ subject: user(), resource })

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
    const engine = createAuthEngine({ policy, mode: 'audit' })
    const { decision, allowedFields } = await engine.evaluateRead({
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

// ─── suspended mode ───────────────────────────────────────────────────────────

describe('suspended mode', () => {
  it('overrides allow to deny', async () => {
    const engine = createAuthEngine({ policy: allowAll, mode: 'suspended' })
    const d = await engine.evaluate({ subject: user(), resource: doc(), action: 'read' })

    expect(d.allowed).toBe(false)
    expect(d.effect).toBe('deny')
  })

  it('marks the overridden decision with override: "suspended"', async () => {
    const engine = createAuthEngine({ policy: allowAll, mode: 'suspended' })
    const d = await engine.evaluate({ subject: user(), resource: doc(), action: 'read' })

    expect(d.override).toBe('suspended')
  })

  it('preserves the original reason so observers know which rule fired', async () => {
    const policy: PolicyDefinition<User, Doc> = {
      id: 'p',
      defaultEffect: 'deny',
      rules: [{ id: 'owner-access', match: () => true, allow: ['read'] }],
    }
    const engine = createAuthEngine({ policy, mode: 'suspended' })
    const d = await engine.evaluate({ subject: user(), resource: doc(), action: 'read' })

    expect(d.allowed).toBe(false)
    expect(d.override).toBe('suspended')
    expect(d.reason).toBe('owner-access')
  })

  it('denials that are already denied pass through without an override marker', async () => {
    const engine = createAuthEngine({ policy: denyAll, mode: 'suspended' })
    const d = await engine.evaluate({ subject: user(), resource: doc(), action: 'read' })

    expect(d.allowed).toBe(false)
    expect(d.override).toBeUndefined()
  })

  it('observers receive the real (un-overridden) policy decision', async () => {
    const recorder = decisionRecorder()
    const engine = createAuthEngine({ policy: allowAll, mode: 'suspended', observers: [recorder] })

    const returned = await engine.evaluate({ subject: user(), resource: doc(), action: 'read' })
    const observed = recorder.all()[0].decision

    expect(returned.allowed).toBe(false)
    expect(returned.override).toBe('suspended')

    expect(observed.allowed).toBe(true)
    expect(observed.override).toBeUndefined()
  })

  it('can() returns false even when policy would allow', async () => {
    const engine = createAuthEngine({ policy: allowAll, mode: 'suspended' })
    expect(await engine.can(user(), doc(), 'read')).toBe(false)
  })

  it('evaluateAll overrides every allowed decision', async () => {
    const engine  = createAuthEngine({ policy: allowAll, mode: 'suspended' })
    const docs    = [doc(), doc(), doc()]
    const results = await engine.evaluateAll(user(), docs, 'read')

    for (const { decision } of results) {
      expect(decision.allowed).toBe(false)
      expect(decision.override).toBe('suspended')
    }
  })

  it('evaluateRead returns empty fields even when policy would allow', async () => {
    const engine = createAuthEngine({ policy: allowAll, mode: 'suspended' })
    const { decision, allowedFields } = await engine.evaluateRead({
      subject: user(),
      resource: doc({ status: 'draft' }),
    })

    expect(decision.allowed).toBe(false)
    expect(decision.override).toBe('suspended')
    expect(allowedFields).toEqual([])
  })
})

// ─── lockdown mode ────────────────────────────────────────────────────────────

describe('lockdown mode', () => {
  it('denies without evaluating the policy', async () => {
    const engine = createAuthEngine({ policy: allowAll, mode: 'lockdown' })
    const d = await engine.evaluate({ subject: user(), resource: doc(), action: 'read' })

    expect(d.allowed).toBe(false)
    expect(d.effect).toBe('deny')
    expect(d.reason).toBe('lockdown')
    expect(d.override).toBe('lockdown')
  })

  it('fires observers with the lockdown decision', async () => {
    const recorder = decisionRecorder()
    const engine = createAuthEngine({ policy: allowAll, mode: 'lockdown', observers: [recorder] })

    await engine.evaluate({ subject: user(), resource: doc(), action: 'read' })

    expect(recorder.all()).toHaveLength(1)
    expect(recorder.all()[0].decision.reason).toBe('lockdown')
    expect(recorder.all()[0].decision.override).toBe('lockdown')
  })

  it('can() returns false', async () => {
    const engine = createAuthEngine({ policy: allowAll, mode: 'lockdown' })
    expect(await engine.can(user(), doc(), 'read')).toBe(false)
  })

  it('evaluateAll denies every resource and fires observers per resource', async () => {
    const recorder = decisionRecorder()
    const engine   = createAuthEngine({ policy: allowAll, mode: 'lockdown', observers: [recorder] })
    const docs     = [doc(), doc(), doc()]

    const results = await engine.evaluateAll(user(), docs, 'read')

    for (const { decision } of results) {
      expect(decision.allowed).toBe(false)
      expect(decision.override).toBe('lockdown')
    }
    expect(recorder.all()).toHaveLength(3)
  })

  it('evaluateRead returns empty fields and fires observers', async () => {
    const recorder = decisionRecorder()
    const engine = createAuthEngine({ policy: allowAll, mode: 'lockdown', observers: [recorder] })

    const { decision, allowedFields } = await engine.evaluateRead({
      subject: user(),
      resource: doc({ status: 'draft' }),
    })

    expect(decision.allowed).toBe(false)
    expect(decision.override).toBe('lockdown')
    expect(allowedFields).toEqual([])
    expect(recorder.all()).toHaveLength(1)
  })
})

// ─── permissions() ───────────────────────────────────────────────────────────

describe('permissions()', () => {
  it('returns policy truth in enforce mode', async () => {
    const policy: PolicyDefinition<User, Doc> = {
      id: 'p', defaultEffect: 'deny',
      rules: [{ id: 'can-read', match: () => true, allow: ['read'] }],
    }
    const engine = createAuthEngine({ policy, mode: 'enforce' })
    const perms  = await engine.permissions(user(), doc(), ['read', 'write'])

    expect(perms.read).toBe(true)
    expect(perms.write).toBe(false)
  })

  it('returns all true in audit mode without firing observers', async () => {
    const recorder = decisionRecorder()
    const engine = createAuthEngine({ policy: denyAll, mode: 'audit', observers: [recorder] })
    const perms = await engine.permissions(user(), doc(), ['read', 'write'])

    expect(perms.read).toBe(true)
    expect(perms.write).toBe(true)
    expect(recorder.all()).toHaveLength(0)
  })

  it('returns all false in suspended mode without firing observers', async () => {
    const recorder = decisionRecorder()
    const engine = createAuthEngine({ policy: allowAll, mode: 'suspended', observers: [recorder] })
    const perms = await engine.permissions(user(), doc(), ['read', 'write'])

    expect(perms.read).toBe(false)
    expect(perms.write).toBe(false)
    expect(recorder.all()).toHaveLength(0)
  })

  it('returns all false in lockdown mode without firing observers', async () => {
    const recorder = decisionRecorder()
    const engine = createAuthEngine({ policy: allowAll, mode: 'lockdown', observers: [recorder] })
    const perms = await engine.permissions(user(), doc(), ['read', 'write'])

    expect(perms.read).toBe(false)
    expect(perms.write).toBe(false)
    expect(recorder.all()).toHaveLength(0)
  })

  it('does not fire observers in enforce mode', async () => {
    const recorder = decisionRecorder()
    const engine = createAuthEngine({ policy: allowAll, mode: 'enforce', observers: [recorder] })
    await engine.permissions(user(), doc(), ['read', 'write', 'delete'])

    expect(recorder.all()).toHaveLength(0)
  })
})

// ─── setMode() ────────────────────────────────────────────────────────────────

describe('setMode()', () => {
  it('getMode() reflects the current mode', () => {
    const engine = createAuthEngine({ policy: denyAll, mode: 'audit' })
    expect(engine.getMode()).toBe('audit')

    engine.setMode('enforce')
    expect(engine.getMode()).toBe('enforce')

    engine.setMode('suspended')
    expect(engine.getMode()).toBe('suspended')

    engine.setMode('lockdown')
    expect(engine.getMode()).toBe('lockdown')
  })

  it('switching from audit to enforce causes subsequent denials to actually deny', async () => {
    const engine = createAuthEngine({ policy: denyAll, mode: 'audit' })

    const inAudit = await engine.evaluate({ subject: user(), resource: doc(), action: 'read' })
    expect(inAudit.allowed).toBe(true)

    engine.setMode('enforce')

    const inEnforce = await engine.evaluate({ subject: user(), resource: doc(), action: 'read' })
    expect(inEnforce.allowed).toBe(false)
  })

  it('switching from enforce to suspended causes subsequent allows to actually deny', async () => {
    const engine = createAuthEngine({ policy: allowAll, mode: 'enforce' })

    const inEnforce = await engine.evaluate({ subject: user(), resource: doc(), action: 'read' })
    expect(inEnforce.allowed).toBe(true)

    engine.setMode('suspended')

    const inSuspended = await engine.evaluate({ subject: user(), resource: doc(), action: 'read' })
    expect(inSuspended.allowed).toBe(false)
    expect(inSuspended.override).toBe('suspended')
  })

  it('switching from suspended to lockdown — both modes fire observers', async () => {
    const recorder = decisionRecorder()
    const engine = createAuthEngine({ policy: allowAll, mode: 'suspended', observers: [recorder] })

    await engine.evaluate({ subject: user(), resource: doc(), action: 'read' })
    expect(recorder.all()).toHaveLength(1)

    engine.setMode('lockdown')
    await engine.evaluate({ subject: user(), resource: doc(), action: 'read' })
    expect(recorder.all()).toHaveLength(2)
    expect(recorder.all()[1].decision.reason).toBe('lockdown')
  })

  it('in-flight calls complete with the mode they started under', async () => {
    const engine = createAuthEngine({ policy: denyAll, mode: 'audit' })

    const [first, second] = await Promise.all([
      engine.evaluate({ subject: user(), resource: doc(), action: 'read' }),
      engine.evaluate({ subject: user(), resource: doc(), action: 'write' }),
    ])

    engine.setMode('enforce')

    // Both started in audit mode — both should have been allowed
    expect(first.allowed).toBe(true)
    expect(second.allowed).toBe(true)
  })
})
