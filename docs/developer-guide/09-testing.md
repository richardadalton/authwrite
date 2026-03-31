# Chapter 9: Testing

An untested deny rule is a silent security hole. It might never fire, or it might fire in exactly the wrong circumstances, and you will not know until a user reports it or an audit uncovers it. Authorization logic is pure enough to be highly testable — the engine takes typed inputs and returns typed outputs, with no HTTP stack or database in the way — but it has enough edge cases, particularly around rule priority, that informal testing is not sufficient. This chapter covers how to write a structured policy test suite, how to use `decisionRecorder` to capture what the engine actually decided, and how to use `coverageReport` to find rules that your tests never exercised.

---

## Testing the engine directly

The `AuthEngine` is pure TypeScript. It takes a `PolicyDefinition` and returns decisions. There is no reason to mock it, and no reason to spin up a server to test it. Construct an engine in your test file, call `evaluate()`, and assert on the result.

```typescript
import { createAuthEngine } from '@daltonr/authwrite-core'
import { describe, it, expect } from 'vitest'
import { documentPolicy } from './fixtures/document-policy'

interface Subject { id: string; roles: string[] }
interface Resource { id: string; ownerId: string; status: string }

describe('document policy', () => {
  const engine = createAuthEngine({ policy: documentPolicy })

  // tests go here
})
```

A few things to notice:

- A single engine can be shared across tests in a `describe` block because engines have no mutable per-evaluation state. If you attach observers (see below), create a fresh recorder per test.
- The policy fixture is imported from a shared file. Use the same policy definition your production code uses — tests that run against a hand-rolled test policy can give you false confidence.
- `createAuthEngine` is synchronous when given a static policy.

---

## One describe per rule, one it per scenario

The clearest structure for a policy test suite is one `describe` block per rule, with individual `it` blocks for the allow scenario and the deny scenario. This maps directly to the rules in your policy and makes it immediately obvious when a rule is untested.

```typescript
describe('owner-full-access', () => {
  it('allows the document owner to write', async () => {
    const decision = await engine.evaluate({
      subject:  { id: 'user-1', roles: ['member'] },
      resource: { id: 'doc-1', ownerId: 'user-1', status: 'active' },
      action:   'write',
    })

    expect(decision.allowed).toBe(true)
    expect(decision.reason).toBe('owner-full-access')
  })

  it('does not apply when the subject is not the owner', async () => {
    const decision = await engine.evaluate({
      subject:  { id: 'user-2', roles: ['member'] },
      resource: { id: 'doc-1', ownerId: 'user-1', status: 'active' },
      action:   'write',
    })

    // Falls through to defaultEffect
    expect(decision.allowed).toBe(false)
    expect(decision.reason).toBe('default')
  })
})

describe('archived-blocks-mutation', () => {
  it('denies write on an archived document even for the owner', async () => {
    const decision = await engine.evaluate({
      subject:  { id: 'user-1', roles: ['member'] },
      resource: { id: 'doc-1', ownerId: 'user-1', status: 'archived' },
      action:   'write',
    })

    expect(decision.allowed).toBe(false)
    expect(decision.reason).toBe('archived-blocks-mutation')
  })

  it('allows read on an archived document for the owner', async () => {
    const decision = await engine.evaluate({
      subject:  { id: 'user-1', roles: ['member'] },
      resource: { id: 'doc-1', ownerId: 'user-1', status: 'archived' },
      action:   'read',
    })

    expect(decision.allowed).toBe(true)
    expect(decision.reason).toBe('owner-full-access')
  })
})
```

A few things to notice:

- Each `it` block asserts on both `decision.allowed` and `decision.reason`. Asserting only on `allowed` hides which rule fired, which matters when you have overlapping rules.
- The "does not apply" test confirms that the fallback behaviour is what you expect — either `defaultEffect` applies (reason: `'default'`) or another rule fires. Both outcomes are worth asserting.
- The second archived test demonstrates that a high-priority deny rule and a matching allow rule coexist correctly: the deny rule blocks mutation but not reads.

---

## Testing priority

