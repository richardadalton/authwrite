import { describe, it, expect } from 'vitest'
import { fromRule }            from '@daltonr/authwrite-rulewrite'
import { evaluatePolicy }      from '@daltonr/authwrite-core'
import type {
  AuthContext,
  PolicyDefinition,
  Subject,
  Resource,
} from '@daltonr/authwrite-core'
import type { EvaluatableRule } from '@daltonr/authwrite-rulewrite'

// ─── Helpers ─────────────────────────────────────────────────────────────────

interface User extends Subject {
  id:    string
  roles: string[]
}

interface Doc extends Resource {
  type:    'doc'
  ownerId: string
}

function makeRule(
  satisfied: boolean,
  label = 'TestRule',
  children?: Array<{ satisfied: boolean; label: string }>,
): EvaluatableRule<AuthContext<User, Doc>> {
  return {
    isSatisfiedBy: () => satisfied,
    evaluate:      () => ({ satisfied, label, children }),
  }
}

const alice: User   = { id: 'alice', roles: ['editor'] }
const bob:   User   = { id: 'bob',   roles: [] }
const doc:   Doc    = { type: 'doc', ownerId: 'alice' }

function ctx(subject: User, resource = doc): AuthContext<User, Doc> {
  return { subject, resource, action: 'read' }
}

// ─── fromRule ─────────────────────────────────────────────────────────────────

describe('fromRule()', () => {
  it('returns a match function that delegates to isSatisfiedBy', () => {
    const { match } = fromRule(makeRule(true))
    expect(match(ctx(alice))).toBe(true)
    expect(match(ctx(bob))).toBe(true) // always true in this mock
  })

  it('returns a match function that returns false when isSatisfiedBy returns false', () => {
    const { match } = fromRule(makeRule(false))
    expect(match(ctx(alice))).toBe(false)
  })

  it('returns an explain function that delegates to evaluate()', () => {
    const result   = { satisfied: true, label: 'IsOwner' }
    const rule     = { isSatisfiedBy: () => true, evaluate: () => result }
    const { explain } = fromRule(rule)
    expect(explain(ctx(alice))).toBe(result)
  })

  it('passes the full AuthContext to isSatisfiedBy', () => {
    const received: AuthContext<User, Doc>[] = []
    const rule: EvaluatableRule<AuthContext<User, Doc>> = {
      isSatisfiedBy: (c) => { received.push(c); return true },
      evaluate:      (c) => ({ satisfied: true, label: 'Spy' }),
    }
    const { match } = fromRule(rule)
    const c = ctx(alice)
    match(c)
    expect(received[0]).toBe(c)
  })

  it('passes the full AuthContext to evaluate', () => {
    const received: AuthContext<User, Doc>[] = []
    const rule: EvaluatableRule<AuthContext<User, Doc>> = {
      isSatisfiedBy: () => true,
      evaluate:      (c) => { received.push(c); return { satisfied: true, label: 'Spy' } },
    }
    const { explain } = fromRule(rule)
    const c = ctx(alice)
    explain(c)
    expect(received[0]).toBe(c)
  })

  it('can be used with a real AuthContext-aware predicate', () => {
    const isOwner: EvaluatableRule<AuthContext<User, Doc>> = {
      isSatisfiedBy: (c) => c.subject.id === (c.resource as Doc).ownerId,
      evaluate:      (c) => ({
        satisfied: c.subject.id === (c.resource as Doc).ownerId,
        label:     'IsOwner',
      }),
    }
    const { match, explain } = fromRule(isOwner)
    expect(match(ctx(alice))).toBe(true)
    expect(match(ctx(bob))).toBe(false)

    const result = explain(ctx(alice)) as { satisfied: boolean; label: string }
    expect(result.satisfied).toBe(true)
    expect(result.label).toBe('IsOwner')
  })
})

// ─── Integration with evaluatePolicy ─────────────────────────────────────────

