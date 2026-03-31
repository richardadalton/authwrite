import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createPgObserver } from '@daltonr/authwrite-observer-pg'
import type { DecisionEvent } from '@daltonr/authwrite-core'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeDecisionEvent(overrides: Partial<DecisionEvent> = {}): DecisionEvent {
  return {
    decision: {
      context: {
        subject:  { id: 'u1', roles: ['editor'] },
        resource: { type: 'document', id: 'doc-1' },
        action:   'read',
      },
      allowed:    true,
      reason:     'owner-full-access',
      policy:     'documents',
      durationMs: 0.5,
      defaulted:  false,
      override:   undefined,
      error:      undefined,
    },
    source: undefined,
    ...overrides,
  }
}

function makeMockClient() {
  return { query: vi.fn().mockResolvedValue({ rows: [] }) }
}

// ─── onDecision ───────────────────────────────────────────────────────────────

describe('onDecision', () => {
  it('calls client.query with an INSERT statement', () => {
    const client = makeMockClient()
    const observer = createPgObserver({ client })

    observer.onDecision(makeDecisionEvent())

    expect(client.query).toHaveBeenCalledOnce()
    const [sql] = client.query.mock.calls[0] as [string, unknown[]]
    expect(sql).toMatch(/INSERT INTO authz_decisions/i)
  })

  it('passes subject_id as the first parameter', () => {
    const client = makeMockClient()
    const observer = createPgObserver({ client })

    observer.onDecision(makeDecisionEvent())

    const [, values] = client.query.mock.calls[0] as [string, unknown[]]
    expect(values[0]).toBe('u1')
  })

  it('passes resource_type and resource_id', () => {
    const client = makeMockClient()
    const observer = createPgObserver({ client })

    observer.onDecision(makeDecisionEvent())

    const [, values] = client.query.mock.calls[0] as [string, unknown[]]
    expect(values[1]).toBe('document')
    expect(values[2]).toBe('doc-1')
  })

  it('passes action, policy_id, allowed, reason', () => {
    const client = makeMockClient()
    const observer = createPgObserver({ client })

    observer.onDecision(makeDecisionEvent())

    const [, values] = client.query.mock.calls[0] as [string, unknown[]]
    expect(values[3]).toBe('read')
    expect(values[4]).toBe('documents')
    expect(values[5]).toBe(true)
    expect(values[6]).toBe('owner-full-access')
  })

  it('passes defaulted and duration_ms', () => {
    const client = makeMockClient()
    const observer = createPgObserver({ client })

    observer.onDecision(makeDecisionEvent())

    const [, values] = client.query.mock.calls[0] as [string, unknown[]]
    expect(values[7]).toBe(false)
    expect(values[8]).toBe(0.5)
  })

  it('passes null override when not set', () => {
    const client = makeMockClient()
    const observer = createPgObserver({ client })

    observer.onDecision(makeDecisionEvent())

    const [, values] = client.query.mock.calls[0] as [string, unknown[]]
    expect(values[9]).toBeNull()
  })

  it('passes override when set', () => {
    const client = makeMockClient()
    const observer = createPgObserver({ client })
    const event = makeDecisionEvent()
    event.decision.override = 'permissive'

    observer.onDecision(event)

    const [, values] = client.query.mock.calls[0] as [string, unknown[]]
    expect(values[9]).toBe('permissive')
  })

  it('passes error_message when decision has an error', () => {
    const client = makeMockClient()
    const observer = createPgObserver({ client })
    const event = makeDecisionEvent()
    event.decision.error = new Error('policy threw')

    observer.onDecision(event)

    const [, values] = client.query.mock.calls[0] as [string, unknown[]]
    expect(values[10]).toBe('policy threw')
  })

  it('passes null error_message when no error', () => {
    const client = makeMockClient()
    const observer = createPgObserver({ client })

    observer.onDecision(makeDecisionEvent())

    const [, values] = client.query.mock.calls[0] as [string, unknown[]]
    expect(values[10]).toBeNull()
  })

  it('passes source when set', () => {
    const client = makeMockClient()
    const observer = createPgObserver({ client })
    const event = makeDecisionEvent({ source: 'express-middleware' })

    observer.onDecision(event)

    const [, values] = client.query.mock.calls[0] as [string, unknown[]]
    expect(values[11]).toBe('express-middleware')
  })

  it('serialises subject as JSON', () => {
    const client = makeMockClient()
    const observer = createPgObserver({ client })

    observer.onDecision(makeDecisionEvent())

    const [, values] = client.query.mock.calls[0] as [string, unknown[]]
    expect(JSON.parse(values[12] as string)).toMatchObject({ id: 'u1', roles: ['editor'] })
  })

  it('serialises resource as JSON', () => {
    const client = makeMockClient()
    const observer = createPgObserver({ client })

    observer.onDecision(makeDecisionEvent())

    const [, values] = client.query.mock.calls[0] as [string, unknown[]]
    expect(JSON.parse(values[13] as string)).toMatchObject({ type: 'document', id: 'doc-1' })
  })

  it('passes null resource columns when resource is absent', () => {
    const client = makeMockClient()
    const observer = createPgObserver({ client })
    const event = makeDecisionEvent()
    delete (event.decision.context as Record<string, unknown>)['resource']

    observer.onDecision(event)

    const [, values] = client.query.mock.calls[0] as [string, unknown[]]
    expect(values[1]).toBeNull()
    expect(values[2]).toBeNull()
    expect(values[13]).toBeNull()
  })

  it('uses the configured table name', () => {
    const client = makeMockClient()
    const observer = createPgObserver({ client, table: 'audit.authz_log' })

    observer.onDecision(makeDecisionEvent())

    const [sql] = client.query.mock.calls[0] as [string, unknown[]]
    expect(sql).toMatch(/INSERT INTO audit\.authz_log/i)
  })

  it('calls onError when the INSERT fails', async () => {
    const dbError = new Error('connection error')
    const client = { query: vi.fn().mockRejectedValue(dbError) }
    const onError = vi.fn()
    const observer = createPgObserver({ client, onError })

    observer.onDecision(makeDecisionEvent())

    // The INSERT is fire-and-forget; wait for the microtask queue to drain
    await new Promise(r => setTimeout(r, 0))

    expect(onError).toHaveBeenCalledWith(dbError)
  })

  it('does not throw when INSERT fails and no onError is configured', () => {
    const client = { query: vi.fn().mockRejectedValue(new Error('oops')) }
    const observer = createPgObserver({ client })

    expect(() => observer.onDecision(makeDecisionEvent())).not.toThrow()
  })
})