Rule priority is the most common source of policy bugs. When two rules match the same context, the one with the higher priority wins. Test this explicitly.

```typescript
describe('priority: archived-blocks-mutation overrides owner-full-access', () => {
  it('deny wins when priority is higher than the allow rule', async () => {
    // archived-blocks-mutation has priority: 5
    // owner-full-access has no explicit priority (lower)
    const decision = await engine.evaluate({
      subject:  { id: 'user-1', roles: ['member'] },
      resource: { id: 'doc-1', ownerId: 'user-1', status: 'archived' },
      action:   'delete',
    })

    expect(decision.allowed).toBe(false)
    expect(decision.reason).toBe('archived-blocks-mutation')
  })
})
```

---

## Using decisionRecorder

The `decisionRecorder` from `@daltonr/authwrite-testing` is an `AuthObserver` that stores every `DecisionEvent` it receives. Pass it in the engine config and inspect the captured events afterward.

```typescript
import { createAuthEngine } from '@daltonr/authwrite-core'
import { decisionRecorder } from '@daltonr/authwrite-testing'

describe('document policy — recorded decisions', () => {
  it('captures decisions with correct metadata', async () => {
    const recorder = decisionRecorder()
    const engine   = createAuthEngine({ policy: documentPolicy, observers: [recorder] })

    await engine.evaluate({
      subject:  { id: 'user-1', roles: ['member'] },
      resource: { id: 'doc-1', ownerId: 'user-1', status: 'active' },
      action:   'read',
    })

    const events = recorder.all()
    expect(events).toHaveLength(1)
    expect(events[0].decision.allowed).toBe(true)
    expect(events[0].decision.policy).toMatch(/^documents@/)
  })
})
```

`recorder.decisions()` returns just the `Decision` objects, without the wrapping `DecisionEvent`. Use this when you only need to assert on outcomes. `recorder.clear()` resets the list between test cases if you are reusing the same recorder.

---

## Coverage report

`coverageReport` takes an engine and a list of `DecisionEvent` objects and tells you which rules were exercised and which were not.

```typescript
import { coverageReport } from '@daltonr/authwrite-testing'

describe('policy coverage', () => {
  it('every rule fires at least once across the test suite', async () => {
    const recorder = decisionRecorder()
    const engine   = createAuthEngine({ policy: documentPolicy, observers: [recorder] })

    // Run the full set of test scenarios
    await runAllScenarios(engine)

    const report = coverageReport(engine, recorder.all())

    expect(report.untouchedRules).toEqual([])
    expect(report.coveragePercent).toBe(100)
  })
})
```

A few things to notice:

- `coverageReport` does not run tests — it analyses a list of events you have already collected. Feed it the recorder's events from a test run that exercises every scenario.
- `report.untouchedRules` is an array of rule IDs that appear in the policy but produced no decisions. An empty array means full coverage.
- `report.coveragePercent` is `(coveredRules.length / totalRules) * 100`.
- `coverageReport` requires a static `PolicyDefinition`. If the engine uses a dynamic resolver, call `getPolicy()` after at least one evaluation to confirm the policy has been cached.

---

## Using coverageReport as a CI gate

A coverage threshold in CI ensures that new rules do not go unexercised.

```typescript
it('policy coverage is at least 90%', async () => {
  // ... setup and run scenarios ...
  const report = coverageReport(engine, recorder.all())

  if (report.coveragePercent < 90) {
    throw new Error(
      `Policy coverage ${report.coveragePercent}% is below threshold.\n` +
      `Untouched rules: ${report.untouchedRules.join(', ')}`
    )
  }
})
```

The error message names the specific untouched rules, which makes it actionable. A developer adding a new rule must also add a test that causes it to fire before the CI gate passes.

---

## Testing enforcement modes

Test each mode explicitly against the engine. The key assertion in `audit` mode is that the observer receives the honest decision while the caller receives the overridden one.

