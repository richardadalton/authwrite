import { describe, it } from 'vitest'
import * as fc from 'fast-check'
import { createAuthEngine } from '@daltonr/authwrite-core'
import { decisionRecorder } from '@daltonr/authwrite-testing'
import type { PolicyDefinition, PolicyRule, FieldRule, Subject, Resource, AuthContext } from '@daltonr/authwrite-core'

// ─── Arbitraries ──────────────────────────────────────────────────────────────

const arbId = fc.string({ minLength: 1, maxLength: 20 })

const arbAction = fc.constantFrom('read', 'write', 'delete', 'create', 'archive', 'publish')

const arbDefaultEffect = fc.constantFrom('allow' as const, 'deny' as const)

const arbSubject = fc.record({
  id: arbId,
  roles: fc.array(fc.constantFrom('admin', 'editor', 'viewer', 'owner'), { maxLength: 3 }),
})

const arbResource = fc.record({
  type: arbId,
  id: fc.option(arbId, { nil: undefined }),
  ownerId: fc.option(arbId, { nil: undefined }),
})

const arbContext = fc.record({
  subject:  arbSubject,
  resource: fc.option(arbResource, { nil: undefined }),
  action:   arbAction,
})

// Policy with no rules — outcome is always from defaultEffect
const arbNoRulePolicy = fc.record({
  id:            arbId,
  defaultEffect: arbDefaultEffect,
  rules:         fc.constant([] as PolicyRule[]),
})

// Policy with a single always-match rule
function alwaysMatchPolicy(effect: 'allow' | 'deny', action: string): PolicyDefinition {
  return {
    id: 'always-match',
    defaultEffect: effect === 'allow' ? 'deny' : 'allow',
    rules: [{
      id:    'always',
      match: () => true,
      ...(effect === 'allow' ? { allow: [action] } : { deny: [action] }),
    }],
  }
}

// Arbitrary priority value
const arbPriority = fc.integer({ min: 0, max: 100 })

// ─── Decision shape invariants ────────────────────────────────────────────────
//
// For any policy and any context, the returned Decision must always be
// internally consistent — regardless of what the policy says.

describe('decision shape invariants', () => {
  it('allowed and effect are always consistent', async () => {
    await fc.assert(fc.asyncProperty(arbNoRulePolicy, arbContext, async (policy, ctx) => {
      const engine = createAuthEngine({ policy })
      const d = await engine.evaluate(ctx)
      return (d.allowed && d.effect === 'allow') || (!d.allowed && d.effect === 'deny')
    }))
  })

  it('durationMs is always >= 0', async () => {
    await fc.assert(fc.asyncProperty(arbNoRulePolicy, arbContext, async (policy, ctx) => {
      const engine = createAuthEngine({ policy })
      const d = await engine.evaluate(ctx)
      return d.durationMs >= 0
    }))
  })

  it('evaluatedAt is always a Date', async () => {
    await fc.assert(fc.asyncProperty(arbNoRulePolicy, arbContext, async (policy, ctx) => {
      const engine = createAuthEngine({ policy })
      const d = await engine.evaluate(ctx)
      return d.evaluatedAt instanceof Date
    }))
  })

  it('reason is always a non-empty string', async () => {
    await fc.assert(fc.asyncProperty(arbNoRulePolicy, arbContext, async (policy, ctx) => {
      const engine = createAuthEngine({ policy })
      const d = await engine.evaluate(ctx)
      return typeof d.reason === 'string' && d.reason.length > 0
    }))
  })

  it('defaulted:true always coincides with reason:"default"', async () => {
    await fc.assert(fc.asyncProperty(arbNoRulePolicy, arbContext, async (policy, ctx) => {
      const engine = createAuthEngine({ policy })
      const d = await engine.evaluate(ctx)
      if (d.defaulted) return d.reason === 'default'
      return true
    }))
  })

  it('context in the decision is the same object passed to evaluate', async () => {
    await fc.assert(fc.asyncProperty(arbNoRulePolicy, arbContext, async (policy, ctx) => {
      const engine = createAuthEngine({ policy })
      const d = await engine.evaluate(ctx)
      return d.context === ctx
    }))
  })

  it('policy label is always a non-empty string', async () => {
    await fc.assert(fc.asyncProperty(arbNoRulePolicy, arbContext, async (policy, ctx) => {
      const engine = createAuthEngine({ policy })
      const d = await engine.evaluate(ctx)
      return typeof d.policy === 'string' && d.policy.length > 0
    }))
  })
})

