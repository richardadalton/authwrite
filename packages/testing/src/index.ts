import type {
  AuthEngine,
  AuthObserver,
  DecisionEvent,
  Decision,
  PolicyDefinition,
  Subject,
  Resource,
} from '@authwrite/core'

// ─── DecisionRecorder ────────────────────────────────────────────────────────

export interface DecisionRecorder extends AuthObserver {
  /** All decision events recorded so far, in order. */
  all(): DecisionEvent[]
  /** Shorthand — just the Decision objects, without the wrapping event. */
  decisions(): Decision[]
  /** Clear all recorded events. */
  clear(): void
}

export function decisionRecorder(): DecisionRecorder {
  const events: DecisionEvent[] = []

  return {
    onDecision(event) {
      events.push(event)
    },
    all() {
      return [...events]
    },
    decisions() {
      return events.map(e => e.decision)
    },
    clear() {
      events.length = 0
    },
  }
}

// ─── CoverageReport ──────────────────────────────────────────────────────────

export interface CoverageReport {
  totalRules: number
  coveredRules: string[]
  untouchedRules: string[]
  coveragePercent: number
}

/**
 * Analyse which rules in the engine's active policy were never the deciding
 * reason in any recorded event. Pass `recorder.all()` as the second argument.
 *
 * An untouched rule is a silent security hole — if a deny rule has never fired
 * in your test suite, you have no evidence it works.
 */
export function coverageReport<S extends Subject = Subject, R extends Resource = Resource>(
  engine: AuthEngine<S, R>,
  events: DecisionEvent[]
): CoverageReport {
  const policy = engine.getPolicy()
  if (!policy) {
    throw new Error(
      'coverageReport requires a static policy — engine has a dynamic or composite resolver. ' +
      'Run at least one evaluation first, or pass a static PolicyDefinition to createAuthEngine.'
    )
  }
  const allRuleIds = policy.rules.map(r => r.id)
  const reasonsHit = new Set(events.map(e => e.decision.reason))

  const coveredRules = allRuleIds.filter(id => reasonsHit.has(id))
  const untouchedRules = allRuleIds.filter(id => !reasonsHit.has(id))

  const coveragePercent =
    allRuleIds.length === 0 ? 100 : (coveredRules.length / allRuleIds.length) * 100

  return { totalRules: allRuleIds.length, coveredRules, untouchedRules, coveragePercent }
}
