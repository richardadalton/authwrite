# Chapter 9: Testing

An untested deny rule is a silent security hole. It might never fire, or it might fire in exactly the wrong circumstances, and you will not know until a user reports it or an audit uncovers it. Authorization logic is pure enough to be highly testable — the engine takes typed inputs and returns typed outputs, with no HTTP stack or database in the way — but it has enough edge cases, particularly around rule priority, that informal testing is not sufficient. This chapter covers how to write a structured policy test suite, how to use `decisionRecorder` to capture what the engine actually decided, and how to use `coverageReport` to find rules that your tests never exercised.

---

## Testing the engine directly

The `AuthEngine` is pure TypeScript. It takes a `PolicyDefinition` and returns decisions. There is no reason to mock it, and no reason to spin up a server to test it. Construct an engine in your test file, call `evaluate()`, and assert on the result.

```typescript
import { createEngine } from '@authwrite/core'
import { describe, it, expect, beforeEach } from 'vitest'
import { documentPolicy } from './fixtures/document-policy'

interface Subject { id: string; role: string }
interface Resource { id: string; ownerId: string; status: string }

describe('document policy', () => {
  let engine: AuthEngine<Subject, Resource>

  beforeEach(() => {
    engine = createEngine({ policy: documentPolicy })
  })
})
```

A few things to notice:

- A fresh engine is created for each test via `beforeEach`. Engine instances are cheap to create and share no mutable state between evaluations, but starting fresh prevents observer state from leaking between tests.
- The policy fixture is imported from a shared file. Use the same policy definition your production code uses — tests that run against a hand-rolled test policy can give you false confidence.
- There is no async setup required. `createEngine` is synchronous.

---

## One describe per rule, one it per scenario

The clearest structure for a policy test suite is one `describe` block per rule, with individual `it` blocks for the allow scenario and the deny scenario. This maps directly to the rules in your YAML and makes it immediately obvious when a rule is untested.

```typescript
describe('owner-full-access', () => {
  it('allows the document owner to write', async () => {
    const decision = await engine.evaluate({
      subject: { id: 'user-1', role: 'member' },
      resource: { id: 'doc-1', ownerId: 'user-1', status: 'active' },
      action: 'write',
    })

    expect(decision.allowed).toBe(true)
    expect(decision.reason).toBe('owner-full-access')
  })

  it('does not apply when the subject is not the owner', async () => {
    const decision = await engine.evaluate({
      subject: { id: 'user-2', role: 'member' },
      resource: { id: 'doc-1', ownerId: 'user-1', status: 'active' },
      action: 'write',
    })

    // Falls through to defaultEffect
    expect(decision.allowed).toBe(false)
    expect(decision.reason).toBe('default')
  })
})

describe('archived-blocks-mutation', () => {
  it('denies write on an archived document even for the owner', async () => {
    const decision = await engine.evaluate({
      subject: { id: 'user-1', role: 'member' },
      resource: { id: 'doc-1', ownerId: 'user-1', status: 'archived' },
      action: 'write',
    })

    expect(decision.allowed).toBe(false)
    expect(decision.reason).toBe('archived-blocks-mutation')
  })

  it('allows read on an archived document for the owner', async () => {
    const decision = await engine.evaluate({
      subject: { id: 'user-1', role: 'member' },
      resource: { id: 'doc-1', ownerId: 'user-1', status: 'archived' },
      action: 'read',
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
      subject: { id: 'user-1', role: 'member' },
      resource: { id: 'doc-1', ownerId: 'user-1', status: 'archived' },
      action: 'delete',
    })

    expect(decision.allowed).toBe(false)
    expect(decision.reason).toBe('archived-blocks-mutation')
  })
})
```

---

## Using decisionRecorder

The `decisionRecorder` from `@authwrite/testing` is an `AuthObserver` that stores every `DecisionEvent` it receives. Attach it to the engine before running your tests and inspect the captured events afterward.