// ─── Default effect ───────────────────────────────────────────────────────────
//
// With no matching rules, the outcome is always exactly the defaultEffect.

describe('default effect invariants', () => {
  it('deny defaultEffect with no rules always produces allowed:false', async () => {
    const policy: PolicyDefinition = { id: 'p', defaultEffect: 'deny', rules: [] }
    await fc.assert(fc.asyncProperty(arbContext, async (ctx) => {
      const engine = createAuthEngine({ policy })
      const d = await engine.evaluate(ctx)
      return d.allowed === false && d.defaulted === true && d.reason === 'default'
    }))
  })

  it('allow defaultEffect with no rules always produces allowed:true', async () => {
    const policy: PolicyDefinition = { id: 'p', defaultEffect: 'allow', rules: [] }
    await fc.assert(fc.asyncProperty(arbContext, async (ctx) => {
      const engine = createAuthEngine({ policy })
      const d = await engine.evaluate(ctx)
      return d.allowed === true && d.defaulted === true && d.reason === 'default'
    }))
  })
})

// ─── can() consistency ────────────────────────────────────────────────────────
//
// can() is a convenience wrapper — it must always equal evaluate().allowed.

describe('can() consistency', () => {
  it('can(subject, resource, action) always matches evaluate().allowed', async () => {
    await fc.assert(fc.asyncProperty(arbNoRulePolicy, arbSubject, arbResource, arbAction, async (policy, subject, resource, action) => {
      const engine = createAuthEngine({ policy })
      const [canResult, decision] = await Promise.all([
        engine.can(subject, resource, action),
        engine.evaluate({ subject, resource, action }),
      ])
      return canResult === decision.allowed
    }))
  })

  it('can(subject, action) always matches evaluate().allowed with no resource', async () => {
    await fc.assert(fc.asyncProperty(arbNoRulePolicy, arbSubject, arbAction, async (policy, subject, action) => {
      const engine = createAuthEngine({ policy })
      const [canResult, decision] = await Promise.all([
        engine.can(subject, action),
        engine.evaluate({ subject, action }),
      ])
      return canResult === decision.allowed
    }))
  })
})

// ─── evaluateAll consistency ──────────────────────────────────────────────────
//
// evaluateAll(subject, resources[], action) — one action, many resources.
// Each paired decision must match a direct evaluate() call for that resource.

describe('evaluateAll consistency', () => {
  it('each result decision matches a direct evaluate() call for that resource', async () => {
    await fc.assert(fc.asyncProperty(
      arbNoRulePolicy,
      arbSubject,
      fc.array(arbResource, { maxLength: 5 }),
      arbAction,
      async (policy, subject, resources, action) => {
        const engine  = createAuthEngine({ policy })
        const results = await engine.evaluateAll(subject, resources, action)

        if (results.length !== resources.length) return false

        for (let i = 0; i < resources.length; i++) {
          const single = await engine.evaluate({ subject, resource: resources[i], action })
          if (results[i]!.decision.allowed !== single.allowed) return false
          if (results[i]!.resource !== resources[i]) return false
        }
        return true
      }
    ))
  })

  it('returns as many results as resources were passed', async () => {
    await fc.assert(fc.asyncProperty(
      arbNoRulePolicy,
      arbSubject,
      fc.array(arbResource, { maxLength: 10 }),
      arbAction,
      async (policy, subject, resources, action) => {
        const engine  = createAuthEngine({ policy })
        const results = await engine.evaluateAll(subject, resources, action)
        return results.length === resources.length
      }
    ))
  })
})

