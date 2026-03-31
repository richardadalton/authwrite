import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRedisObserver } from '@daltonr/authwrite-observer-redis'
import type { DecisionEvent } from '@daltonr/authwrite-core'

// ─── Mock Redis client ────────────────────────────────────────────────────────

function makeMockRedis(overrides: Record<string, unknown> = {}) {
  return {
    set:  vi.fn().mockResolvedValue('OK'),
    get:  vi.fn().mockResolvedValue(null),
    scan: vi.fn().mockResolvedValue(['0', []]),
    del:  vi.fn().mockResolvedValue(0),
    ...overrides,
  }
}

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
      durationMs: 0.3,
      defaulted:  false,
      override:   undefined,
      error:      undefined,
    },
    source: undefined,
    ...overrides,
  }
}

// ─── onDecision — cache writes ────────────────────────────────────────────────

describe('onDecision', () => {
  it('calls redis.set with the correct key for allowed decisions', () => {
    const client = makeMockRedis()
    const observer = createRedisObserver({ client: client as never })

    observer.onDecision(makeDecisionEvent())

    expect(client.set).toHaveBeenCalledOnce()
    const [key, value] = client.set.mock.calls[0] as [string, string, ...unknown[]]
    expect(key).toBe('authz:decision:u1:read:document:doc-1')
    expect(value).toBe('1')
  })

  it('stores "0" for denied decisions', () => {
    const client = makeMockRedis()
    const observer = createRedisObserver({ client: client as never })
    const event = makeDecisionEvent()
    event.decision.allowed = false

    observer.onDecision(event)

    const [, value] = client.set.mock.calls[0] as [string, string, ...unknown[]]
    expect(value).toBe('0')
  })

  it('sets the TTL via EX flag', () => {
    const client = makeMockRedis()
    const observer = createRedisObserver({ client: client as never, ttl: 120 })

    observer.onDecision(makeDecisionEvent())

    const args = client.set.mock.calls[0] as unknown[]
    expect(args).toContain('EX')
    expect(args).toContain(120)
  })

  it('uses the default TTL of 300 seconds', () => {
    const client = makeMockRedis()
    const observer = createRedisObserver({ client: client as never })

    observer.onDecision(makeDecisionEvent())

    const args = client.set.mock.calls[0] as unknown[]
    expect(args).toContain(300)
  })

  it('uses the configured prefix in the key', () => {
    const client = makeMockRedis()
    const observer = createRedisObserver({ client: client as never, prefix: 'myapp:' })

    observer.onDecision(makeDecisionEvent())

    const [key] = client.set.mock.calls[0] as [string, ...unknown[]]
    expect(key).toMatch(/^myapp:/)
  })

  it('includes empty strings for resource when absent', () => {
    const client = makeMockRedis()
    const observer = createRedisObserver({ client: client as never })
    const event = makeDecisionEvent()
    delete (event.decision.context as Record<string, unknown>)['resource']

    observer.onDecision(event)

    const [key] = client.set.mock.calls[0] as [string, ...unknown[]]
    expect(key).toBe('authz:decision:u1:read::')
  })

  it('calls onError when redis.set fails', async () => {
    const client = makeMockRedis({ set: vi.fn().mockRejectedValue(new Error('redis down')) })
    const onError = vi.fn()
    const observer = createRedisObserver({ client: client as never, onError })

    observer.onDecision(makeDecisionEvent())

    await new Promise(r => setTimeout(r, 0))

    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'redis down' }))
  })

  it('does not throw when redis.set fails and no onError is configured', () => {
    const client = makeMockRedis({ set: vi.fn().mockRejectedValue(new Error('oops')) })
    const observer = createRedisObserver({ client: client as never })

    expect(() => observer.onDecision(makeDecisionEvent())).not.toThrow()
  })
})

// ─── lookup() ─────────────────────────────────────────────────────────────────

describe('lookup()', () => {
  it('returns true when redis has "1"', async () => {
    const client = makeMockRedis({ get: vi.fn().mockResolvedValue('1') })
    const observer = createRedisObserver({ client: client as never })

    const result = await observer.lookup('u1', 'read', 'document', 'doc-1')

    expect(result).toBe(true)
  })

  it('returns false when redis has "0"', async () => {
    const client = makeMockRedis({ get: vi.fn().mockResolvedValue('0') })
    const observer = createRedisObserver({ client: client as never })

    const result = await observer.lookup('u1', 'read', 'document', 'doc-1')

    expect(result).toBe(false)
  })

  it('returns null on a cache miss', async () => {
    const client = makeMockRedis({ get: vi.fn().mockResolvedValue(null) })
    const observer = createRedisObserver({ client: client as never })

    const result = await observer.lookup('u1', 'read', 'document', 'doc-1')

    expect(result).toBeNull()
  })

  it('uses the same key format as onDecision', async () => {
    const client = makeMockRedis({ get: vi.fn().mockResolvedValue('1') })
    const observer = createRedisObserver({ client: client as never })

    observer.onDecision(makeDecisionEvent())
    await observer.lookup('u1', 'read', 'document', 'doc-1')

    const setKey  = (client.set.mock.calls[0] as [string, ...unknown[]])[0]
    const getKey  = (client.get.mock.calls[0] as [string])[0]
    expect(getKey).toBe(setKey)
  })

  it('uses empty strings for absent resource type and id', async () => {
    const client = makeMockRedis()
    const observer = createRedisObserver({ client: client as never })

    await observer.lookup('u1', 'read')

    const [key] = client.get.mock.calls[0] as [string]
    expect(key).toBe('authz:decision:u1:read::')
  })
})

