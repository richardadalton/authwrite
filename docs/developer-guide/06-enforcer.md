# Chapter 6: Enforcement Modes

Deploying a new authorization policy is a high-stakes operation. A single misconfigured rule can lock users out of the product, and discovering that in production — after the fact — is far worse than being cautious during rollout. The engine's enforcement mode exists to solve this problem. By setting a mode on the engine, you can shadow-run a new policy against real traffic, collect honest audit data, and only promote it to active enforcement once you trust it. This chapter explains how the four modes work, why the honest/modified split matters for audit logging, and how to run a safe gradual rollout.

---

## The four modes

The `EnforcerMode` type has four values representing an escalating posture from observation through to full lockdown.

```
audit      →  Policy runs honestly. Denials are overridden to allow.
enforce    →  Normal operation. Policy decisions pass through unchanged.
suspended  →  Policy runs. Observers fire. All access denied.
lockdown   →  Engine bypassed entirely. Immediate deny.
```

**`audit`** is a shadow-run mode. The engine evaluates the policy exactly as it would in production. If the result is a denial, the engine overrides it to an allow before returning to the caller. The caller sees `decision.allowed === true`. The `decision.override` field is set to `'permissive'` so that any code inspecting the full decision object can see that an override occurred. Observers always receive the honest decision — the one the policy actually produced — before the override is applied.

**`enforce`** is the default operating mode. The engine evaluates the policy and passes the result straight to the caller. There is no override. This is how the library behaves once you are confident in your policy.

**`suspended`** is a controlled denial posture. The engine still evaluates the policy and observers still fire — you keep your full audit trail. But if the policy would have allowed the request, the result is overridden to a denial and `decision.override` is set to `'suspended'`. This is useful for incident response where you want to stop all access while preserving the record of what rules were matching. A single `engine.setMode('suspended')` call freezes access across every route that uses the same engine.

**`lockdown`** is the most severe posture. The engine skips policy evaluation entirely and returns a denial immediately. `decision.reason` is `'lockdown'` and `decision.override` is `'lockdown'`. Observers still fire — with the lockdown decision — so your audit trail records that requests arrived and were rejected. Use this when the threat is serious enough that you want to cut all processing and minimise attack surface.

---

## What callers see versus what observers see

This distinction is the most important thing to understand about enforcement modes.

```
                         ┌─────────────────────────────────────────────┐
                         │                 AuthEngine                   │
                         │                                              │
  evaluate(ctx)  ──────► │  policy eval  →  honest decision            │──► observers
                         │                       │                      │    (always honest)
                         │               ┌───────▼───────┐             │
                         │               │  applyMode()  │             │
                         │               │               │             │
                         │               │  audit:       │deny → allow │
                         │               │  enforce:     │pass through │
                         │               │  suspended:   │allow → deny │
                         │               │  lockdown:    │short-circuit│
                         │               └───────┬───────┘             │
                         └───────────────────────┼─────────────────────┘
                                                 │
                                          modified decision
                                                 │
                                               caller
```

Observers always receive the raw, unmodified result. The mode only modifies what is handed back to the caller. In `audit` mode, your audit log observer records every decision the policy would have made in production — including the denials — even though the application is not blocking anyone. You are collecting real enforcement data without real enforcement consequences.

In `suspended` mode, the same applies: observers see the honest policy decision (which may be an allow), even though the caller receives a denial with `override: 'suspended'`. Your audit trail remains intact.

In `lockdown` mode, the engine skips policy evaluation and fires observers with the lockdown decision. The lockdown decision has `reason: 'lockdown'` and `allowed: false`, so your audit log records that requests arrived and were rejected, without any policy evaluation overhead.

---

## Setting the mode

Pass `mode` in the engine config. The default is `'enforce'`.

```typescript
import { createAuthEngine } from '@authwrite/core'

// Start in audit mode during rollout
const engine = createAuthEngine({
  policy,
  mode:      'audit',
  observers: [auditLogObserver],
})
```

Switch modes at runtime without recreating the engine:

```typescript
// Promote to enforce once you're confident
engine.setMode('enforce')

// Suspend all access during an incident
engine.setMode('suspended')

// Most severe — skip policy evaluation entirely
engine.setMode('lockdown')

// Restore normal operation
engine.setMode('enforce')

// Inspect the current mode
console.log(engine.getMode())  // 'enforce'
```

Because `setMode()` mutates the engine in place, every part of your application that holds a reference to the same engine instance is affected immediately. A mode change triggered from an operations endpoint propagates to every route handler that uses the same engine without any coordination.

---

## Gradual rollout pattern

The enforcement mode is designed to support a three-phase rollout for a new or significantly changed policy.

**Phase 1 — Audit**

Deploy with `mode: 'audit'`. All users have uninterrupted access. Observer events flow to your audit log showing exactly which requests the policy would have denied. Run this for as long as you need — days if the policy is complex — until you are satisfied that the denial pattern matches your intent.

```typescript
const engine = createAuthEngine({
  policy,
  mode: 'audit',
  observers: [{
    onDecision({ decision }) {
      if (!decision.allowed) {
        // override: 'permissive' confirms this is an audit-mode shadow denial
        auditLog.write({
          rule:      decision.reason,
          override:  decision.override,
          timestamp: Date.now(),
        })
      }
    },
  }],
})
```

**Phase 2 — Enforce**

Once the audit data looks correct, switch to `enforce`. The policy now has real consequences. Keep your observer running. If an unexpected denial rate appears, you can drop back to `audit` or escalate to `suspended` or `lockdown` depending on severity.

```typescript
engine.setMode('enforce')
```

**Phase 3 — Suspended (controlled incident response)**

If you discover a serious misconfiguration — a rule that grants access it should not — switch to `suspended` to stop all access while keeping observers running. The audit trail tells you exactly what was being allowed while you investigate. Fix the policy, redeploy, and switch back to `enforce`.

```typescript
engine.setMode('suspended')
```

**Phase 4 — Lockdown (most severe)**

If the threat is serious enough that you need to cut all processing immediately — skip policy evaluation, minimise attack surface — switch to `lockdown`. Requests are rejected before the policy is touched. Observers still fire so your audit trail records the lockdown rejections.

```typescript
engine.setMode('lockdown')
```

---

## Field access across modes

The engine's mode also affects `evaluateRead`, which controls which fields are returned when reading a resource.

In **`audit` mode**, if the policy would have denied field access, the engine overrides the denial to an allow and returns the full set of fields. This keeps the application functional: if your code expects certain fields on the response, it continues to get them. The observer still records the honest decision.

In **`enforce` mode**, `evaluateRead` returns whatever the policy dictates — exposed fields are returned, redacted fields are withheld.

In **`suspended` mode**, `evaluateRead` returns an empty field set. The policy still evaluates and observers still fire, but the caller receives no fields.

In **`lockdown` mode**, `evaluateRead` also returns an empty field set, and policy evaluation is skipped.

---

Chapter 7 covers observers: what they receive, when they fire, and how to use them for audit logging, metrics, and alerting without letting side-effect code bleed into policy logic.

© 2026 Devjoy Ltd. MIT License.
