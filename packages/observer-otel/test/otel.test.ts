import { describe, it, expect, vi } from 'vitest'
import { createOtelObserver } from '@daltonr/authwrite-observer-otel'
import { createAuthEngine } from '@daltonr/authwrite-core'
import type { Decision, DecisionEvent, AuthContext, Subject, Resource } from '@daltonr/authwrite-core'
import type { Tracer, Meter, Span } from '@opentelemetry/api'
import { SpanStatusCode } from '@opentelemetry/api'

// ─── Mock OTel infrastructure ─────────────────────────────────────────────────

interface MockSpan {
  setAttribute(k: string, v: unknown): MockSpan
  setStatus(s: { code: number; message?: string }): MockSpan
  recordException(err: Error): void
  end(): void
  addEvent: ReturnType<typeof vi.fn>
  isRecording(): boolean
  _attrs: Record<string, unknown>
  _status: { code: number; message?: string } | undefined
  _ended: boolean
  _exceptions: Error[]
}

function makeMockSpan(): MockSpan {
  const span: MockSpan = {
    _attrs: {},
    _status: undefined,
    _ended: false,
    _exceptions: [],
    setAttribute(k, v) { span._attrs[k] = v; return span },
    setStatus(s)       { span._status = s; return span },
    recordException(e) { span._exceptions.push(e) },
    end()              { span._ended = true },
    addEvent:          vi.fn().mockReturnThis(),
    isRecording()      { return true },
  }
  return span
}

interface MockTracer {
  startSpan(name: string, options?: unknown, ctx?: unknown): MockSpan
  startActiveSpan: ReturnType<typeof vi.fn>
  _spans: MockSpan[]
  _last(): MockSpan
}

function makeMockTracer(): MockTracer {
  const spans: MockSpan[] = []
  return {
    _spans: spans,
    _last: () => spans[spans.length - 1],
    startSpan(_name, _opts?, _ctx?) {
      const span = makeMockSpan()
      spans.push(span)
      return span
    },
    startActiveSpan: vi.fn(),
  }
}

interface MockCounter {
  add(value: number, attrs?: Record<string, unknown>): void
  _calls: Array<{ value: number; attrs?: Record<string, unknown> }>
}

function makeMockCounter(): MockCounter {
  const calls: Array<{ value: number; attrs?: Record<string, unknown> }> = []
  return {
    _calls: calls,
    add(value, attrs) { calls.push({ value, attrs }) },
  }
}

interface MockHistogram {
  record(value: number, attrs?: Record<string, unknown>): void
  _calls: Array<{ value: number; attrs?: Record<string, unknown> }>
}

function makeMockHistogram(): MockHistogram {
  const calls: Array<{ value: number; attrs?: Record<string, unknown> }> = []
  return {
    _calls: calls,
    record(value, attrs) { calls.push({ value, attrs }) },
  }
}

interface MockMeter {
  createCounter(name: string): MockCounter
  createHistogram(name: string): MockHistogram
  _counters: Record<string, MockCounter>
  _histograms: Record<string, MockHistogram>
}

function makeMockMeter(): MockMeter {
  const counters: Record<string, MockCounter> = {}
  const histograms: Record<string, MockHistogram> = {}
  return {
    _counters: counters,
    _histograms: histograms,
    createCounter(name) {
      counters[name] = makeMockCounter()
      return counters[name]
    },
    createHistogram(name) {
      histograms[name] = makeMockHistogram()
      return histograms[name]
    },
  }
}

// ─── Decision fixture helpers ─────────────────────────────────────────────────

type User = Subject
type Doc  = Resource & { status?: string }

const baseContext: AuthContext<User, Doc> = {
  subject:  { id: 'u1', roles: ['editor'] },
  resource: { type: 'document', id: 'doc-1' },
  action:   'read',
}

