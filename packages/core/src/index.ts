// ─── Primitives ──────────────────────────────────────────────────────────────

export type Action = string

export type ErrorPhase = 'evaluate' | 'observer' | 'loader'

// ─── Subject ─────────────────────────────────────────────────────────────────

export interface Subject {
  id: string
  roles: string[]
  attributes?: Record<string, unknown>
}

// ─── Resource ────────────────────────────────────────────────────────────────

export interface Resource {
  id: string
  type: string
  ownerId?: string
  attributes?: Record<string, unknown>
}

// ─── AuthContext ──────────────────────────────────────────────────────────────

export interface AuthContext<S extends Subject = Subject, R extends Resource = Resource> {
  subject: S
  resource: R
  action: Action
  env?: {
    ip?: string
    userAgent?: string
    timestamp?: Date
    [key: string]: unknown
  }
}

// ─── Decision ────────────────────────────────────────────────────────────────

export interface Decision {
  allowed: boolean
  effect: 'allow' | 'deny'
  /** The rule.id that determined the outcome, or 'default' when no rule matched. */
  reason: string
  rule?: PolicyRule
  /** policy.id + version, e.g. "document-access@2.1.0" */
  policy: string
  context: AuthContext
  evaluatedAt: Date
  durationMs: number
  /** true when no rule matched and defaultEffect was applied */
  defaulted?: boolean
  /** present when evaluation threw and onError fired */
  error?: Error
}

// ─── Policy rules ────────────────────────────────────────────────────────────

export interface PolicyRule<S extends Subject = Subject, R extends Resource = Resource> {
  id: string
  description?: string
  /** Higher number wins. Default: 0. Deny at higher priority reliably beats allow. */
  priority?: number
  match: (ctx: AuthContext<S, R>) => boolean
  /** Actions this rule allows. '*' means all actions. */
  allow?: Action[]
  /** Actions this rule denies. Deny always beats allow at the same priority. */
  deny?: Action[]
  /** Secondary condition that must be true for the rule to apply. */
  condition?: (ctx: AuthContext<S, R>) => boolean
}

export interface FieldRule<S extends Subject = Subject, R extends Resource = Resource> {
  id: string
  match: (ctx: AuthContext<S, R>) => boolean
  /** Fields exposed by this rule. '*' exposes all fields. */
  expose: string[]
  /** Fields redacted by this rule. Wins over expose. */
  redact: string[]
}

// ─── PolicyDefinition ────────────────────────────────────────────────────────

export interface PolicyDefinition<S extends Subject = Subject, R extends Resource = Resource> {
  id: string
  version?: string
  description?: string
  /** The effect applied when no rule matches. 'deny' is the safe default. */
  defaultEffect: 'allow' | 'deny'
  rules: PolicyRule<S, R>[]
  fieldRules?: FieldRule<S, R>[]
}

// ─── Observers ───────────────────────────────────────────────────────────────

export interface DecisionEvent {
  decision: Decision
  /** Correlation ID from the surrounding request context. */
  traceId?: string
  /** Where the evaluation was triggered from, e.g. 'express-middleware' | 'direct' */
  source?: string
}

export interface AuthObserver {
  onDecision(event: DecisionEvent): void | Promise<void>
  onError?(err: Error, ctx: AuthContext): void
  onPolicyReload?(policy: PolicyDefinition): void
}

// ─── Policy loaders ──────────────────────────────────────────────────────────

export interface PolicyLoader<S extends Subject = Subject, R extends Resource = Resource> {
  load(): Promise<PolicyDefinition<S, R>>
  /** Optional — enables hot reload without process restart. */
  watch?(cb: (policy: PolicyDefinition<S, R>) => void): void
}

// ─── Engine ──────────────────────────────────────────────────────────────────

export interface AuthEngineConfig<S extends Subject = Subject, R extends Resource = Resource> {
  /** Provide a static policy or a loader — not both. */
  policy?: PolicyDefinition<S, R>
  loader?: PolicyLoader<S, R>
  observers?: AuthObserver[]
  /** What to do when evaluation throws. 'deny' is the safe default. */
  onError?: 'deny' | 'allow'
}

export interface EvaluateAllInput<S extends Subject = Subject, R extends Resource = Resource> {
  subject: S
  resource: R
  actions: Action[]
  env?: AuthContext['env']
}

export interface EvaluateReadInput<S extends Subject = Subject, R extends Resource = Resource> {
  subject: S
  resource: R
  env?: AuthContext['env']
}

export interface EvaluateReadResult {
  decision: Decision
  allowedFields: string[]
}

export interface AuthEngine<S extends Subject = Subject, R extends Resource = Resource> {
  evaluate(ctx: AuthContext<S, R>): Promise<Decision>
  evaluateAll(input: EvaluateAllInput<S, R>): Promise<Record<Action, Decision>>
  evaluateRead(input: EvaluateReadInput<S, R>): Promise<EvaluateReadResult>
  can(subject: S, resource: R, action: Action): Promise<boolean>
  /** Replace the active policy immediately (called by loaders on hot reload). */
  reload(policy: PolicyDefinition<S, R>): void
}

// ─── Factory ─────────────────────────────────────────────────────────────────

export function createAuthEngine<S extends Subject = Subject, R extends Resource = Resource>(
  _config: AuthEngineConfig<S, R>
): AuthEngine<S, R> {
  throw new Error('Not implemented')
}

// ─── Utilities ───────────────────────────────────────────────────────────────

/**
 * Filter an object to only the fields permitted by evaluateRead().
 * Pass the allowedFields array from EvaluateReadResult.
 */
export function applyFieldFilter<T extends Record<string, unknown>>(
  obj: T,
  allowedFields: string[]
): Partial<T> {
  const result: Partial<T> = {}
  for (const key of allowedFields) {
    if (key in obj) {
      result[key as keyof T] = obj[key as keyof T]
    }
  }
  return result
}
