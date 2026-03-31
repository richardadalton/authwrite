import { trace, metrics, context, SpanKind, SpanStatusCode } from '@opentelemetry/api'
import type { Tracer, Meter } from '@opentelemetry/api'
import type {
  AuthContext,
  AuthObserver,
  DecisionEvent,
  PolicyDefinition,
} from '@daltonr/authwrite-core'

// ─── Config ───────────────────────────────────────────────────────────────────

export interface OtelObserverConfig {
  /**
   * Tracer to use for span creation.
   * Defaults to trace.getTracer('@daltonr/authwrite-observer-otel'), which picks up
   * whatever TracerProvider has been registered globally.
   */
  tracer?: Tracer
  /**
   * Meter to use for metric instruments.
   * Defaults to metrics.getMeter('@daltonr/authwrite-observer-otel').
   */
  meter?: Meter
  /**
   * Static attributes added to every span and metric data point.
   * Useful for tagging by environment, service name, region, etc.
   */
  attributes?: Record<string, string | number | boolean>
}

// ─── Instrument names ─────────────────────────────────────────────────────────

const DECISIONS_COUNTER  = 'authz.decisions'
const DENIALS_COUNTER    = 'authz.denials'
const DURATION_HISTOGRAM = 'authz.duration'
const ERRORS_COUNTER     = 'authz.errors'
const SPAN_NAME          = 'authz.evaluate'

// ─── Factory ──────────────────────────────────────────────────────────────────

export function createOtelObserver(config: OtelObserverConfig = {}): AuthObserver {
  const tracer = config.tracer ?? trace.getTracer('@daltonr/authwrite-observer-otel')
  const meter  = config.meter  ?? metrics.getMeter('@daltonr/authwrite-observer-otel')

  // Instruments are created once and reused — creating them per-decision is
  // wrong and would break SDK aggregation.
  const decisionsCounter  = meter.createCounter(DECISIONS_COUNTER, {
    description: 'Total number of authorization decisions evaluated',
  })
  const denialsCounter    = meter.createCounter(DENIALS_COUNTER, {
    description: 'Total number of denied authorization decisions',
  })
  const durationHistogram = meter.createHistogram(DURATION_HISTOGRAM, {
    description: 'Authorization policy evaluation duration',
    unit: 'ms',
  })
  const errorsCounter     = meter.createCounter(ERRORS_COUNTER, {
    description: 'Total number of authorization evaluation errors',
  })

  // ─── Helpers ───────────────────────────────────────────────────────────────

  function metricAttrs(action: string, allowed: boolean, policy: string) {
    return { action, allowed: String(allowed), policy }
  }

  // ─── AuthObserver implementation ───────────────────────────────────────────

  function onDecision({ decision, source }: DecisionEvent): void {
    const { context: ctx, allowed, reason, policy, durationMs, override, defaulted, error } = decision

    // ── Metrics ─────────────────────────────────────────────────────────────

    const attrs = metricAttrs(ctx.action, allowed, policy)

    decisionsCounter.add(1, attrs)
    if (!allowed) denialsCounter.add(1, attrs)
    durationHistogram.record(durationMs, { action: ctx.action, allowed: String(allowed) })
    if (error)    errorsCounter.add(1, { action: ctx.action, policy })

    // ── Span ─────────────────────────────────────────────────────────────────
    //
    // Linked to the current active trace context (e.g. the incoming HTTP span)
    // so the authz check is visible in distributed traces.

    const span = tracer.startSpan(
      SPAN_NAME,
      { kind: SpanKind.INTERNAL },
      context.active(),
    )

    span.setAttribute('authz.action',      ctx.action)
    span.setAttribute('authz.allowed',     allowed)
    span.setAttribute('authz.reason',      reason)
    span.setAttribute('authz.policy',      policy)
    span.setAttribute('authz.duration_ms', durationMs)
    span.setAttribute('authz.subject.id',  ctx.subject.id)

    if (ctx.resource) {
      span.setAttribute('authz.resource.type', ctx.resource.type)
      if (ctx.resource.id !== undefined) {
        span.setAttribute('authz.resource.id', ctx.resource.id)
      }
    }

    if (defaulted) span.setAttribute('authz.defaulted', true)
    if (override)  span.setAttribute('authz.override',  override)
    if (source)    span.setAttribute('authz.source',    source)

    if (config.attributes) {
      for (const [k, v] of Object.entries(config.attributes)) {
        span.setAttribute(k, v)
      }
    }

    if (error) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: error.message })
      span.recordException(error)
    }

    span.end()
  }

  function onError(err: Error, ctx: AuthContext): void {
    errorsCounter.add(1, { action: ctx.action })
  }

  function onPolicyReload(_policy: PolicyDefinition): void {
    // No-op — policy reloads are structural events, not per-request telemetry.
    // Teams that want a reload signal can add their own observer.
  }

  return { onDecision, onError, onPolicyReload }
}