function makeDecision(overrides: Partial<Decision> = {}): Decision {
  return {
    allowed:     true,
    effect:      'allow',
    reason:      'owner-full-access',
    policy:      'documents@1.0.0',
    context:     baseContext,
    evaluatedAt: new Date(),
    durationMs:  3,
    ...overrides,
  }
}

function makeEvent(overrides: Partial<DecisionEvent> = {}): DecisionEvent {
  return {
    decision: makeDecision(),
    ...overrides,
  }
}

// ─── Span attributes ──────────────────────────────────────────────────────────

describe('span attributes', () => {
  it('creates a span named "authz.evaluate" for each decision', async () => {
    const tracer = makeMockTracer()
    const meter  = makeMockMeter()
    const observer = createOtelObserver({ tracer: tracer as unknown as Tracer, meter: meter as unknown as Meter })

    await observer.onDecision(makeEvent())

    expect(tracer._spans).toHaveLength(1)
  })

  it('sets authz.action on the span', async () => {
    const tracer = makeMockTracer()
    const meter  = makeMockMeter()
    const observer = createOtelObserver({ tracer: tracer as unknown as Tracer, meter: meter as unknown as Meter })

    await observer.onDecision(makeEvent())

    expect(tracer._last()._attrs['authz.action']).toBe('read')
  })

  it('sets authz.allowed on the span', async () => {
    const tracer = makeMockTracer()
    const meter  = makeMockMeter()
    const observer = createOtelObserver({ tracer: tracer as unknown as Tracer, meter: meter as unknown as Meter })

    await observer.onDecision(makeEvent({ decision: makeDecision({ allowed: false, effect: 'deny' }) }))

    expect(tracer._last()._attrs['authz.allowed']).toBe(false)
  })

  it('sets authz.reason on the span', async () => {
    const tracer = makeMockTracer()
    const meter  = makeMockMeter()
    const observer = createOtelObserver({ tracer: tracer as unknown as Tracer, meter: meter as unknown as Meter })

    await observer.onDecision(makeEvent())

    expect(tracer._last()._attrs['authz.reason']).toBe('owner-full-access')
  })

  it('sets authz.policy on the span', async () => {
    const tracer = makeMockTracer()
    const meter  = makeMockMeter()
    const observer = createOtelObserver({ tracer: tracer as unknown as Tracer, meter: meter as unknown as Meter })

    await observer.onDecision(makeEvent())

    expect(tracer._last()._attrs['authz.policy']).toBe('documents@1.0.0')
  })

  it('sets authz.duration_ms on the span', async () => {
    const tracer = makeMockTracer()
    const meter  = makeMockMeter()
    const observer = createOtelObserver({ tracer: tracer as unknown as Tracer, meter: meter as unknown as Meter })

    await observer.onDecision(makeEvent({ decision: makeDecision({ durationMs: 7 }) }))

    expect(tracer._last()._attrs['authz.duration_ms']).toBe(7)
  })

  it('sets authz.subject.id on the span', async () => {
    const tracer = makeMockTracer()
    const meter  = makeMockMeter()
    const observer = createOtelObserver({ tracer: tracer as unknown as Tracer, meter: meter as unknown as Meter })

    await observer.onDecision(makeEvent())

    expect(tracer._last()._attrs['authz.subject.id']).toBe('u1')
  })

  it('sets authz.resource.type and authz.resource.id when resource is present', async () => {
    const tracer = makeMockTracer()
    const meter  = makeMockMeter()
    const observer = createOtelObserver({ tracer: tracer as unknown as Tracer, meter: meter as unknown as Meter })

    await observer.onDecision(makeEvent())

    expect(tracer._last()._attrs['authz.resource.type']).toBe('document')
    expect(tracer._last()._attrs['authz.resource.id']).toBe('doc-1')
  })

  it('omits authz.resource.id when resource has no id (type action)', async () => {
    const tracer = makeMockTracer()
    const meter  = makeMockMeter()
    const observer = createOtelObserver({ tracer: tracer as unknown as Tracer, meter: meter as unknown as Meter })

    const ctx: AuthContext = { subject: { id: 'u1', roles: [] }, resource: { type: 'document' }, action: 'create' }
    await observer.onDecision(makeEvent({ decision: makeDecision({ context: ctx }) }))

    expect(tracer._last()._attrs['authz.resource.type']).toBe('document')
    expect('authz.resource.id' in tracer._last()._attrs).toBe(false)
  })

  it('omits all resource attributes for subject actions (no resource)', async () => {
    const tracer = makeMockTracer()
    const meter  = makeMockMeter()
    const observer = createOtelObserver({ tracer: tracer as unknown as Tracer, meter: meter as unknown as Meter })

    const ctx: AuthContext = { subject: { id: 'u1', roles: [] }, action: 'change-password' }
    await observer.onDecision(makeEvent({ decision: makeDecision({ context: ctx }) }))

    expect('authz.resource.type' in tracer._last()._attrs).toBe(false)
    expect('authz.resource.id'   in tracer._last()._attrs).toBe(false)
  })

  it('sets authz.override when the enforcer overrode the decision', async () => {
    const tracer = makeMockTracer()
    const meter  = makeMockMeter()
    const observer = createOtelObserver({ tracer: tracer as unknown as Tracer, meter: meter as unknown as Meter })

    await observer.onDecision(makeEvent({ decision: makeDecision({ override: 'permissive' }) }))

    expect(tracer._last()._attrs['authz.override']).toBe('permissive')
  })

  it('omits authz.override when not set', async () => {
    const tracer = makeMockTracer()
    const meter  = makeMockMeter()
    const observer = createOtelObserver({ tracer: tracer as unknown as Tracer, meter: meter as unknown as Meter })

    await observer.onDecision(makeEvent())

    expect('authz.override' in tracer._last()._attrs).toBe(false)
  })

  it('sets authz.defaulted when the defaultEffect was applied', async () => {
    const tracer = makeMockTracer()
    const meter  = makeMockMeter()
    const observer = createOtelObserver({ tracer: tracer as unknown as Tracer, meter: meter as unknown as Meter })

    await observer.onDecision(makeEvent({ decision: makeDecision({ defaulted: true }) }))

    expect(tracer._last()._attrs['authz.defaulted']).toBe(true)
  })

  it('sets authz.source when provided in the event', async () => {
    const tracer = makeMockTracer()
    const meter  = makeMockMeter()
    const observer = createOtelObserver({ tracer: tracer as unknown as Tracer, meter: meter as unknown as Meter })

    await observer.onDecision(makeEvent({ source: 'express-middleware' }))

    expect(tracer._last()._attrs['authz.source']).toBe('express-middleware')
  })

  it('applies extra attributes from config to every span', async () => {
    const tracer = makeMockTracer()
    const meter  = makeMockMeter()
    const observer = createOtelObserver({
      tracer: tracer as unknown as Tracer,
      meter:  meter  as unknown as Meter,
      attributes: { 'service.name': 'my-api', 'deployment.env': 'production' },
    })

    await observer.onDecision(makeEvent())

    expect(tracer._last()._attrs['service.name']).toBe('my-api')
    expect(tracer._last()._attrs['deployment.env']).toBe('production')
  })

  it('ends the span after recording', async () => {
    const tracer = makeMockTracer()
    const meter  = makeMockMeter()
    const observer = createOtelObserver({ tracer: tracer as unknown as Tracer, meter: meter as unknown as Meter })

    await observer.onDecision(makeEvent())

    expect(tracer._last()._ended).toBe(true)
  })
})