```typescript
import { decisionRecorder } from '@authwrite/testing'

describe('document policy — recorded decisions', () => {
  let engine: AuthEngine<Subject, Resource>
  let recorder: DecisionRecorder

  beforeEach(() => {
    recorder = decisionRecorder()
    engine = createEngine({ policy: documentPolicy })
    engine.addObserver(recorder)
  })

  it('captures decisions with correct metadata', async () => {
    await engine.evaluate({
      subject: { id: 'user-1', role: 'member' },
      resource: { id: 'doc-1', ownerId: 'user-1', status: 'active' },
      action: 'read',
      traceId: 'trace-abc',
    })

    const events = recorder.all()
    expect(events).toHaveLength(1)
    expect(events[0].decision.allowed).toBe(true)
    expect(events[0].traceId).toBe('trace-abc')
    expect(events[0].decision.policy).toMatch(/^documents@/)
  })
})
```

`recorder.decisions()` returns just the `Decision` objects, without the wrapping `DecisionEvent`. Use this when you only need to assert on outcomes. `recorder.clear()` resets the list between test cases if you are reusing the same engine instance.

---

## Coverage report

`coverageReport` takes an engine and a list of `DecisionEvent` objects and tells you which rules were exercised and which were not.

```typescript
import { coverageReport } from '@authwrite/testing'

describe('policy coverage', () => {
  it('every rule fires at least once across the test suite', async () => {
    const recorder = decisionRecorder()
    const engine = createEngine({ policy: documentPolicy })
    engine.addObserver(recorder)

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

## Testing the Enforcer

Test each mode explicitly. The key assertion in audit mode is that the observer receives the honest decision while the caller receives the overridden one.

```typescript
import { createEnforcer } from '@authwrite/core'

describe('Enforcer — audit mode', () => {
  it('overrides denial to allow but observer sees the denial', async () => {
    const recorder = decisionRecorder()
    const engine = createEngine({ policy: documentPolicy })
    engine.addObserver(recorder)

    const enforcer = createEnforcer(engine, { mode: 'audit' })

    // A non-owner trying to write — policy should deny
    const decision = await enforcer.evaluate({
      subject: { id: 'user-2', role: 'member' },
      resource: { id: 'doc-1', ownerId: 'user-1', status: 'active' },
      action: 'write',
    })

    // Caller sees override
    expect(decision.allowed).toBe(true)
    expect(decision.override).toBe('permissive')

    // Observer sees honest denial
    expect(recorder.decisions()[0].allowed).toBe(false)
    expect(recorder.decisions()[0].override).toBe('permissive')
  })
})

describe('Enforcer — lockdown mode', () => {
  it('denies everything regardless of policy', async () => {
    const engine = createEngine({ policy: documentPolicy })
    const enforcer = createEnforcer(engine, { mode: 'lockdown' })

    // Owner trying to read their own document — policy would allow
    const decision = await enforcer.evaluate({
      subject: { id: 'user-1', role: 'member' },
      resource: { id: 'doc-1', ownerId: 'user-1', status: 'active' },
      action: 'read',
    })

    expect(decision.allowed).toBe(false)
    expect(decision.override).toBe('lockdown')
  })
})
```

---

## Integration testing tip

Do not test your Express middleware by asserting on HTTP response shapes. Test your policy by calling the engine directly, as shown in this chapter. The middleware only wraps the engine — it does not add authorization logic. If the engine tests pass, the middleware is correct.

Test the middleware separately for its own behavior: that it calls `next()` on allow, that it returns 403 on deny, that it sets `req.authDecision`, and that resolver errors propagate to `next(err)`. Those tests belong in the adapter's own test suite, not in your policy tests. Chapter 10 covers the adapter in detail.

---

Chapter 10 covers framework adapters: how to wire the engine into Express (and other frameworks), how subject and resource resolvers work, and how to customise the deny response.

© 2026 Devjoy Ltd. MIT License.
