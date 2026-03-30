# Chapter 7: Observers

Authorization decisions are only half of what an authorization system needs to do. The other half is telling the rest of your infrastructure what happened: writing to an audit log, incrementing a metrics counter, triggering an alert when a sensitive resource is accessed. The question is where that code lives. If it lives inside policy rules, the rules become entangled with infrastructure concerns — they grow harder to test, harder to reason about, and harder to swap out. The observer pattern keeps that separation clean. Rules decide. Observers react. This chapter covers the `AuthObserver` interface, when each method fires, and the patterns that work well in production.

---

## The AuthObserver interface

An observer is any object that implements `AuthObserver`. All three methods are optional, but in practice most observers implement at least `onDecision`.

```typescript
import type { AuthObserver, DecisionEvent, AuthContext, PolicyDefinition } from '@authwrite/core'

const myObserver: AuthObserver = {
  onDecision(event: DecisionEvent): void | Promise<void> {
    // Called after every evaluate() or evaluateRead() call
  },

  onError(err: Error, ctx: AuthContext): void {
    // Called when the evaluation phase throws unexpectedly
  },

  onPolicyReload(policy: PolicyDefinition): void {
    // Called when engine.reload() is invoked with a new policy
  },
}
```

Observers are attached to the engine with `engine.addObserver(myObserver)` and can be removed with `engine.removeObserver(myObserver)`. Multiple observers can be attached; they are called in the order they were added.

---

## DecisionEvent

Every `onDecision` call receives a `DecisionEvent`, which carries the full `Decision` object plus two optional fields for correlation and attribution.

```typescript
interface DecisionEvent {
  decision: Decision
  traceId?: string
  source?: string
}
```

The `decision` field is the complete result from the policy evaluation — including `allowed`, `reason`, `override`, `durationMs`, and `policy`. The `traceId` and `source` fields are not set by the engine itself; they come from the `AuthContext` you pass into `evaluate()`. If your context carries a trace ID from an upstream request, it flows through to the event automatically.

```typescript
const decision = await engine.evaluate({
  subject: currentUser,
  resource: document,
  action: 'write',
  traceId: req.headers['x-trace-id'],
  source: 'documents-service',
})
```

A few things to notice:

- The engine does not generate trace IDs. That is intentional — trace ID generation belongs to your request infrastructure, not the authorization library.
- `source` is a free-form string. Use it to distinguish which part of your application triggered the evaluation when multiple services share a policy.
- Both fields are passed through verbatim. The engine does not validate or transform them.

---

## Observers are async

`onDecision` may return a `Promise`. The engine awaits it before proceeding. This means you can write to a database, call an external logging endpoint, or do anything else that requires async I/O inside an observer, and the engine will wait for it to complete.

```typescript
const auditLogObserver: AuthObserver = {
  async onDecision({ decision, traceId, source }) {
    await db.auditLog.insert({
      allowed: decision.allowed,
      reason: decision.reason,
      override: decision.override ?? null,
      policy: decision.policy,
      durationMs: decision.durationMs,
      traceId: traceId ?? null,
      source: source ?? null,
      timestamp: new Date(),
    })
  },
}
```

If you need fire-and-forget behavior — for example, sending a metric where a failure should not block the request — catch the error inside the observer:

```typescript
const metricsObserver: AuthObserver = {
  async onDecision({ decision }) {
    try {
      await metrics.increment('authwrite.decision', {
        allowed: String(decision.allowed),
        reason: decision.reason,
      })
    } catch {
      // Metrics failure must not block the authorization path
    }
  },
}
```

---

## What observers are for

Observers are the right place for anything that reacts to a decision without influencing it.

**Audit logging** is the most common use. Record every denial, or every decision, to a durable store. The `decision.policy` field tells you which policy version was active at the time, which matters when you need to reconstruct what rules were in effect during a past event.

**Metrics and dashboards** — increment counters by action, by rule, by allowed/denied. Plot the denial rate for a specific rule to see when a policy change takes effect in production.

**Alerting** — if a particularly sensitive resource is accessed, an observer can trigger an alert without the policy rule needing to know that alerting exists.

**Audit mode correlation** — in `audit` mode, the Enforcer overrides denials before returning to the caller, but the engine observer receives the honest decision. This is how you collect shadow-mode audit data. See Chapter 6 for detail on how this split works.

---

## The onError callback

`onError` fires when the evaluation phase throws an exception that the engine cannot handle internally. This is distinct from a deny decision — it means something in the rule evaluation itself failed.

```typescript
const errorObserver: AuthObserver = {
  onError(err: Error, ctx: AuthContext) {
    logger.error('AuthEngine evaluation error', {
      message: err.message,
      action: ctx.action,
    })
  },
}
```

`onError` is synchronous by convention. If evaluation has thrown, the engine is in an uncertain state for that request, and awaiting a network call in the error path adds latency and potential for cascading failures. Log to a local buffer and flush asynchronously if you need durability.

---

## The onPolicyReload callback

`onPolicyReload` is called when `engine.reload(policy)` is invoked — typically by a file watcher or a remote loader delivering a new policy version. It receives the incoming `PolicyDefinition` before the engine has swapped it in.

```typescript
const reloadObserver: AuthObserver = {
  onPolicyReload(policy: PolicyDefinition) {
    logger.info('Policy reloaded', {
      id: policy.id,
      version: policy.version,
    })
  },
}
```

This is useful for cache invalidation (if you cache field-level decisions anywhere), for alerting on unexpected reloads in environments where hot reload should not be active, and for audit trails that track which policy version was in effect over time.

---

## OpenTelemetry observer

The `@authwrite/otel` package provides a pre-built observer that emits spans and attributes conforming to OpenTelemetry semantic conventions. Attach it the same way as any observer:

```typescript
import { createOtelObserver } from '@authwrite/otel'

engine.addObserver(createOtelObserver({ tracer: myTracer }))
```

See the API reference for the full attribute list and configuration options.

---

## What observers are not for

Do not use observers to make or modify authorization decisions. If an observer inspects a decision and tries to compensate by modifying application state or calling into the engine recursively, you are reintroducing the coupling that observers are designed to eliminate. The engine guarantees a strict one-way flow: evaluate, then notify. Observers are at the end of that flow, not in the middle of it.

---

Chapter 8 covers policy loaders: how to separate your policy definition from your application code, load it from YAML or JSON at startup, and hot-reload it from disk without a redeploy.

© 2026 Devjoy Ltd. MIT License.