// ─── invalidate() ─────────────────────────────────────────────────────────────

describe('invalidate()', () => {
  it('scans for keys matching the subject prefix when subjectId is given', async () => {
    const client = makeMockRedis()
    const observer = createRedisObserver({ client: client as never })

    await observer.invalidate('u1')

    const [, , pattern] = client.scan.mock.calls[0] as [string, string, string, ...unknown[]]
    expect(pattern).toBe('authz:decision:u1:*')
  })

  it('scans for all decision keys when called without arguments', async () => {
    const client = makeMockRedis()
    const observer = createRedisObserver({ client: client as never })

    await observer.invalidate()

    const [, , pattern] = client.scan.mock.calls[0] as [string, string, string, ...unknown[]]
    expect(pattern).toBe('authz:decision:*')
  })

  it('deletes matched keys', async () => {
    const matchedKeys = ['authz:decision:u1:read:document:doc-1']
    const client = makeMockRedis({
      scan: vi.fn().mockResolvedValue(['0', matchedKeys]),
    })
    const observer = createRedisObserver({ client: client as never })

    await observer.invalidate('u1')

    expect(client.del).toHaveBeenCalledWith(...matchedKeys)
  })

  it('does not call del when no keys match', async () => {
    const client = makeMockRedis({ scan: vi.fn().mockResolvedValue(['0', []]) })
    const observer = createRedisObserver({ client: client as never })

    await observer.invalidate('u1')

    expect(client.del).not.toHaveBeenCalled()
  })

  it('paginates SCAN until cursor is "0"', async () => {
    const client = makeMockRedis({
      scan: vi.fn()
        .mockResolvedValueOnce(['42', ['key1']])
        .mockResolvedValueOnce(['0',  ['key2']]),
    })
    const observer = createRedisObserver({ client: client as never })

    await observer.invalidate()

    expect(client.scan).toHaveBeenCalledTimes(2)
    expect(client.del).toHaveBeenCalledTimes(2)
  })
})

// ─── flush() ──────────────────────────────────────────────────────────────────

describe('flush()', () => {
  it('deletes all decision keys', async () => {
    const allKeys = ['authz:decision:u1:read:document:doc-1', 'authz:decision:u2:write:document:doc-2']
    const client = makeMockRedis({
      scan: vi.fn().mockResolvedValue(['0', allKeys]),
    })
    const observer = createRedisObserver({ client: client as never })

    await observer.flush()

    expect(client.del).toHaveBeenCalledWith(...allKeys)
  })

  it('uses the configured prefix', async () => {
    const client = makeMockRedis()
    const observer = createRedisObserver({ client: client as never, prefix: 'myapp:' })

    await observer.flush()

    const [, , pattern] = client.scan.mock.calls[0] as [string, string, string, ...unknown[]]
    expect(pattern).toBe('myapp:decision:*')
  })
})

// ─── onPolicyReload ───────────────────────────────────────────────────────────

describe('onPolicyReload', () => {
  it('flushes all cached decisions', async () => {
    const allKeys = ['authz:decision:u1:read:document:doc-1']
    const client = makeMockRedis({
      scan: vi.fn().mockResolvedValue(['0', allKeys]),
    })
    const observer = createRedisObserver({ client: client as never })

    observer.onPolicyReload({ id: 'docs', defaultEffect: 'deny', rules: [] })

    // flush is async — wait for microtasks
    await new Promise(r => setTimeout(r, 0))

    expect(client.del).toHaveBeenCalled()
  })
})

// ─── onError ──────────────────────────────────────────────────────────────────

describe('onError', () => {
  it('is a no-op — does not write to redis', () => {
    const client = makeMockRedis()
    const observer = createRedisObserver({ client: client as never })

    observer.onError(new Error('engine error'), {
      subject: { id: 'u1', roles: [] },
      action:  'read',
    })

    expect(client.set).not.toHaveBeenCalled()
  })
})
