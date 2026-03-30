# Chapter 4: Priority and Conflict Resolution

In any real-world policy, two rules will eventually both match a given request and disagree about the outcome. An admin override allows everything; a compliance rule denies exports during an audit window. An owner has full access; an archived flag blocks mutations. These are not bugs — they are intentional competing concerns, and your authorization system needs a deterministic way to resolve them. This chapter explains how Authwrite resolves conflicts, what priority means in practice, and how to model common override scenarios correctly.

---

## The conflict problem

Consider a policy with these two rules:

```typescript
{
  id: 'owner-full-access',
  priority: 10,
  match: (ctx) => ctx.resource?.ownerId === ctx.subject.id,
  allow: ['update', 'delete'],
},
{
  id: 'archived-block-mutation',
  priority: 50,
  match: (ctx) => ctx.resource?.attributes?.archived === true,
  deny: ['update', 'delete'],
},
```

An owner tries to update their own archived document. Both rules match. `owner-full-access` allows `update`. `archived-block-mutation` denies `update`. Without a resolution algorithm, the outcome is undefined. Authwrite's algorithm makes it deterministic.

---

## The resolution algorithm

The engine resolves conflicts in five steps:

```
1. Evaluate every rule's match() (and condition() if match passes).
2. From the matching rules, collect all that apply to the requested action:
     - rules with allow containing the action (or '*') → allowCandidates
     - rules with deny containing the action (or '*')  → denyCandidates
3. From each list, select the rule with the highest priority.
4. If neither list has a candidate: apply defaultEffect.
5. Compare the winning deny priority against the winning allow priority.
     - If deny priority >= allow priority: deny.
     - If allow priority > deny priority: allow.
```

The critical rule is step 5: **deny beats allow at equal priority.** If your best deny rule and your best allow rule have the same priority, the request is denied.

---

## Priority examples

Given these rules:

| Rule id | Priority | Effect | Action |
|---|---|---|---|
| `owner-full-access` | 10 | allow | update |
| `archived-block-mutation` | 50 | deny | update |
| `admin-override` | 100 | allow | update |
| `audit-freeze` | 100 | deny | update |

Scenario outcomes for the `update` action:

| Subject | Resource state | Matching rules | Winning allow | Winning deny | Result |
|---|---|---|---|---|---|
| Owner | Not archived | `owner-full-access` (allow 10) | priority 10 | none | **allow** |
| Owner | Archived | `owner-full-access` (allow 10), `archived-block-mutation` (deny 50) | priority 10 | priority 50 | **deny** (50 > 10) |
| Admin | Not archived | `owner-full-access` (allow 10), `admin-override` (allow 100) | priority 100 | none | **allow** |
| Admin | During audit | `admin-override` (allow 100), `audit-freeze` (deny 100) | priority 100 | priority 100 | **deny** (100 >= 100) |
| Stranger | Not archived | none | none | none | **deny** (defaultEffect) |

The last row — the stranger — shows `defaulted: true` in the decision with `reason: 'default'`. Every other row has `reason` set to the rule id of the deciding rule.

---

## Why deny beats allow at equal priority

This is the most important invariant in the system.

When a policy author writes two rules at the same priority level — one allowing, one denying — they have not expressed a clear preference. The system must pick a side. It picks deny.

This is consistent with the `defaultEffect: 'deny'` philosophy: when the policy is ambiguous, fail closed. A security incident caused by an accidental allow is harder to detect and usually more damaging than one caused by an accidental deny. Accidental denials surface quickly through user complaints. Accidental allows may not surface at all.

If you want an allow to win over a deny, give the allow rule a higher priority. That is an explicit, auditable decision.

---

## `condition` does not participate in the priority race

The **condition** field is a secondary predicate — it is not a priority modifier. A rule with a failing `condition` is excluded from the candidate list entirely, as if it never matched. It does not compete at a reduced priority; it simply does not exist for this evaluation.

```typescript
{
  id: 'editor-update',
  priority: 20,
  match: (ctx) => ctx.subject.roles.includes('editor'),
  allow: ['update'],
  condition: (ctx) => ctx.resource?.attributes?.locked !== true,
}
```

If the resource is locked, `condition` fails. This rule contributes nothing to the allow candidates. There is no "partial" match at a lower priority — the rule is absent.

Use `condition` for runtime state checks where the rule is conceptually relevant (the subject is an editor) but the current data makes it inapplicable (the resource is locked). Do not use `condition` as a way to modulate priority. If you need different priority under different conditions, write separate rules.

---

## Modelling an emergency freeze rule

