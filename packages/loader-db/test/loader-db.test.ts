import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createDbLoader } from '@daltonr/authwrite-loader-db'
import { createAuthEngine, fromLoader } from '@daltonr/authwrite-core'
import type { Subject, Resource, AuthContext } from '@daltonr/authwrite-core'

// ─── Test domain types ────────────────────────────────────────────────────────

type User = Subject & { department?: string }
type Doc  = Resource & { status?: string; ownerId?: string }

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const user = (attrs: Partial<User> = {}): User => ({ id: 'u1', roles: [], ...attrs })
const doc  = (attrs: Partial<Doc>  = {}): Doc  => ({ type: 'document', id: 'doc-1', ...attrs })

const ownerMatch = ({ subject, resource }: AuthContext<User, Doc>) =>
  resource?.ownerId === subject.id

const adminMatch = ({ subject }: AuthContext<User, Doc>) =>
  subject.roles.includes('admin')

const baseRegistry = {
  'owner-full-access': { match: ownerMatch },
  'admin-override':    { match: adminMatch },
}

const minimalPolicy = {
  id:            'documents',
  defaultEffect: 'deny' as const,
  rules:         [],
}

const policyWithRules = {
  id:            'documents',
  defaultEffect: 'deny' as const,
  rules:         [{ id: 'owner-full-access', allow: ['*'] }],
}

// ─── load() ───────────────────────────────────────────────────────────────────

describe('load()', () => {
  it('calls query() and returns a PolicyDefinition', async () => {
    const query = vi.fn().mockResolvedValue(minimalPolicy)
    const loader = createDbLoader({ query, rules: {} })
    const policy = await loader.load()

    expect(query).toHaveBeenCalledOnce()
    expect(policy.id).toBe('documents')
    expect(policy.defaultEffect).toBe('deny')
    expect(policy.rules).toHaveLength(0)
  })

  it('merges match functions from the registry into rules', async () => {
    const query = vi.fn().mockResolvedValue(policyWithRules)
    const loader = createDbLoader<User, Doc>({ query, rules: baseRegistry })
    const policy = await loader.load()

    expect(policy.rules[0].match).toBe(ownerMatch)
  })

  it('preserves version and description', async () => {
    const query = vi.fn().mockResolvedValue({
      ...minimalPolicy,
      version:     '3.0.0',
      description: 'Document policy',
    })
    const loader = createDbLoader({ query, rules: {} })
    const policy = await loader.load()

    expect(policy.version).toBe('3.0.0')
    expect(policy.description).toBe('Document policy')
  })

  it('preserves priority, allow, and deny from the query result', async () => {
    const raw = {
      id:            'documents',
      defaultEffect: 'deny' as const,
      rules:         [{ id: 'owner-full-access', priority: 5, allow: ['read'], deny: ['delete'] }],
    }
    const query = vi.fn().mockResolvedValue(raw)
    const loader = createDbLoader<User, Doc>({ query, rules: baseRegistry })
    const policy = await loader.load()

    expect(policy.rules[0].priority).toBe(5)
    expect(policy.rules[0].allow).toEqual(['read'])
    expect(policy.rules[0].deny).toEqual(['delete'])
  })

  it('preserves rule description', async () => {
    const raw = {
      id:            'documents',
      defaultEffect: 'deny' as const,
      rules:         [{ id: 'owner-full-access', description: 'Owner has full access', allow: ['*'] }],
    }
    const query = vi.fn().mockResolvedValue(raw)
    const loader = createDbLoader<User, Doc>({ query, rules: baseRegistry })
    const policy = await loader.load()

    expect(policy.rules[0].description).toBe('Owner has full access')
  })

  it('attaches condition function from registry when provided', async () => {
    const conditionFn = ({ subject }: AuthContext<User, Doc>) => subject.roles.includes('verified')
    const query = vi.fn().mockResolvedValue(policyWithRules)
    const loader = createDbLoader<User, Doc>({
      query,
      rules: { 'owner-full-access': { match: ownerMatch, condition: conditionFn } },
    })
    const policy = await loader.load()

    expect(policy.rules[0].condition).toBe(conditionFn)
  })

  it('rules without a condition in the registry have no condition on the merged rule', async () => {
    const query = vi.fn().mockResolvedValue(policyWithRules)
    const loader = createDbLoader<User, Doc>({ query, rules: baseRegistry })
    const policy = await loader.load()

    expect(policy.rules[0].condition).toBeUndefined()
  })
})

// ─── fieldRules ───────────────────────────────────────────────────────────────

describe('fieldRules', () => {
  it('loads fieldRules when present', async () => {
    const raw = {
      id:            'documents',
      defaultEffect: 'allow' as const,
      rules:         [],
      fieldRules:    [{ id: 'owner-full-access', expose: ['id', 'title'], redact: ['internalNotes'] }],
    }
    const query = vi.fn().mockResolvedValue(raw)
    const loader = createDbLoader<User, Doc>({
      query,
      rules: { 'owner-full-access': { match: ownerMatch } },
    })
    const policy = await loader.load()

    expect(policy.fieldRules).toHaveLength(1)
    expect(policy.fieldRules![0].expose).toEqual(['id', 'title'])
    expect(policy.fieldRules![0].redact).toEqual(['internalNotes'])
    expect(policy.fieldRules![0].match).toBe(ownerMatch)
  })

  it('omits fieldRules when not present', async () => {
    const query = vi.fn().mockResolvedValue(minimalPolicy)
    const loader = createDbLoader({ query, rules: {} })
    const policy = await loader.load()

    expect(policy.fieldRules).toBeUndefined()
  })
})