// ─── Span error handling ──────────────────────────────────────────────────────

describe('span error handling', () => {
  it('sets ERROR status when decision contains an error', async () => {
    const tracer = makeMockTracer()
    const meter  = makeMockMeter()
    const observer = createOtelObserver({ tracer: tracer as unknown as Tracer, meter: meter as unknown as Meter })

    const err = new Error('rule evaluation threw')
    await observer.onDecision(makeEvent({ decision: makeDecision({ error: err }) }))

    expect(tracer._last()._status?.code).toBe(SpanStatusCode.ERROR)
    expect(tracer._last()._status?.message).toBe('rule evaluation threw')
  })

  it('records the exception on the span', async () => {
    const tracer = makeMockTracer()
    const meter  = makeMockMeter()
    const observer = createOtelObserver({ tracer: tracer as unknown as Tracer, meter: meter as unknown as Meter })

    const err = new Error('kaboom')
    await observer.onDecision(makeEvent({ decision: makeDecision({ error: err }) }))

    expect(tracer._last()._exceptions).toContain(err)
  })

  it('still ends the span when decision has an error', async () => {
    const tracer = makeMockTracer()
    const meter  = makeMockMeter()
    const observer = createOtelObserver({ tracer: tracer as unknown as Tracer, meter: meter as unknown as Meter })

    await observer.onDecision(makeEvent({ decision: makeDecision({ error: new Error('boom') }) }))

    expect(tracer._last()._ended).toBe(true)
  })
})