// ─── permissions consistency ──────────────────────────────────────────────────
//
// permissions(subject, resource, actions[]) must agree with direct evaluate()
// calls and must never fire observers.

describe('permissions consistency', () => {
  it('permissions(subject, resource, actions) matches evaluate() for each action', async () => {
    const actions = ['read', 'write', 'delete', 'create'] as const
    await fc.assert(fc.asyncProperty(
      arbNoRulePolicy,
      arbSubject,
      arbResource,
      async (policy, subject, resource) => {
        const engine = createAuthEngine({ policy })
        const perms  = await engine.permissions(subject, resource, [...actions])

        for (const action of actions) {
          const single = await engine.evaluate({ subject, resource, action })
          if (perms[action] !== single.allowed) return false
        }
        return true
      }
    ))
  })

  it('permissions(subject, actions) matches evaluate() with no resource', async () => {
    const actions = ['read', 'write', 'delete', 'create'] as const
    await fc.assert(fc.asyncProperty(
      arbNoRulePolicy,
      arbSubject,
      async (policy, subject) => {
        const engine = createAuthEngine({ policy })
        const perms  = await engine.permissions(subject, [...actions])

        for (const action of actions) {
          const single = await engine.evaluate({ subject, action })
          if (perms[action] !== single.allowed) return false
        }
        return true
      }
    ))
  })

  it('never fires observers regardless of policy or overload', async () => {
    const actions = ['read', 'write', 'delete'] as const
    await fc.assert(fc.asyncProperty(
      arbNoRulePolicy,
      arbSubject,
      arbResource,
      async (policy, subject, resource) => {
        let fired = 0
        const observer = { onDecision: () => { fired++ } }
        const engine = createAuthEngine({ policy, observers: [observer] })
        await engine.permissions(subject, resource, [...actions])
        await engine.permissions(subject, [...actions])
        return fired === 0
      }
    ))
  })
})

// ─── Priority: deny beats allow at equal priority ─────────────────────────────

describe('priority and conflict resolution', () => {
  it('deny rule beats allow rule at equal priority for any priority value', async () => {
    await fc.assert(fc.asyncProperty(arbPriority, arbAction, arbContext, async (priority, action, ctx) => {
      const policy: PolicyDefinition = {
        id: 'p',
        defaultEffect: 'allow',
        rules: [
          { id: 'allow-rule', match: () => true, allow: [action], priority },
          { id: 'deny-rule',  match: () => true, deny:  [action], priority },
        ],
      }
      const engine = createAuthEngine({ policy })
      const d = await engine.evaluate({ ...ctx, action })
      return d.allowed === false && d.reason === 'deny-rule'
    }))
  })

  it('higher priority deny rule beats lower priority allow rule', async () => {
    await fc.assert(fc.asyncProperty(
      fc.integer({ min: 0, max: 99 }),
      arbAction,
      arbContext,
      async (basePriority, action, ctx) => {
        const policy: PolicyDefinition = {
          id: 'p',
          defaultEffect: 'deny',
          rules: [
            { id: 'allow-rule', match: () => true, allow: [action], priority: basePriority },
            { id: 'deny-rule',  match: () => true, deny:  [action], priority: basePriority + 1 },
          ],
        }
        const engine = createAuthEngine({ policy })
        const d = await engine.evaluate({ ...ctx, action })
        return d.allowed === false
      }
    ))
  })

  it('higher priority allow rule beats lower priority deny rule', async () => {
    await fc.assert(fc.asyncProperty(
      fc.integer({ min: 0, max: 99 }),
      arbAction,
      arbContext,
      async (basePriority, action, ctx) => {
        const policy: PolicyDefinition = {
          id: 'p',
          defaultEffect: 'deny',
          rules: [
            { id: 'allow-rule', match: () => true, allow: [action], priority: basePriority + 1 },
            { id: 'deny-rule',  match: () => true, deny:  [action], priority: basePriority },
          ],
        }
        const engine = createAuthEngine({ policy })
        const d = await engine.evaluate({ ...ctx, action })
        return d.allowed === true
      }
    ))
  })
})