describe('fromRule() + evaluatePolicy()', () => {
  function makePolicy(
    satisfied: boolean,
    label = 'Rule',
    children?: Array<{ satisfied: boolean; label: string }>,
  ): PolicyDefinition<User, Doc> {
    return {
      id:            'test-policy',
      defaultEffect: 'deny',
      rules: [
        {
          id:    'test-rule',
          ...fromRule(makeRule(satisfied, label, children)),
          allow: ['read'],
        },
      ],
    }
  }

  it('attaches matchExplanation when the deciding rule has explain', () => {
    const policy   = makePolicy(true, 'AllowRead')
    const decision = evaluatePolicy(policy, ctx(alice))

    expect(decision.allowed).toBe(true)
    expect(decision.matchExplanation).toEqual({ satisfied: true, label: 'AllowRead', children: undefined })
  })

  it('matchExplanation reflects the rule that decided the outcome', () => {
    const children = [
      { satisfied: true,  label: 'IsOwner' },
      { satisfied: false, label: 'IsAdmin' },
    ]
    const policy   = makePolicy(true, 'OR', children)
    const decision = evaluatePolicy(policy, ctx(alice))

    const explanation = decision.matchExplanation as {
      satisfied: boolean
      label:     string
      children:  Array<{ satisfied: boolean; label: string }>
    }
    expect(explanation.label).toBe('OR')
    expect(explanation.children).toHaveLength(2)
    expect(explanation.children[0]?.label).toBe('IsOwner')
  })

  it('matchExplanation is undefined when no rule matched (defaulted)', () => {
    const policy   = makePolicy(false)
    const decision = evaluatePolicy(policy, ctx(alice))

    expect(decision.defaulted).toBe(true)
    expect(decision.matchExplanation).toBeUndefined()
  })

  it('matchExplanation is undefined when rule has no explain function', () => {
    const policy: PolicyDefinition<User, Doc> = {
      id:            'bare-policy',
      defaultEffect: 'deny',
      rules: [
        {
          id:    'bare-rule',
          match: (c) => c.subject.roles.includes('editor'),
          allow: ['read'],
        },
      ],
    }
    const decision = evaluatePolicy(policy, ctx(alice))
    expect(decision.allowed).toBe(true)
    expect(decision.matchExplanation).toBeUndefined()
  })

  it('uses isSatisfiedBy (not evaluate) for the match check', () => {
    let matchCalls   = 0
    let explainCalls = 0
    const rule: EvaluatableRule<AuthContext<User, Doc>> = {
      isSatisfiedBy: () => { matchCalls++;   return true },
      evaluate:      () => { explainCalls++; return { satisfied: true, label: 'X' } },
    }
    const policy: PolicyDefinition<User, Doc> = {
      id:            'call-count-policy',
      defaultEffect: 'deny',
      rules: [{ id: 'r', ...fromRule(rule), allow: ['read'] }],
    }
    evaluatePolicy(policy, ctx(alice))
    expect(matchCalls).toBe(1)
    expect(explainCalls).toBe(1)
  })

  it('deny rule explanation is captured when deny beats allow', () => {
    const denyChildren = [{ satisfied: true, label: 'IsBanned' }]
    const denyRule: EvaluatableRule<AuthContext<User, Doc>> = {
      isSatisfiedBy: () => true,
      evaluate:      () => ({ satisfied: true, label: 'BanCheck', children: denyChildren }),
    }
    const allowRule: EvaluatableRule<AuthContext<User, Doc>> = {
      isSatisfiedBy: () => true,
      evaluate:      () => ({ satisfied: true, label: 'OwnerAllow' }),
    }
    const policy: PolicyDefinition<User, Doc> = {
      id:            'deny-wins-policy',
      defaultEffect: 'deny',
      rules: [
        { id: 'ban',   ...fromRule(denyRule),  deny:  ['read'], priority: 10 },
        { id: 'allow', ...fromRule(allowRule), allow: ['read'], priority: 5  },
      ],
    }
    const decision = evaluatePolicy(policy, ctx(alice))
    expect(decision.allowed).toBe(false)
    const explanation = decision.matchExplanation as { label: string }
    expect(explanation.label).toBe('BanCheck')
  })
})
