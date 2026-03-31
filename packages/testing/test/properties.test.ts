import { describe, it } from 'vitest'
import * as fc from 'fast-check'
import { decisionRecorder, coverageReport } from '@daltonr/authwrite-testing'
import type { AuthEngine, Decision, DecisionEvent, PolicyDefinition } from '@daltonr/authwrite-core'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeDecision(reason: string, allowed: boolean): Decision {
  return {
    allowed,
    effect:      allowed ? 'allow' : 'deny',
    reason,
    policy:      'test@1.0.0',
    context:     { subject: { id: 'u1', roles: [] }, action: 'read' },
    evaluatedAt: new Date(),
    durationMs:  0,
  }
}

function makeEvent(reason: string, allowed: boolean): DecisionEvent {
  return { decision: makeDecision(reason, allowed) }
}

function makeEngine(rules: string[]): AuthEngine {
  const policy: PolicyDefinition = {
    id:            'test',
    defaultEffect: 'deny',
    rules:         rules.map(id => ({ id, match: () => false, allow: ['*'] })),
  }
  return {
    evaluate:     async () => { throw new Error('not needed') },
    evaluateAll:  async () => { throw new Error('not needed') },
    evaluateRead: async () => { throw new Error('not needed') },
    can:          async () => { throw new Error('not needed') },
    reload:       () => {},
    getPolicy:    () => policy,
  }
}

const arbRuleId = fc.string({ minLength: 1, maxLength: 20 })
const arbAllowed = fc.boolean()

// ─── decisionRecorder invariants ─────────────────────────────────────────────

describe('decisionRecorder invariants', () => {
  it('all().length equals the number of recorded events', () => {
    fc.assert(fc.property(
      fc.array(fc.tuple(arbRuleId, arbAllowed), { maxLength: 50 }),
      (events) => {
        const recorder = decisionRecorder()
        for (const [reason, allowed] of events) {
          recorder.onDecision(makeEvent(reason, allowed))
        }
        return recorder.all().length === events.length
      }
    ))
  })

  it('decisions().length always equals all().length', () => {
    fc.assert(fc.property(
      fc.array(fc.tuple(arbRuleId, arbAllowed), { maxLength: 50 }),
      (events) => {
        const recorder = decisionRecorder()
        for (const [reason, allowed] of events) {
          recorder.onDecision(makeEvent(reason, allowed))
        }
        return recorder.all().length === recorder.decisions().length
      }
    ))
  })

  it('events are returned in insertion order', () => {
    fc.assert(fc.property(
      fc.array(arbRuleId, { minLength: 1, maxLength: 20 }),
      (reasons) => {
        const recorder = decisionRecorder()
        for (const reason of reasons) {
          recorder.onDecision(makeEvent(reason, true))
        }
        const returned = recorder.decisions().map(d => d.reason)
        return JSON.stringify(returned) === JSON.stringify(reasons)
      }
    ))
  })

  it('all() returns a snapshot — appending to it does not affect the recorder', () => {
    fc.assert(fc.property(
      fc.array(fc.tuple(arbRuleId, arbAllowed), { maxLength: 20 }),
      (events) => {
        const recorder = decisionRecorder()
        for (const [reason, allowed] of events) {
          recorder.onDecision(makeEvent(reason, allowed))
        }
        const before = recorder.all().length
        recorder.all().push(makeEvent('injected', true))
        return recorder.all().length === before
      }
    ))
  })

  it('after clear(), length is always 0 regardless of prior state', () => {
    fc.assert(fc.property(
      fc.array(fc.tuple(arbRuleId, arbAllowed), { maxLength: 30 }),
      (events) => {
        const recorder = decisionRecorder()
        for (const [reason, allowed] of events) {
          recorder.onDecision(makeEvent(reason, allowed))
        }
        recorder.clear()
        return recorder.all().length === 0 && recorder.decisions().length === 0
      }
    ))
  })

  it('events recorded after clear() are counted correctly', () => {
    fc.assert(fc.property(
      fc.array(fc.tuple(arbRuleId, arbAllowed), { maxLength: 20 }),
      fc.array(fc.tuple(arbRuleId, arbAllowed), { maxLength: 20 }),
      (before, after) => {
        const recorder = decisionRecorder()
        for (const [reason, allowed] of before) {
          recorder.onDecision(makeEvent(reason, allowed))
        }
        recorder.clear()
        for (const [reason, allowed] of after) {
          recorder.onDecision(makeEvent(reason, allowed))
        }
        return recorder.all().length === after.length
      }
    ))
  })
})

