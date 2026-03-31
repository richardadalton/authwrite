import { describe, it, expect, beforeEach } from 'vitest'
import { decisionRecorder, coverageReport } from '@daltonr/authwrite-testing'
import type { AuthEngine, Decision, DecisionEvent, PolicyDefinition } from '@daltonr/authwrite-core'

// ─── Test fixtures ────────────────────────────────────────────────────────────

function makeDecision(reason: string, allowed = true): Decision {
  return {
    allowed,
    effect: allowed ? 'allow' : 'deny',
    reason,
    policy: 'test-policy@1.0.0',
    context: {
      subject: { id: 'u1', roles: [] },
      resource: { type: 'doc', id: 'r1' },
      action: 'read',
    },
    evaluatedAt: new Date(),
    durationMs: 1,
  }
}

function makeEvent(reason: string, allowed = true, traceId?: string): DecisionEvent {
  return { decision: makeDecision(reason, allowed), traceId }
}

function makeEngine(policy: PolicyDefinition): AuthEngine {
  return {
    evaluate:     async () => { throw new Error('not needed in this test') },
    evaluateAll:  async () => { throw new Error('not needed in this test') },
    evaluateRead: async () => { throw new Error('not needed in this test') },
    can:          async (_subject, _resource, _action) => { throw new Error('not needed in this test') },
    reload:       () => {},
    getPolicy:    () => policy,
  }
}

const threeRulePolicy: PolicyDefinition = {
  id: 'test-policy',
  version: '1.0.0',
  defaultEffect: 'deny',
  rules: [
    { id: 'owner-access',    match: () => false, allow: ['*'] },
    { id: 'editor-access',   match: () => false, allow: ['read'] },
    { id: 'archived-blocks', match: () => false, deny:  ['write'] },
  ],
}

// ─── decisionRecorder ─────────────────────────────────────────────────────────

describe('decisionRecorder', () => {
  it('starts empty', () => {
    const recorder = decisionRecorder()
    expect(recorder.all()).toEqual([])
    expect(recorder.decisions()).toEqual([])
  })

  it('records events in order', () => {
    const recorder = decisionRecorder()
    const e1 = makeEvent('owner-access', true)
    const e2 = makeEvent('archived-blocks', false)

    recorder.onDecision(e1)
    recorder.onDecision(e2)

    expect(recorder.all()).toEqual([e1, e2])
  })

  it('decisions() returns only the Decision objects', () => {
    const recorder = decisionRecorder()
    recorder.onDecision(makeEvent('owner-access'))
    recorder.onDecision(makeEvent('editor-access', false))

    const decisions = recorder.decisions()
    expect(decisions).toHaveLength(2)
    expect(decisions[0].reason).toBe('owner-access')
    expect(decisions[1].reason).toBe('editor-access')
  })

  it('all() returns a snapshot — mutations to the result do not affect the recorder', () => {
    const recorder = decisionRecorder()
    recorder.onDecision(makeEvent('owner-access'))

    const snapshot = recorder.all()
    snapshot.push(makeEvent('editor-access'))

    expect(recorder.all()).toHaveLength(1)
  })

  it('clear() empties the recorder', () => {
    const recorder = decisionRecorder()
    recorder.onDecision(makeEvent('owner-access'))
    recorder.onDecision(makeEvent('editor-access'))

    recorder.clear()

    expect(recorder.all()).toEqual([])
    expect(recorder.decisions()).toEqual([])
  })

  it('records events after a clear()', () => {
    const recorder = decisionRecorder()
    recorder.onDecision(makeEvent('owner-access'))
    recorder.clear()

    const e = makeEvent('archived-blocks', false)
    recorder.onDecision(e)

    expect(recorder.all()).toEqual([e])
  })

  it('preserves traceId and other event fields', () => {
    const recorder = decisionRecorder()
    recorder.onDecision(makeEvent('owner-access', true, 'trace-abc'))

    expect(recorder.all()[0].traceId).toBe('trace-abc')
  })
})

// ─── coverageReport ───────────────────────────────────────────────────────────

describe('coverageReport', () => {
  it('all rules are untouched when no events have been recorded', () => {
    const engine = makeEngine(threeRulePolicy)
    const report = coverageReport(engine, [])

    expect(report.totalRules).toBe(3)
    expect(report.coveredRules).toEqual([])
    expect(report.untouchedRules).toEqual(['owner-access', 'editor-access', 'archived-blocks'])
    expect(report.coveragePercent).toBe(0)
  })

  it('all rules are covered when every rule has been the deciding reason', () => {
    const engine = makeEngine(threeRulePolicy)
    const events = [
      makeEvent('owner-access'),
      makeEvent('editor-access'),
      makeEvent('archived-blocks', false),
    ]
    const report = coverageReport(engine, events)

    expect(report.totalRules).toBe(3)
    expect(report.coveredRules).toEqual(['owner-access', 'editor-access', 'archived-blocks'])
    expect(report.untouchedRules).toEqual([])
    expect(report.coveragePercent).toBe(100)
  })

  it('reports partial coverage correctly', () => {
    const engine = makeEngine(threeRulePolicy)
    const events = [makeEvent('owner-access'), makeEvent('editor-access')]
    const report = coverageReport(engine, events)

    expect(report.coveredRules).toEqual(['owner-access', 'editor-access'])
    expect(report.untouchedRules).toEqual(['archived-blocks'])
    expect(report.coveragePercent).toBeCloseTo(66.67, 1)
  })

  it('a rule hit multiple times counts as covered once', () => {
    const engine = makeEngine(threeRulePolicy)
    const events = [
      makeEvent('owner-access'),
      makeEvent('owner-access'),
      makeEvent('owner-access'),
    ]
    const report = coverageReport(engine, events)

    expect(report.coveredRules).toEqual(['owner-access'])
    expect(report.coveredRules).toHaveLength(1)
  })

  it('default-deny decisions (reason: "default") do not count toward rule coverage', () => {
    const engine = makeEngine(threeRulePolicy)
    const events = [makeEvent('default', false)]
    const report = coverageReport(engine, events)

    expect(report.coveredRules).toEqual([])
    expect(report.untouchedRules).toHaveLength(3)
  })

  it('returns 100% coverage for a policy with no rules', () => {
    const emptyPolicy: PolicyDefinition = {
      id: 'empty',
      defaultEffect: 'deny',
      rules: [],
    }
    const engine = makeEngine(emptyPolicy)
    const report = coverageReport(engine, [])

    expect(report.totalRules).toBe(0)
    expect(report.coveragePercent).toBe(100)
  })

  it('preserves rule order in coveredRules and untouchedRules', () => {
    const engine = makeEngine(threeRulePolicy)
    // Hit rules out of order
    const events = [makeEvent('archived-blocks', false), makeEvent('owner-access')]
    const report = coverageReport(engine, events)

    expect(report.coveredRules).toEqual(['owner-access', 'archived-blocks'])
    expect(report.untouchedRules).toEqual(['editor-access'])
  })
})
