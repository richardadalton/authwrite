# Testing API Reference

This reference covers `@authwrite/testing` — utilities for asserting authorization behaviour and measuring policy coverage in test suites.

---

## `decisionRecorder()`

```typescript
export function decisionRecorder(): DecisionRecorder
```

Creates a `DecisionRecorder` that implements `AuthObserver`. Pass it in the `observers` array when constructing an `AuthEngine` to capture every decision emitted during a test run.

### `DecisionRecorder`

```typescript
export interface DecisionRecorder extends AuthObserver {
  all(): DecisionEvent[]
  decisions(): Decision[]
  clear(): void
}
```

### Methods

| Method | Signature | Description |
|---|---|---|
| `all` | `() => DecisionEvent[]` | Returns all recorded `DecisionEvent` objects in the order they were received. |
| `decisions` | `() => Decision[]` | Returns the `Decision` from each recorded event, in order. Shorthand for `all().map(e => e.decision)`. |
| `clear` | `() => void` | Removes all recorded events. Call between test cases to prevent state leaking across assertions. |

`DecisionRecorder` also satisfies the `AuthObserver` interface. The `onDecision` method is implemented internally; `onError` and `onPolicyReload` are no-ops.

---

## `coverageReport(engine, events)`

```typescript
export function coverageReport<S extends Subject, R extends Resource>(
  engine: AuthEngine<S, R>,
  events: DecisionEvent[]
): CoverageReport
```

Computes which policy rules were exercised by the provided events.

### Parameters

| Parameter | Type | Description |
|---|---|---|
| `engine` | `AuthEngine<S, R>` | The engine whose active policy is inspected. Rule IDs are read via `engine.getPolicy()`. |
| `events` | `DecisionEvent[]` | The recorded events to analyse. Typically the output of `recorder.all()`. |

### `CoverageReport`

```typescript
export interface CoverageReport {
  totalRules: number
  coveredRules: string[]
  untouchedRules: string[]
  coveragePercent: number
}
```

### Properties

| Property | Type | Description |
|---|---|---|
| `totalRules` | `number` | Total number of rules in the active policy. |
| `coveredRules` | `string[]` | IDs of rules that appear as `decision.reason` in at least one event. |
| `untouchedRules` | `string[]` | IDs of rules that do not appear in any event's `decision.reason`. |
| `coveragePercent` | `number` | Percentage of rules covered, from `0` to `100`. Returns `100` when the policy has no rules. |

Coverage is determined by matching rule `id` values against `event.decision.reason` strings. Decisions caused by the policy's `defaultEffect` (where `decision.defaulted` is `true`) do not count toward any rule's coverage.

---

## Usage pattern

Use `decisionRecorder` and `coverageReport` together to assert behaviour and track policy coverage across your test suite.

```typescript
import { createAuthEngine } from '@authwrite/core'
import { decisionRecorder, coverageReport } from '@authwrite/testing'
import { myPolicy } from './policies/my-policy'

const recorder = decisionRecorder()

const engine = createAuthEngine({
  policy: myPolicy,
  observers: [recorder],
})

// --- run your tests ---

// Assert individual decisions
const decision = await engine.evaluate({
  subject: { id: 'user-1', roles: ['editor'] },
  resource: { type: 'document', id: 'doc-42' },
  action: 'update',
})
assert.equal(decision.allowed, true)

// Assert coverage at the end of the suite
const report = coverageReport(engine, recorder.all())
assert.equal(report.untouchedRules.length, 0, `Untested rules: ${report.untouchedRules.join(', ')}`)

// Reset between test cases
recorder.clear()
```

### Typical test lifecycle

| Step | Call | Purpose |
|---|---|---|
| Before suite | `createAuthEngine({ observers: [recorder] })` | Register the recorder once. |
| After each test | `recorder.clear()` | Prevent decisions from one test affecting assertions in another. |
| After suite | `coverageReport(engine, recorder.all())` | Verify every rule was exercised at least once. |

---

© 2026 Devjoy Ltd. MIT License.