// ─── Validation ───────────────────────────────────────────────────────────────

describe('validation', () => {
  it('throws when a rule has no matching registry entry', async () => {
    const query = vi.fn().mockResolvedValue(policyWithRules)
    const loader = createDbLoader({ query, rules: {} })

    await expect(loader.load()).rejects.toThrow('owner-full-access')
  })

  it('throws when policy id is missing', async () => {
    const query = vi.fn().mockResolvedValue({ defaultEffect: 'deny', rules: [] })
    const loader = createDbLoader({ query, rules: {} })

    await expect(loader.load()).rejects.toThrow()
  })

  it('throws when defaultEffect is invalid', async () => {
    const query = vi.fn().mockResolvedValue({ id: 'docs', defaultEffect: 'maybe', rules: [] })
    const loader = createDbLoader({ query, rules: {} })

    await expect(loader.load()).rejects.toThrow()
  })

  it('throws when query returns a non-object', async () => {
    const query = vi.fn().mockResolvedValue('not an object')
    const loader = createDbLoader({ query, rules: {} })

    await expect(loader.load()).rejects.toThrow()
  })

  it('throws when query rejects', async () => {
    const query = vi.fn().mockRejectedValue(new Error('connection refused'))
    const loader = createDbLoader({ query, rules: {} })

    await expect(loader.load()).rejects.toThrow('connection refused')
  })

  it('throws when a fieldRule has no matching registry entry', async () => {
    const raw = {
      id:            'docs',
      defaultEffect: 'allow' as const,
      rules:         [],
      fieldRules:    [{ id: 'missing-rule', expose: ['id'], redact: [] }],
    }
    const query = vi.fn().mockResolvedValue(raw)
    const loader = createDbLoader({ query, rules: {} })

    await expect(loader.load()).rejects.toThrow('missing-rule')
  })
})

// ─── watch() / polling ────────────────────────────────────────────────────────

describe('watch()', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('calls the callback after each poll interval', async () => {
    const query = vi.fn().mockResolvedValue(minimalPolicy)
    const loader = createDbLoader({ query, rules: {}, pollInterval: 5_000 })
    const callback = vi.fn()

    loader.watch!(callback)

    await vi.advanceTimersByTimeAsync(5_000)

    expect(callback).toHaveBeenCalledOnce()
  })

  it('callback receives the loaded policy', async () => {
    const query = vi.fn().mockResolvedValue(minimalPolicy)
    const loader = createDbLoader({ query, rules: {}, pollInterval: 1_000 })

    const received: string[] = []
    loader.watch!(policy => { received.push(policy.id) })

    await vi.advanceTimersByTimeAsync(1_000)

    expect(received).toEqual(['documents'])
  })

  it('polls repeatedly on each interval', async () => {
    const query = vi.fn().mockResolvedValue(minimalPolicy)
    const loader = createDbLoader({ query, rules: {}, pollInterval: 1_000 })
    const callback = vi.fn()

    loader.watch!(callback)

    await vi.advanceTimersByTimeAsync(3_000)

    expect(callback).toHaveBeenCalledTimes(3)
  })

  it('uses the default 30s poll interval when not configured', async () => {
    const query = vi.fn().mockResolvedValue(minimalPolicy)
    const loader = createDbLoader({ query, rules: {} })
    const callback = vi.fn()

    loader.watch!(callback)

    await vi.advanceTimersByTimeAsync(29_999)
    expect(callback).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(callback).toHaveBeenCalledOnce()
  })

  it('swallows query errors during polling — does not crash the interval', async () => {
    const query = vi.fn()
      .mockRejectedValueOnce(new Error('transient failure'))
      .mockResolvedValue(minimalPolicy)
    const loader = createDbLoader({ query, rules: {}, pollInterval: 1_000 })
    const callback = vi.fn()

    loader.watch!(callback)

    await vi.advanceTimersByTimeAsync(1_000)
    expect(callback).not.toHaveBeenCalled()   // first poll failed — swallowed

    await vi.advanceTimersByTimeAsync(1_000)
    expect(callback).toHaveBeenCalledOnce()   // second poll succeeded
  })
})

// ─── Integration ──────────────────────────────────────────────────────────────

describe('integration with createAuthEngine', () => {
  it('loaded policy evaluates correctly', async () => {
    const query = vi.fn().mockResolvedValue(policyWithRules)
    const loader = createDbLoader<User, Doc>({ query, rules: baseRegistry })
    const engine = createAuthEngine({ policy: await loader.load() })

    expect(await engine.can(user({ id: 'u1' }), doc({ ownerId: 'u1' }), 'read')).toBe(true)
    expect(await engine.can(user({ id: 'u1' }), doc({ ownerId: 'u2' }), 'read')).toBe(false)
  })
})

// ─── fromLoader integration ───────────────────────────────────────────────────

describe('fromLoader with createDbLoader', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('creates a working engine from a DB query', async () => {
    const query = vi.fn().mockResolvedValue(policyWithRules)
    const loader = createDbLoader<User, Doc>({ query, rules: baseRegistry })
    const engine = createAuthEngine({ policy: await fromLoader(loader) })

    expect(await engine.can(user({ id: 'u1' }), doc({ ownerId: 'u1' }), 'read')).toBe(true)
    expect(await engine.can(user({ id: 'u1' }), doc({ ownerId: 'u2' }), 'read')).toBe(false)
  })
})
