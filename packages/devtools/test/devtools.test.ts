import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { DevToolsObserver, createDevServer } from '@daltonr/authwrite-devtools'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { DecisionEvent } from '@daltonr/authwrite-core'

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

  it('preserves suspended override', () => {
    observer.onDecision(makeEvent({ allowed: false, effect: 'allow', override: 'suspended' }))
    const [d] = observer.getBuffer()
    expect(d.override).toBe('suspended')
    expect(d.effect).toBe('allow')
    expect(d.allowed).toBe(false)
  })

  it('preserves lockdown override', () => {
    observer.onDecision(makeEvent({ allowed: false, effect: 'deny', override: 'lockdown' }))
    const [d] = observer.getBuffer()
    expect(d.override).toBe('lockdown')
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

// ─── GET /policies ────────────────────────────────────────────────────────────

describe('GET /policies', () => {
  let tmpDir: string
  let server: ReturnType<typeof createDevServer>
  let baseUrl: string

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'aw-devtools-test-'))
    const observer = new DevToolsObserver()
    server  = createDevServer({ observer, port: 15099, policies: { dir: tmpDir, onApply: async () => {} } })
    await server.start()
    baseUrl = server.url
  })

  afterEach(async () => {
    try { await server.stop() } catch { /* already stopped in test */ }
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('returns configured:true and lists yaml/yml/json files', async () => {
    writeFileSync(join(tmpDir, 'policy-a.yaml'), 'id: a\ndefaultEffect: deny\nrules: []')
    writeFileSync(join(tmpDir, 'policy-b.yml'),  'id: b\ndefaultEffect: allow\nrules: []')
    writeFileSync(join(tmpDir, 'notes.txt'), 'not a policy')

    const res  = await fetch(`${baseUrl}/policies`)
    const body = await res.json() as { configured: boolean; files: string[] }

    expect(body.configured).toBe(true)
    expect(body.files).toContain('policy-a.yaml')
    expect(body.files).toContain('policy-b.yml')
    expect(body.files).not.toContain('notes.txt')
  })

  it('returns configured:false and empty files when policies option is not set', async () => {
    await server.stop()
    const observer2 = new DevToolsObserver()
    const bare = createDevServer({ observer: observer2, port: 15098 })
    await bare.start()
    try {
      const res  = await fetch(`${bare.url}/policies`)
      const body = await res.json() as { configured: boolean; files: string[] }
      expect(body.configured).toBe(false)
      expect(body.files).toEqual([])
    } finally {
      await bare.stop()
    }
  })

  it('returns an empty files array when the directory is empty', async () => {
    const res  = await fetch(`${baseUrl}/policies`)
    const body = await res.json() as { configured: boolean; files: string[] }
    expect(body.configured).toBe(true)
    expect(body.files).toEqual([])
  })
})

// ─── POST /policies/apply ─────────────────────────────────────────────────────

describe('POST /policies/apply', () => {
  let tmpDir: string
  let server: ReturnType<typeof createDevServer>
  let baseUrl: string
  let onApply: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    tmpDir  = mkdtempSync(join(tmpdir(), 'aw-devtools-test-'))
    onApply = vi.fn().mockResolvedValue(undefined)
    writeFileSync(join(tmpDir, 'policy-v2.yaml'), 'id: v2\ndefaultEffect: allow\nrules: []')
    const observer = new DevToolsObserver()
    server  = createDevServer({ observer, port: 15097, policies: { dir: tmpDir, onApply } })
    await server.start()
    baseUrl = server.url
  })

  afterEach(async () => {
    try { await server.stop() } catch { /* already stopped in test */ }
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('calls onApply with the full path and returns ok:true', async () => {
    const res  = await fetch(`${baseUrl}/policies/apply`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ file: 'policy-v2.yaml' }),
    })
    const body = await res.json() as { ok: boolean; file: string }

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.file).toBe('policy-v2.yaml')
    expect(onApply).toHaveBeenCalledWith(join(tmpDir, 'policy-v2.yaml'))
  })

  it('returns 400 when file contains path traversal', async () => {
    const res = await fetch(`${baseUrl}/policies/apply`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ file: '../secrets.yaml' }),
    })
    expect(res.status).toBe(400)
    expect(onApply).not.toHaveBeenCalled()
  })

  it('returns 500 when onApply throws', async () => {
    onApply.mockRejectedValueOnce(new Error('parse error'))
    const res  = await fetch(`${baseUrl}/policies/apply`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ file: 'policy-v2.yaml' }),
    })
    const body = await res.json() as { error: string }
    expect(res.status).toBe(500)
    expect(body.error).toBe('parse error')
  })

  it('returns 400 when policies option is not configured', async () => {
    await server.stop()
    const observer2 = new DevToolsObserver()
    const bare = createDevServer({ observer: observer2, port: 15096 })
    await bare.start()
    try {
      const res = await fetch(`${bare.url}/policies/apply`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ file: 'policy.yaml' }),
      })
      expect(res.status).toBe(400)
    } finally {
      await bare.stop()
    }
  })
})
