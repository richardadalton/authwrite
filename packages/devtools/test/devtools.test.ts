import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DevToolsObserver } from '@authwrite/devtools'
import type { DecisionEvent } from '@authwrite/core'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeEvent(overrides: Partial<{
  allowed: boolean
  effect: 'allow' | 'deny'
  reason: string
  override: 'permissive' | 'lockdown' | undefined
}> = {}): DecisionEvent {
  const allowed  = overrides.allowed  ?? true
  const effect   = overrides.effect   ?? (allowed ? 'allow' : 'deny')
  const reason   = overrides.reason   ?? 'test-rule'
  const override = overrides.override

  return {
    decision: {
      allowed,
      effect,
      reason,
      policy:      'test-policy@1.0.0',
      defaulted:   false,
      durationMs:  0.5,
      evaluatedAt: new Date(),
      override,
      context: {
        subject:  { id: 'u1', roles: ['viewer'] },
        resource: { type: 'document', id: 'doc-1' },
        action:   'read',
      },
    },
  }
}

// ─── DevToolsObserver ─────────────────────────────────────────────────────────

describe('DevToolsObserver', () => {
  let observer: DevToolsObserver

  beforeEach(() => {
    observer = new DevToolsObserver()
  })

  it('buffers decisions as they arrive', () => {
    observer.onDecision(makeEvent({ allowed: true  }))
    observer.onDecision(makeEvent({ allowed: false }))

    expect(observer.getBuffer()).toHaveLength(2)
  })

  it('each persisted decision has a unique id', () => {
    observer.onDecision(makeEvent())
    observer.onDecision(makeEvent())

    const ids = observer.getBuffer().map(d => d.id)
    expect(new Set(ids).size).toBe(2)
  })

  it('maps effect correctly for an allowed decision', () => {
    observer.onDecision(makeEvent({ allowed: true, effect: 'allow' }))
    const [d] = observer.getBuffer()
    expect(d.effect).toBe('allow')
    expect(d.allowed).toBe(true)
  })

  it('maps effect correctly for a denied decision', () => {
    observer.onDecision(makeEvent({ allowed: false, effect: 'deny' }))
    const [d] = observer.getBuffer()
    expect(d.effect).toBe('deny')
    expect(d.allowed).toBe(false)
  })

  it('preserves override field', () => {
    observer.onDecision(makeEvent({ allowed: true, effect: 'deny', override: 'permissive' }))
    const [d] = observer.getBuffer()
    expect(d.override).toBe('permissive')
    // Policy said deny, but enforcer allowed it
    expect(d.effect).toBe('deny')
    expect(d.allowed).toBe(true)
  })

  it('preserves lockdown override', () => {
    observer.onDecision(makeEvent({ allowed: false, effect: 'allow', override: 'lockdown' }))
    const [d] = observer.getBuffer()
    expect(d.override).toBe('lockdown')
    expect(d.effect).toBe('allow')
    expect(d.allowed).toBe(false)
  })

  it('notifies subscribers synchronously', () => {
    const received: string[] = []
    observer.subscribe(d => received.push(d.id))

    observer.onDecision(makeEvent())
    observer.onDecision(makeEvent())

    expect(received).toHaveLength(2)
  })

  it('unsubscribe stops further notifications', () => {
    const received: string[] = []
    const unsub = observer.subscribe(d => received.push(d.id))

    observer.onDecision(makeEvent())
    unsub()
    observer.onDecision(makeEvent())

    expect(received).toHaveLength(1)
  })

  it('enforces maxBuffer limit', () => {
    const small = new DevToolsObserver(3)
    for (let i = 0; i < 5; i++) small.onDecision(makeEvent())

    expect(small.getBuffer()).toHaveLength(3)
  })

  it('getBuffer returns a copy — mutations do not affect internal state', () => {
    observer.onDecision(makeEvent())
    const buf = observer.getBuffer()
    buf.push({ id: 'x' } as never)

    expect(observer.getBuffer()).toHaveLength(1)
  })

  it('clear empties the buffer', () => {
    observer.onDecision(makeEvent())
    observer.onDecision(makeEvent())
    observer.clear()

    expect(observer.getBuffer()).toHaveLength(0)
  })

  it('persisted decision includes subject, resource, and action', () => {
    observer.onDecision(makeEvent())
    const [d] = observer.getBuffer()

    expect(d.subject).toEqual({ id: 'u1', roles: ['viewer'] })
    expect(d.resource).toEqual({ type: 'document', id: 'doc-1' })
    expect(d.action).toBe('read')
  })

  it('persisted decision includes policy string', () => {
    observer.onDecision(makeEvent())
    const [d] = observer.getBuffer()
    expect(d.policy).toBe('test-policy@1.0.0')
  })

  it('timestamp is a number (epoch ms)', () => {
    const before = Date.now()
    observer.onDecision(makeEvent())
    const after  = Date.now()
    const [d] = observer.getBuffer()

    expect(d.timestamp).toBeGreaterThanOrEqual(before)
    expect(d.timestamp).toBeLessThanOrEqual(after)
  })

  it('multiple subscribers all receive the same decision', () => {
    const a: string[] = []
    const b: string[] = []
    observer.subscribe(d => a.push(d.id))
    observer.subscribe(d => b.push(d.id))

    observer.onDecision(makeEvent())

    expect(a).toHaveLength(1)
    expect(b).toHaveLength(1)
    expect(a[0]).toBe(b[0])
  })
})