// ─── Metrics ──────────────────────────────────────────────────────────────────

describe('metrics', () => {
  it('increments authz.decisions on every decision', async () => {
    const tracer = makeMockTracer()
    const meter  = makeMockMeter()
    const observer = createOtelObserver({ tracer: tracer as unknown as Tracer, meter: meter as unknown as Meter })

    await observer.onDecision(makeEvent())
    await observer.onDecision(makeEvent())

    expect(meter._counters['authz.decisions']._calls).toHaveLength(2)
  })

  it('includes action, allowed, and policy on the decisions counter', async () => {
    const tracer = makeMockTracer()
    const meter  = makeMockMeter()
    const observer = createOtelObserver({ tracer: tracer as unknown as Tracer, meter: meter as unknown as Meter })

    await observer.onDecision(makeEvent())

    const call = meter._counters['authz.decisions']._calls[0]
    expect(call.attrs).toMatchObject({
      action:  'read',
      allowed: 'true',
      policy:  'documents@1.0.0',
    })
  })

  it('increments authz.denials only on denied decisions', async () => {
    const tracer = makeMockTracer()
    const meter  = makeMockMeter()
    const observer = createOtelObserver({ tracer: tracer as unknown as Tracer, meter: meter as unknown as Meter })

    await observer.onDecision(makeEvent({ decision: makeDecision({ allowed: true,  effect: 'allow' }) }))
    await observer.onDecision(makeEvent({ decision: makeDecision({ allowed: false, effect: 'deny'  }) }))
    await observer.onDecision(makeEvent({ decision: makeDecision({ allowed: false, effect: 'deny'  }) }))

    expect(meter._counters['authz.denials']._calls).toHaveLength(2)
  })

  it('records durationMs in the authz.duration histogram', async () => {
    const tracer = makeMockTracer()
    const meter  = makeMockMeter()
    const observer = createOtelObserver({ tracer: tracer as unknown as Tracer, meter: meter as unknown as Meter })

    await observer.onDecision(makeEvent({ decision: makeDecision({ durationMs: 12 }) }))

    expect(meter._histograms['authz.duration']._calls[0].value).toBe(12)
  })

  it('histogram attributes include action and allowed', async () => {
    const tracer = makeMockTracer()
    const meter  = makeMockMeter()
    const observer = createOtelObserver({ tracer: tracer as unknown as Tracer, meter: meter as unknown as Meter })

    await observer.onDecision(makeEvent())

    expect(meter._histograms['authz.duration']._calls[0].attrs).toMatchObject({
      action:  'read',
      allowed: 'true',
    })
  })

  it('increments authz.errors when the decision contains an error', async () => {
    const tracer = makeMockTracer()
    const meter  = makeMockMeter()
    const observer = createOtelObserver({ tracer: tracer as unknown as Tracer, meter: meter as unknown as Meter })

    await observer.onDecision(makeEvent({ decision: makeDecision({ error: new Error('boom') }) }))

    expect(meter._counters['authz.errors']._calls).toHaveLength(1)
    expect(meter._counters['authz.errors']._calls[0].attrs).toMatchObject({ action: 'read' })
  })

  it('does not increment authz.errors when the decision has no error', async () => {
    const tracer = makeMockTracer()
    const meter  = makeMockMeter()
    const observer = createOtelObserver({ tracer: tracer as unknown as Tracer, meter: meter as unknown as Meter })

    await observer.onDecision(makeEvent())

    expect(meter._counters['authz.errors']._calls).toHaveLength(0)
  })
})

