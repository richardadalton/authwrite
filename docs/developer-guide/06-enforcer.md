# Chapter 6: The Enforcer

Deploying a new authorization policy is a high-stakes operation. A single misconfigured rule can lock users out of the product, and discovering that in production — after the fact — is far worse than being cautious during rollout. The Enforcer exists to solve this problem. It wraps an `AuthEngine` and intercepts what callers see, without touching what observers see. That separation is the whole point: you can shadow-run a new policy against real traffic, collect honest audit data, and only promote it to active enforcement once you trust it. This chapter explains how the Enforcer's three modes work, why the honest/modified split matters for audit logging, and how to run a safe gradual rollout.

---

## The three modes

The `EnforcerMode` type has three values, each representing a distinct operating posture.

```
enforce   →  Normal operation. Policy decisions pass through unchanged.
audit     →  Policy runs honestly. Denials are overridden to allow.
lockdown  →  All access denied. Policy result is ignored.
```

**`enforce`** is the default operating mode. The engine evaluates the policy, the Enforcer passes the result straight to the caller. There is no override. This is how the library behaves once you are confident in your policy.

**`audit`** is a shadow-run mode. The engine evaluates the policy exactly as it would in production. If the result is a denial, the Enforcer overrides it to an allow before returning to the caller. The caller sees `decision.allowed === true`. The `decision.override` field is set to `'permissive'` so that any code inspecting the full decision object can see that an override occurred. Observers attached to the underlying engine always receive the honest decision — the one the policy actually produced — before the Enforcer has modified anything.

**`lockdown`** is an emergency posture. Every access request is denied regardless of what the policy says. If the policy would have allowed the request, the Enforcer overrides the result to a denial and sets `decision.override` to `'lockdown'`. This is intended for incident response: a single `setMode('lockdown')` call shuts access down across every route that uses the same Enforcer, without touching configuration files or requiring a redeploy.

---

## What callers see versus what observers see

This distinction is the most important thing to understand about the Enforcer.

```
                         ┌─────────────────────────────────────────┐
                         │             AuthEngine                   │
                         │                                          │
  evaluate(ctx)  ──────► │  policy eval  →  honest decision        │──► observers
                         │                       │                  │    (always honest)
                         └───────────────────────┼─────────────────┘
                                                 │
                                          ┌──────▼──────┐
                                          │   Enforcer   │
                                          │              │
                                          │  applyMode() │
                                          │  ┌─────────┐ │
                                          │  │ audit   │ │  deny  → allow
                                          │  │lockdown │ │  allow → deny
                                          │  │enforce  │ │  pass through
                                          │  └─────────┘ │
                                          └──────┬──────┘
                                                 │
                                          modified decision
                                                 │
                                               caller
```

The engine fires its observers with the raw, unmodified result. The Enforcer only modifies what it hands back to the caller. This means that in `audit` mode, your audit log observer will record every decision the policy would have made in production — including the denials — even though the application is not blocking anyone. You are collecting real enforcement data without real enforcement consequences.

If you attached observers to the Enforcer rather than the engine, you would only see the modified decisions and your audit data would be useless. Attach observers to the engine, not the Enforcer.

---

## Creating an Enforcer

`createEnforcer` takes an existing `AuthEngine` and a configuration object with the initial mode.

```typescript
import { createEngine } from '@authwrite/core'
import { createEnforcer } from '@authwrite/core'

const engine = createEngine({ policy })

// Start in audit mode during rollout
const enforcer = createEnforcer(engine, { mode: 'audit' })

// Pass the enforcer wherever an AuthEvaluator is accepted
const decision = await enforcer.evaluate(ctx)
```

A few things to notice:

- `createEnforcer` accepts an `AuthEngine`, not another Enforcer. There is no stacking.
- The returned `Enforcer` implements `AuthEvaluator`, which means it is drop-in compatible with every place that accepts an engine — including the Express middleware from Chapter 10.
- The `mode` property is readable at any time: `enforcer.mode` returns the current mode.

---

## Switching modes at runtime

`setMode()` changes the Enforcer's operating posture without creating a new instance or touching the engine underneath.

```typescript
// During rollout: switch to enforce once you're confident
enforcer.setMode('enforce')

// During an incident: immediate lockdown
enforcer.setMode('lockdown')

// Restore normal operation
enforcer.setMode('enforce')
```

Because `setMode()` mutates the Enforcer in place, every part of your application that holds a reference to the same Enforcer instance is affected immediately. This is intentional. A lockdown triggered from an operations endpoint propagates to every route handler that uses the same Enforcer without requiring any coordination.

---

## Gradual rollout pattern

The Enforcer is designed to support a three-phase rollout for a new or significantly changed policy.

**Phase 1 — Audit**

Deploy with `mode: 'audit'`. All users have uninterrupted access. Observer events flow to your audit log showing exactly which requests the policy would have denied. Run this for as long as you need — days if the policy is complex — until you are satisfied that the denial pattern matches your intent.

```typescript
const enforcer = createEnforcer(engine, { mode: 'audit' })

// Attach an observer to the engine to capture honest decisions
engine.addObserver({
  onDecision({ decision }) {
    if (!decision.allowed) {
      auditLog.write({
        rule: decision.reason,
        override: decision.override,  // 'permissive' in audit mode
        timestamp: Date.now(),
      })
    }
  },
})
```

**Phase 2 — Enforce**

Once the audit data looks correct, switch to `enforce`. The policy now has real consequences. Keep your observer running. If an unexpected denial rate appears, you can switch back to `audit` or to `lockdown` depending on the severity.

```typescript
enforcer.setMode('enforce')
```

**Phase 3 — Lockdown (emergency only)**

If you discover a serious misconfiguration — a rule that grants access it should not — switch to `lockdown` immediately to stop the bleeding. Then fix the policy, redeploy, and switch back to `enforce`.

```typescript
enforcer.setMode('lockdown')
```

---

## Field access in audit and lockdown modes

The Enforcer's mode also affects `evaluateRead`, which controls which fields are returned when reading a resource.

In **`audit` mode**, if the policy would have denied field access, the Enforcer overrides the denial to an allow and returns the full set of fields. This keeps the application functional: if your code expects certain fields on the response, it will continue to get them. The observer still records the honest decision.

In **`lockdown` mode**, `evaluateRead` returns an empty field set. There is nothing to expose if all access is denied.

In **`enforce` mode**, `evaluateRead` returns whatever the policy dictates — exposed fields are returned, redacted fields are withheld.

---

Chapter 7 covers observers: what they receive, when they fire, and how to use them for audit logging, metrics, and alerting without letting side-effect code bleed into policy logic.

© 2026 Devjoy Ltd. MIT License.