```typescript
describe('audit mode', () => {
  it('overrides denial to allow but observer sees the denial', async () => {
    const recorder = decisionRecorder()
    const engine   = createAuthEngine({ policy: documentPolicy, mode: 'audit', observers: [recorder] })

    // A non-owner trying to write — policy should deny
    const decision = await engine.evaluate({
      subject:  { id: 'user-2', roles: ['member'] },
      resource: { id: 'doc-1', ownerId: 'user-1', status: 'active' },
      action:   'write',
    })

    // Caller sees the overridden allow
    expect(decision.allowed).toBe(true)
    expect(decision.override).toBe('permissive')

    // Observer sees the honest denial
    expect(recorder.decisions()[0].allowed).toBe(false)
    expect(recorder.decisions()[0].override).toBe('permissive')
  })
})

describe('suspended mode', () => {
  it('denies everything but policy still evaluates', async () => {
    const engine = createAuthEngine({ policy: documentPolicy, mode: 'suspended' })

    // Owner trying to read their own document — policy would allow
    const decision = await engine.evaluate({
      subject:  { id: 'user-1', roles: ['member'] },
      resource: { id: 'doc-1', ownerId: 'user-1', status: 'active' },
      action:   'read',
    })

    expect(decision.allowed).toBe(false)
    expect(decision.override).toBe('suspended')
  })
})

describe('lockdown mode', () => {
  it('denies immediately and fires observers with the lockdown decision', async () => {
    const recorder = decisionRecorder()
    const engine   = createAuthEngine({ policy: documentPolicy, mode: 'lockdown', observers: [recorder] })

    const decision = await engine.evaluate({
      subject:  { id: 'user-1', roles: ['member'] },
      resource: { id: 'doc-1', ownerId: 'user-1', status: 'active' },
      action:   'read',
    })

    expect(decision.allowed).toBe(false)
    expect(decision.override).toBe('lockdown')
    expect(decision.reason).toBe('lockdown')

    // Observers still fire in lockdown — the audit trail records the rejection
    expect(recorder.decisions()).toHaveLength(1)
    expect(recorder.decisions()[0].reason).toBe('lockdown')
  })
})
```

---

## Testing dry-run with evaluatePolicy

Use `evaluatePolicy` from `@daltonr/authwrite-core` to test individual rules in complete isolation — no engine, no observers, no mode. This is useful for unit-testing a single rule's `match` logic.

```typescript
import { evaluatePolicy } from '@daltonr/authwrite-core'

describe('archived-blocks-mutation rule', () => {
  const policy = {
    id:            'test',
    defaultEffect: 'deny' as const,
    rules: [{
      id:       'archived-blocks-mutation',
      priority: 5,
      match:    ({ resource }) => resource?.status === 'archived',
      deny:     ['write', 'delete'],
    }],
  }

  it('fires for archived documents', () => {
    const d = evaluatePolicy(policy, {
      subject:  { id: 'u1', roles: [] },
      resource: { type: 'document', id: 'doc-1', status: 'archived' },
      action:   'write',
    })
    expect(d.allowed).toBe(false)
    expect(d.reason).toBe('archived-blocks-mutation')
  })

  it('does not fire for active documents', () => {
    const d = evaluatePolicy(policy, {
      subject:  { id: 'u1', roles: [] },
      resource: { type: 'document', id: 'doc-1', status: 'active' },
      action:   'write',
    })
    expect(d.defaulted).toBe(true)
  })
})
```

`evaluatePolicy` throws if a rule function throws — there is no error swallowing. This makes rule bugs immediately visible in tests.

---

## Integration testing tip

Do not test your Express middleware by asserting on HTTP response shapes. Test your policy by calling the engine directly, as shown in this chapter. The middleware only wraps the engine — it does not add authorization logic. If the engine tests pass, the middleware is correct.

Test the middleware separately for its own behaviour: that it calls `next()` on allow, that it returns 403 on deny, that it sets `req.authDecision`, and that resolver errors propagate to `next(err)`. Those tests belong in the adapter's own test suite, not in your policy tests. Chapter 10 covers the adapter in detail.

---

Chapter 10 covers framework adapters: how to wire the engine into Express (and other frameworks), how subject and resource resolvers work, and how to customise the deny response.

© 2026 Devjoy Ltd. MIT License.
