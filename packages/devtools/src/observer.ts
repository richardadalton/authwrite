import type { AuthObserver, DecisionEvent, Decision } from '@authwrite/core'

// ─── Serialisable snapshot sent to the browser ───────────────────────────────

export interface PersistedDecision {
  id:          string
  timestamp:   number
  subject:     unknown
  resource:    unknown
  action:      string
  policy:      string
  /** The raw policy effect before any enforcer override. */
  effect:      'allow' | 'deny'
  /** The final outcome after enforcer override (what the app actually saw). */
  allowed:     boolean
  reason:      string
  defaulted:   boolean
  durationMs:  number
  /**
   * Set when an Enforcer changed the outcome.
   *  'permissive' — audit mode allowed despite a policy deny.
   *  'lockdown'   — lockdown mode denied despite a policy allow.
   */
  override?:   'permissive' | 'lockdown'
}

// ─── Flag record written to .authwrite-flags.json ────────────────────────────

export interface DecisionFlag {
  decisionId:  string
  verdict:     'should-allow' | 'should-deny'
  note:        string
  flaggedAt:   number
  decision:    PersistedDecision
}

// ─── Listener ─────────────────────────────────────────────────────────────────

type DecisionListener = (d: PersistedDecision) => void

// ─── Observer ─────────────────────────────────────────────────────────────────

export class DevToolsObserver implements AuthObserver {
  private listeners  = new Set<DecisionListener>()
  private buffer:    PersistedDecision[] = []
  private maxBuffer: number

  constructor(maxBuffer = 500) {
    this.maxBuffer = maxBuffer
  }

  onDecision(event: DecisionEvent): void {
    const d = event.decision
    const persisted = toPersistedDecision(d)

    this.buffer.push(persisted)
    if (this.buffer.length > this.maxBuffer) this.buffer.shift()

    this.listeners.forEach(l => l(persisted))
  }

  /** Returns all buffered decisions (oldest → newest). */
  getBuffer(): PersistedDecision[] {
    return [...this.buffer]
  }

  /** Subscribe to new decisions. Returns an unsubscribe function. */
  subscribe(listener: DecisionListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  clear(): void {
    this.buffer = []
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

let seq = 0

function toPersistedDecision(d: Decision): PersistedDecision {
  return {
    id:         `${d.evaluatedAt.getTime()}-${(++seq).toString(36)}`,
    timestamp:  d.evaluatedAt.getTime(),
    subject:    d.context.subject,
    resource:   d.context.resource,
    action:     d.context.action,
    policy:     d.policy,
    effect:     d.effect,
    allowed:    d.allowed,
    reason:     d.reason,
    defaulted:  d.defaulted ?? false,
    durationMs: d.durationMs,
    override:   d.override,
  }
}