// ─── Enforcer mode invariants ─────────────────────────────────────────────────

describe('enforcer mode invariants', () => {
  it('audit mode: allowed is always true regardless of policy', async () => {
    await fc.assert(fc.asyncProperty(arbNoRulePolicy, arbContext, async (policy, ctx) => {
      const engine = createAuthEngine({ policy, mode: 'audit' })
      const d = await engine.evaluate(ctx)
      return d.allowed === true
    }))
  })

  it('suspended mode: allowed is always false regardless of policy', async () => {
    await fc.assert(fc.asyncProperty(arbNoRulePolicy, arbContext, async (policy, ctx) => {
      const engine = createAuthEngine({ policy, mode: 'suspended' })
      const d = await engine.evaluate(ctx)
      return d.allowed === false
    }))
  })

  it('lockdown mode: allowed is always false, reason is "lockdown", override is "lockdown"', async () => {
    await fc.assert(fc.asyncProperty(arbNoRulePolicy, arbContext, async (policy, ctx) => {
      const engine = createAuthEngine({ policy, mode: 'lockdown' })
      const d = await engine.evaluate(ctx)
      return d.allowed === false && d.reason === 'lockdown' && d.override === 'lockdown'
    }))
  })

  it('enforce mode: outcome always matches direct evaluate() with no mode set', async () => {
    await fc.assert(fc.asyncProperty(arbNoRulePolicy, arbContext, async (policy, ctx) => {
      const engineDefault = createAuthEngine({ policy })
      const engineEnforce = createAuthEngine({ policy, mode: 'enforce' })
      const [raw, enforced] = await Promise.all([engineDefault.evaluate(ctx), engineEnforce.evaluate(ctx)])
      return raw.allowed === enforced.allowed && enforced.override === undefined
    }))
  })

  it('audit mode: decision shape is still valid (effect/allowed consistent)', async () => {
    await fc.assert(fc.asyncProperty(arbNoRulePolicy, arbContext, async (policy, ctx) => {
      const engine = createAuthEngine({ policy, mode: 'audit' })
      const d = await engine.evaluate(ctx)
      return (d.allowed && d.effect === 'allow') || (!d.allowed && d.effect === 'deny')
    }))
  })

  it('suspended mode: decision shape is still valid (effect/allowed consistent)', async () => {
    await fc.assert(fc.asyncProperty(arbNoRulePolicy, arbContext, async (policy, ctx) => {
      const engine = createAuthEngine({ policy, mode: 'suspended' })
      const d = await engine.evaluate(ctx)
      return (d.allowed && d.effect === 'allow') || (!d.allowed && d.effect === 'deny')
    }))
  })
})

// ─── Observer honesty ─────────────────────────────────────────────────────────
//
// Observers on the engine always see the raw (unmodified) decision.
// The enforcer's mode only affects what the caller receives.

describe('observer honesty', () => {
  it('in audit mode, observer sees the raw policy decision, not the overridden one', async () => {
    // Use a deny-all policy so the engine always denies — audit mode overrides to allow
    const policy: PolicyDefinition = { id: 'p', defaultEffect: 'deny', rules: [] }
    await fc.assert(fc.asyncProperty(arbContext, async (ctx) => {
      const recorder = decisionRecorder()
      const engine   = createAuthEngine({ policy, mode: 'audit', observers: [recorder] })

      const returned = await engine.evaluate(ctx)
      const observed = recorder.decisions()[0]

      // Caller sees allow (audit override), observer sees honest deny
      return returned.allowed === true && observed.allowed === false
    }))
  })

  it('in suspended mode, observer sees the raw policy decision, not the overridden one', async () => {
    // Use an allow-all policy so the engine always allows — suspended mode overrides to deny
    const policy: PolicyDefinition = { id: 'p', defaultEffect: 'allow', rules: [] }
    await fc.assert(fc.asyncProperty(arbContext, async (ctx) => {
      const recorder = decisionRecorder()
      const engine   = createAuthEngine({ policy, mode: 'suspended', observers: [recorder] })

      const returned = await engine.evaluate(ctx)
      const observed = recorder.decisions()[0]

      // Caller sees deny (suspended override), observer sees honest allow
      return returned.allowed === false && observed.allowed === true
    }))
  })

  it('in lockdown mode, observers receive a lockdown decision', async () => {
    await fc.assert(fc.asyncProperty(arbNoRulePolicy, arbContext, async (policy, ctx) => {
      const recorder = decisionRecorder()
      const engine   = createAuthEngine({ policy, mode: 'lockdown', observers: [recorder] })

      await engine.evaluate(ctx)

      return recorder.decisions().length === 1 && recorder.decisions()[0].reason === 'lockdown'
    }))
  })
})