// ─── onError ──────────────────────────────────────────────────────────────────

describe('onError', () => {
  it('forwards engine errors to the configured onError handler', () => {
    const client = makeMockClient()
    const onError = vi.fn()
    const observer = createPgObserver({ client, onError })
    const err = new Error('policy evaluation error')

    observer.onError(err, {
      subject:  { id: 'u1', roles: [] },
      action:   'read',
    })

    expect(onError).toHaveBeenCalledWith(err)
  })

  it('does not throw when no onError handler is configured', () => {
    const client = makeMockClient()
    const observer = createPgObserver({ client })

    expect(() => observer.onError(new Error('boom'), {
      subject: { id: 'u1', roles: [] },
      action:  'read',
    })).not.toThrow()
  })

  it('does not write to the database for engine errors', () => {
    const client = makeMockClient()
    const observer = createPgObserver({ client })

    observer.onError(new Error('engine blew up'), {
      subject: { id: 'u1', roles: [] },
      action:  'read',
    })

    expect(client.query).not.toHaveBeenCalled()
  })
})

// ─── onPolicyReload ───────────────────────────────────────────────────────────

describe('onPolicyReload', () => {
  it('is a no-op — does not write to the database', () => {
    const client = makeMockClient()
    const observer = createPgObserver({ client })

    observer.onPolicyReload({ id: 'docs', defaultEffect: 'deny', rules: [] })

    expect(client.query).not.toHaveBeenCalled()
  })
})

// ─── Constructor validation ───────────────────────────────────────────────────

describe('table name validation', () => {
  it('accepts a simple identifier', () => {
    const client = makeMockClient()
    expect(() => createPgObserver({ client, table: 'authz_decisions' })).not.toThrow()
  })

  it('accepts schema-qualified identifiers', () => {
    const client = makeMockClient()
    expect(() => createPgObserver({ client, table: 'public.authz_decisions' })).not.toThrow()
  })

  it('throws on invalid table names', () => {
    const client = makeMockClient()
    expect(() => createPgObserver({ client, table: 'DROP TABLE users;--' })).toThrow()
    expect(() => createPgObserver({ client, table: '1invalid' })).toThrow()
    expect(() => createPgObserver({ client, table: 'has space' })).toThrow()
  })
})