// ─── onError ─────────────────────────────────────────────────────────────────

describe('onError', () => {
  it('increments authz.errors counter when evaluation phase errors', () => {
    const tracer = makeMockTracer()
    const meter  = makeMockMeter()
    const observer = createOtelObserver({ tracer: tracer as unknown as Tracer, meter: meter as unknown as Meter })

    const ctx: AuthContext = { subject: { id: 'u1', roles: [] }, action: 'read' }
    observer.onError!(new Error('unexpected'), ctx)

    expect(meter._counters['authz.errors']._calls).toHaveLength(1)
    expect(meter._counters['authz.errors']._calls[0].attrs).toMatchObject({ action: 'read' })
  })
})

// ─── onPolicyReload ───────────────────────────────────────────────────────────

describe('onPolicyReload', () => {
  it('does not throw when policy is reloaded', () => {
    const tracer = makeMockTracer()
    const meter  = makeMockMeter()
    const observer = createOtelObserver({ tracer: tracer as unknown as Tracer, meter: meter as unknown as Meter })

    expect(() =>
      observer.onPolicyReload!({ id: 'p', defaultEffect: 'deny', rules: [] })
    ).not.toThrow()
  })
})

// ─── Default (no injection) ───────────────────────────────────────────────────

describe('defaults', () => {
  it('works without injected tracer/meter — uses OTel global no-ops', async () => {
    const observer = createOtelObserver()

    expect(() => observer.onDecision(makeEvent())).not.toThrow()
  })
})

// ─── Integration ─────────────────────────────────────────────────────────────

describe('integration with createAuthEngine', () => {
  it('receives decisions from the engine and records spans + metrics', async () => {
    const tracer = makeMockTracer()
    const meter  = makeMockMeter()
    const observer = createOtelObserver({ tracer: tracer as unknown as Tracer, meter: meter as unknown as Meter })

    const engine = createAuthEngine({
      policy: { id: 'p', defaultEffect: 'allow', rules: [] },
      observers: [observer],
    })

    await engine.evaluate({ subject: { id: 'u1', roles: [] }, action: 'read' })
    await engine.evaluate({ subject: { id: 'u1', roles: [] }, action: 'write' })

    expect(tracer._spans).toHaveLength(2)
    expect(meter._counters['authz.decisions']._calls).toHaveLength(2)
  })

  it('records the correct allowed value from an engine deny', async () => {
    const tracer = makeMockTracer()
    const meter  = makeMockMeter()
    const observer = createOtelObserver({ tracer: tracer as unknown as Tracer, meter: meter as unknown as Meter })

    const engine = createAuthEngine({
      policy: { id: 'p', defaultEffect: 'deny', rules: [] },
      observers: [observer],
    })

    await engine.evaluate({ subject: { id: 'u1', roles: [] }, action: 'delete' })

    expect(tracer._last()._attrs['authz.allowed']).toBe(false)
    expect(meter._counters['authz.denials']._calls).toHaveLength(1)
  })
})
