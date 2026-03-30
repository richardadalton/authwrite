# OpenTelemetry Observer API Reference

This reference covers `@authwrite/observer-otel` — an `AuthObserver` that emits OpenTelemetry spans and metrics for every authorization decision.

---

## Peer dependency

Requires `@opentelemetry/api >= 1.0.0` installed in the host application. The package does not bundle the OpenTelemetry API.

---

## `createOtelObserver(config?)`

```typescript
export function createOtelObserver(config?: OtelObserverConfig): AuthObserver
```

Factory function that returns an `AuthObserver`. Pass the result in the `observers` array when constructing an `AuthEngine`.

### `OtelObserverConfig` options

| Option | Type | Default | Description |
|---|---|---|---|
| `tracer` | `Tracer` | `trace.getTracer('@authwrite/observer-otel')` | The OpenTelemetry `Tracer` used to create spans. When omitted, the global tracer provider is used. |
| `meter` | `Meter` | `metrics.getMeter('@authwrite/observer-otel')` | The OpenTelemetry `Meter` used to create metric instruments. When omitted, the global meter provider is used. |
| `attributes` | `Record<string, string \| number \| boolean>` | `{}` | (optional) Static attributes added to every span and every metric data point produced by this observer. |

All three options are optional. Calling `createOtelObserver()` with no arguments uses the global tracer and meter providers.

---

## Span reference

Every call to `onDecision` creates one span with the following characteristics.

| Property | Value |
|---|---|
| Span name | `'authz.evaluate'` |
| Span kind | `SpanKind.INTERNAL` |

### Span attributes

| Attribute | Type | Condition | Description |
|---|---|---|---|
| `authz.action` | `string` | always | The action from `decision.context.action`. |
| `authz.allowed` | `boolean` | always | The value of `decision.allowed`. |
| `authz.reason` | `string` | always | The value of `decision.reason`. |
| `authz.policy` | `string` | always | The value of `decision.policy`. |
| `authz.duration_ms` | `number` | always | The value of `decision.durationMs`. |
| `authz.subject.id` | `string` | always | The value of `decision.context.subject.id`. |
| `authz.resource.type` | `string` | resource present | The value of `decision.context.resource.type`. |
| `authz.resource.id` | `string` | resource present and `resource.id` set | The value of `decision.context.resource.id`. |
| `authz.defaulted` | `boolean` | `decision.defaulted === true` | Set to `true` when the policy default effect was applied. |
| `authz.override` | `string` | `decision.override` is set | The value of `decision.override` (`'permissive'` or `'lockdown'`). |
| `authz.source` | `string` | `event.source` is set | The value of `event.source`. |

Any attributes specified in `OtelObserverConfig.attributes` are also added to every span.

### Error handling on spans

When `decision.error` is set, the span status is set to `SpanStatusCode.ERROR` and `span.recordException(decision.error)` is called before the span ends.

---

## Metrics reference

Metric instruments are created once when `createOtelObserver` is called and reused for all subsequent decisions.

| Instrument name | Type | Unit | Description | Labels |
|---|---|---|---|---|
| `authz.decisions` | Counter | — | Total number of authorization decisions evaluated. | `action`, `allowed` (`'true'`/`'false'`), `policy` |
| `authz.denials` | Counter | — | Number of decisions where access was denied. Incremented only when `decision.allowed` is `false`. | `action`, `allowed`, `policy` |
| `authz.duration` | Histogram | `ms` | Distribution of evaluation durations in milliseconds. | `action`, `allowed` |
| `authz.errors` | Counter | — | Number of decisions that included an error. Incremented only when `decision.error` is set. | `action`, `policy` |

Any attributes specified in `OtelObserverConfig.attributes` are added to every metric data point in addition to the labels listed above.

---

## `onDecision` behaviour

Called by the engine after every `evaluate()` call. Executes synchronously:

1. Creates a span named `'authz.evaluate'` using the configured tracer.
2. Sets all applicable span attributes from the decision and event.
3. If `decision.error` is set: sets `SpanStatusCode.ERROR` and records the exception on the span.
4. Ends the span.
5. Increments the `authz.decisions` counter.
6. If `decision.allowed` is `false`: increments the `authz.denials` counter.
7. Records a value on the `authz.duration` histogram.
8. If `decision.error` is set: increments the `authz.errors` counter.

---

## `onError` behaviour

Called by the engine when an unexpected error is caught outside of a normal decision flow. Increments the `authz.errors` counter with the `action` and `policy` labels derived from the provided `AuthContext`.

---

## `onPolicyReload` behaviour

No-op. Policy reload events are not recorded as spans or metrics.

---

© 2026 Devjoy Ltd. MIT License.