// ─── Field filtering invariants ───────────────────────────────────────────────

describe('field filtering invariants', () => {
  // A resource with a fixed set of fields
  const arbResourceWithFields = fc.record({
    type:   fc.constant('doc'),
    fieldA: fc.string(),
    fieldB: fc.string(),
    fieldC: fc.string(),
  }) as fc.Arbitrary<Resource & { fieldA: string; fieldB: string; fieldC: string }>

  it('allowedFields is always a subset of resource keys', async () => {
    const policy: PolicyDefinition = { id: 'p', defaultEffect: 'allow', rules: [] }
    await fc.assert(fc.asyncProperty(arbSubject, arbResourceWithFields, async (subject, resource) => {
      const engine = createAuthEngine({ policy })
      const { allowedFields } = await engine.evaluateRead({ subject, resource })
      const resourceKeys = Object.keys(resource)
      return allowedFields.every(f => resourceKeys.includes(f))
    }))
  })

  it('redact always overrides expose — any field in both is never allowed', async () => {
    // fieldRule exposes all fields but also redacts fieldA — fieldA must never appear
    const policy: PolicyDefinition = {
      id: 'p',
      defaultEffect: 'allow',
      rules: [],
      fieldRules: [{
        id:     'rule',
        match:  () => true,
        expose: ['fieldA', 'fieldB', 'fieldC'],
        redact: ['fieldA'],
      }],
    }
    await fc.assert(fc.asyncProperty(arbSubject, arbResourceWithFields, async (subject, resource) => {
      const engine = createAuthEngine({ policy })
      const { allowedFields } = await engine.evaluateRead({ subject, resource })
      return !allowedFields.includes('fieldA')
    }))
  })

  it('expose:["*"] exposes all resource fields (minus any redacted)', async () => {
    await fc.assert(fc.asyncProperty(
      arbSubject,
      arbResourceWithFields,
      fc.array(fc.constantFrom('fieldA', 'fieldB', 'fieldC'), { maxLength: 2 }),
      async (subject, resource, redacted) => {
        const policy: PolicyDefinition = {
          id: 'p',
          defaultEffect: 'allow',
          rules: [],
          fieldRules: [{
            id:     'rule',
            match:  () => true,
            expose: ['*'],
            redact: redacted,
          }],
        }
        const engine = createAuthEngine({ policy })
        const { allowedFields } = await engine.evaluateRead({ subject, resource })
        const resourceKeys = Object.keys(resource)
        const expectedExposed = resourceKeys.filter(k => !redacted.includes(k))
        return expectedExposed.every(f => allowedFields.includes(f))
      }
    ))
  })

  it('denied read always returns empty allowedFields', async () => {
    const policy: PolicyDefinition = {
      id: 'p',
      defaultEffect: 'allow',
      rules: [],
      fieldRules: [{ id: 'rule', match: () => true, expose: ['*'], redact: [] }],
    }
    await fc.assert(fc.asyncProperty(arbSubject, arbResourceWithFields, async (subject, resource) => {
      // Use a deny-all policy to force the read to be denied
      const denyPolicy: PolicyDefinition = { id: 'p', defaultEffect: 'deny', rules: [] }
      const engine = createAuthEngine({ policy: denyPolicy })
      const { decision, allowedFields } = await engine.evaluateRead({ subject, resource })
      return !decision.allowed ? allowedFields.length === 0 : true
    }))
  })
})