// ─── coverageReport invariants ────────────────────────────────────────────────

describe('coverageReport invariants', () => {
  it('totalRules always equals the number of rules in the policy', () => {
    fc.assert(fc.property(
      fc.array(arbRuleId, { maxLength: 20 }),
      (ruleIds) => {
        const engine = makeEngine(ruleIds)
        const report = coverageReport(engine, [])
        return report.totalRules === ruleIds.length
      }
    ))
  })

  it('coveredRules and untouchedRules together equal all rule IDs', () => {
    fc.assert(fc.property(
      fc.uniqueArray(arbRuleId, { maxLength: 15 }),
      fc.array(fc.tuple(arbRuleId, arbAllowed), { maxLength: 30 }),
      (ruleIds, rawEvents) => {
        const engine = makeEngine(ruleIds)
        // Only emit events for reasons that exist in the policy
        const events = rawEvents
          .filter(([reason]) => ruleIds.includes(reason))
          .map(([reason, allowed]) => makeEvent(reason, allowed))

        const report = coverageReport(engine, events)
        const allIds = new Set(ruleIds)
        const reportedIds = new Set([...report.coveredRules, ...report.untouchedRules])

        return (
          allIds.size === reportedIds.size &&
          [...allIds].every(id => reportedIds.has(id))
        )
      }
    ))
  })

  it('coveredRules and untouchedRules are disjoint', () => {
    fc.assert(fc.property(
      fc.uniqueArray(arbRuleId, { maxLength: 15 }),
      fc.array(fc.tuple(arbRuleId, arbAllowed), { maxLength: 30 }),
      (ruleIds, rawEvents) => {
        const engine = makeEngine(ruleIds)
        const events = rawEvents
          .filter(([reason]) => ruleIds.includes(reason))
          .map(([reason, allowed]) => makeEvent(reason, allowed))

        const report = coverageReport(engine, events)
        const coveredSet = new Set(report.coveredRules)
        return report.untouchedRules.every(id => !coveredSet.has(id))
      }
    ))
  })

  it('coveragePercent is always between 0 and 100 inclusive', () => {
    fc.assert(fc.property(
      fc.uniqueArray(arbRuleId, { maxLength: 15 }),
      fc.array(fc.tuple(arbRuleId, arbAllowed), { maxLength: 30 }),
      (ruleIds, rawEvents) => {
        const engine = makeEngine(ruleIds)
        const events = rawEvents
          .filter(([reason]) => ruleIds.includes(reason))
          .map(([reason, allowed]) => makeEvent(reason, allowed))

        const { coveragePercent } = coverageReport(engine, events)
        return coveragePercent >= 0 && coveragePercent <= 100
      }
    ))
  })

  it('coveragePercent equals (coveredRules / totalRules) * 100 when totalRules > 0', () => {
    fc.assert(fc.property(
      fc.uniqueArray(arbRuleId, { minLength: 1, maxLength: 15 }),
      fc.array(fc.tuple(arbRuleId, arbAllowed), { maxLength: 30 }),
      (ruleIds, rawEvents) => {
        const engine = makeEngine(ruleIds)
        const events = rawEvents
          .filter(([reason]) => ruleIds.includes(reason))
          .map(([reason, allowed]) => makeEvent(reason, allowed))

        const report = coverageReport(engine, events)
        const expected = (report.coveredRules.length / report.totalRules) * 100
        return Math.abs(report.coveragePercent - expected) < 0.001
      }
    ))
  })

  it('a rule hit multiple times counts as covered exactly once', () => {
    fc.assert(fc.property(
      fc.uniqueArray(arbRuleId, { minLength: 1, maxLength: 10 }),
      fc.integer({ min: 2, max: 10 }),
      (ruleIds, hitCount) => {
        const engine = makeEngine(ruleIds)
        // Hit the first rule `hitCount` times
        const events = Array.from({ length: hitCount }, () => makeEvent(ruleIds[0], true))
        const report = coverageReport(engine, events)
        return report.coveredRules.filter(id => id === ruleIds[0]).length === 1
      }
    ))
  })

  it('events with reason "default" do not contribute to rule coverage', () => {
    fc.assert(fc.property(
      fc.uniqueArray(arbRuleId, { minLength: 1, maxLength: 10 }),
      fc.integer({ min: 1, max: 5 }),
      (ruleIds, defaultCount) => {
        const engine = makeEngine(ruleIds)
        const events = Array.from({ length: defaultCount }, () => makeEvent('default', false))
        const report = coverageReport(engine, events)
        return report.coveredRules.length === 0
      }
    ))
  })
})