A common enterprise requirement: a compliance or security team needs to be able to instantly block all write operations across the entire system, overriding everything else, until they lift the freeze. Priority makes this clean.

```typescript
import { createAuthEngine } from '@authwrite/core'
import type { PolicyDefinition } from '@authwrite/core'

// This flag would be read from a feature flag service, config store, or environment variable
let emergencyFreezeActive = false

const policy: PolicyDefinition = {
  id: 'app-policy',
  version: '1',
  defaultEffect: 'deny',
  rules: [
    {
      id: 'emergency-freeze',
      description: 'Blocks all write operations when the emergency freeze is active',
      priority: 1000,
      match: (ctx) => emergencyFreezeActive,
      deny: ['create', 'update', 'delete', 'publish', 'archive'],
    },
    {
      id: 'admin-override',
      priority: 100,
      match: (ctx) => ctx.subject.roles.includes('admin'),
      allow: ['*'],
    },
    {
      id: 'owner-writes',
      priority: 10,
      match: (ctx) => ctx.resource?.ownerId === ctx.subject.id,
      allow: ['update', 'delete'],
    },
  ],
}
```

A few things to notice:

- `emergency-freeze` sits at priority `1000`. No other rule in the system can override it while it is active, because deny at 1000 beats any allow at <= 1000.
- `admin-override` at `100` normally wins over everything below it. But it cannot overcome the freeze — `1000 >= 100`.
- The freeze rule is unconditional in its `match`. It checks a single boolean and applies to every write action. It is easy to audit and easy to toggle.
- To unblock specific admins during a freeze, you would write a new deny rule at priority `1001` that explicitly denies everyone except a named list — or you would lift the freeze. Do not try to "punch through" a freeze with an allow at priority `1001`, because deny beats allow at equal priority and you would need `1001` to be strictly greater than `1000` to win. Design your priority bands with room to spare.

---

## Priority band conventions

For systems with more than a handful of rules, establishing priority bands keeps the policy readable:

| Band | Priority range | Purpose |
|---|---|---|
| Emergency overrides | 900–1000 | Freeze, lockdown, incident response |
| Compliance rules | 500–899 | Regulatory, audit, legal requirements |
| Admin overrides | 100–499 | Privileged role bypasses |
| Business rules | 10–99 | Core ownership, role-based access |
| Default rules | 1–9 | Broad, low-specificity grants |
| Unset | 0 | Rules with no explicit priority |

This is a convention, not a framework feature. Adopt it or adapt it to your system. Document it in a comment at the top of your policy file.

---

## Testing priority: using the Decision object

The `Decision` object makes priority behaviour directly observable in tests. You do not need a special debugging mode — evaluate a request and inspect `reason`, `rule`, and `allowed`.

```typescript
import { describe, it, expect } from 'vitest'
import { createAuthEngine } from '@authwrite/core'
import { documentPolicy } from '../src/policies/document-policy'

const engine = createAuthEngine({ policy: documentPolicy })

describe('archived-block-mutation', () => {
  it('denies owner update on archived document', async () => {
    const decision = await engine.evaluate({
      subject: { id: 'user-1', roles: ['member'] },
      resource: {
        type: 'document',
        id: 'doc-1',
        ownerId: 'user-1',
        attributes: { archived: true },
      },
      action: 'update',
    })

    expect(decision.allowed).toBe(false)
    expect(decision.reason).toBe('archived-block-mutation')
    expect(decision.rule?.priority).toBe(50)
  })

  it('allows admin update on archived document', async () => {
    const decision = await engine.evaluate({
      subject: { id: 'admin-1', roles: ['admin'] },
      resource: {
        type: 'document',
        id: 'doc-1',
        ownerId: 'user-1',
        attributes: { archived: true },
      },
      action: 'update',
    })

    expect(decision.allowed).toBe(true)
    expect(decision.reason).toBe('admin-override')
  })
})
```

A few things to notice:

- The test asserts on `reason` and `rule.priority`, not just `allowed`. This locks in the priority contract: if someone later adds a rule that changes which rule wins, the test fails and the change is visible.
- No mocks required. The engine is deterministic and synchronous under the hood. Constructing a context object and calling `evaluate()` is all you need.
- Testing the `defaulted` path is equally straightforward: use a subject with no matching roles and an empty resource, and assert `decision.defaulted === true` and `decision.reason === 'default'`.

---

Chapter 5 covers field-level filtering — how to allow a read but still hide sensitive fields from certain users, how `FieldRule` and `evaluateRead()` work together, and the `applyFieldFilter()` utility for stripping resource objects down to what a subject is permitted to see.

© 2026 Devjoy Ltd. MIT License.
