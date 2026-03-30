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
  type: string
  /** Present for instance actions (read, update, delete).
   *  Absent for type actions (create) and subject actions (change-password). */
  id?: string
  ownerId?: string
  attributes?: Record<string, unknown>
}

// ─── AuthContext ──────────────────────────────────────────────────────────────
//
// Three distinct action categories are expressed through this single type:
//
//   Instance action  — subject + resource (with id) + action  → read, update, delete
//   Type action      — subject + resource (no id)   + action  → create
//   Subject action   — subject                      + action  → change-password
//
// Rules receive whichever shape was passed and should guard accordingly.

export interface AuthContext<S extends Subject = Subject, R extends Resource = Resource> {
  subject: S
  /** Absent for subject actions (change-password, logout, etc.) */
  resource?: R
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
  /** Set when an Enforcer overrode the policy decision.
   *  'permissive' — audit mode allowed despite a policy deny.
   *  'lockdown'   — lockdown mode denied despite a policy allow. */
  override?: 'permissive' | 'lockdown'
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

// ─── AuthEvaluator ───────────────────────────────────────────────────────────
//
// The shared interface implemented by both AuthEngine and Enforcer.
// Framework adapters accept this — they don't need to know which they're talking to.

export interface AuthEvaluator<S extends Subject = Subject, R extends Resource = Resource> {
  evaluate(ctx: AuthContext<S, R>): Promise<Decision>
  /** Batch-evaluate multiple actions against the same subject and resource.
   *  resource is optional — omit for subject-level actions. */
  evaluateAll(input: EvaluateAllInput<S, R>): Promise<Record<Action, Decision>>
  /** Evaluate a read and compute which fields the subject is permitted to see. */
  evaluateRead(input: EvaluateReadInput<S, R>): Promise<EvaluateReadResult>
  /** Convenience boolean. Pass undefined for resource when not applicable. */
  can(subject: S, resource: R | undefined, action: Action): Promise<boolean>
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

export interface AuthEngine<S extends Subject = Subject, R extends Resource = Resource>
  extends AuthEvaluator<S, R> {
  /** Replace the active policy immediately (called by loaders on hot reload). */
  reload(policy: PolicyDefinition<S, R>): void
  /** Returns the currently active policy. */
  getPolicy(): PolicyDefinition<S, R>
}

// ─── Enforcer ────────────────────────────────────────────────────────────────

export type EnforcerMode = 'audit' | 'enforce' | 'lockdown'

export interface Enforcer<S extends Subject = Subject, R extends Resource = Resource>
  extends AuthEvaluator<S, R> {
  readonly mode: EnforcerMode
  /** Switch mode in-flight without recreating the enforcer or the engine. */
  setMode(mode: EnforcerMode): void
}

// ─── Input / output shapes ───────────────────────────────────────────────────

export interface EvaluateAllInput<S extends Subject = Subject, R extends Resource = Resource> {
  subject: S
  /** Omit for subject-level actions. */
  resource?: R
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

// ─── Factory ─────────────────────────────────────────────────────────────────

export function createAuthEngine<S extends Subject = Subject, R extends Resource = Resource>(
  config: AuthEngineConfig<S, R>
): AuthEngine<S, R> {
  if (!config.policy && !config.loader) {
    throw new Error('createAuthEngine requires either a policy or a loader')
  }

  let activePolicy: PolicyDefinition<S, R> = config.policy!
  // TODO: initialise from loader when policy is absent

  // ─── Helpers ──────────────────────────────────────────────────────────────

  function policyLabel(): string {
    return activePolicy.version
      ? `${activePolicy.id}@${activePolicy.version}`
      : activePolicy.id
  }

  function appliesToAction(actions: Action[] | undefined, action: Action): boolean {
    if (!actions || actions.length === 0) return false
    return actions.includes('*') || actions.includes(action)
  }

  function highestPriority(
    rules: PolicyRule<S, R>[]
  ): PolicyRule<S, R> | undefined {
    if (rules.length === 0) return undefined
    return rules.reduce((best, rule) =>
      (rule.priority ?? 0) > (best.priority ?? 0) ? rule : best
    )
  }

  // ─── Core evaluation (sync, throws on rule errors) ────────────────────────

  function evaluateSync(ctx: AuthContext<S, R>): Decision {
    const start = Date.now()
    const denyCandidates: PolicyRule<S, R>[] = []
    const allowCandidates: PolicyRule<S, R>[] = []

    for (const rule of activePolicy.rules) {
      if (!rule.match(ctx)) continue
      if (rule.condition && !rule.condition(ctx)) continue

      if (appliesToAction(rule.deny,  ctx.action)) denyCandidates.push(rule)
      if (appliesToAction(rule.allow, ctx.action)) allowCandidates.push(rule)
    }

    const bestDeny  = highestPriority(denyCandidates)
    const bestAllow = highestPriority(allowCandidates)

    let allowed: boolean
    let reason: string
    let decidingRule: PolicyRule<S, R> | undefined
    let defaulted: true | undefined

    if (!bestDeny && !bestAllow) {
      allowed  = activePolicy.defaultEffect === 'allow'
      reason   = 'default'
      defaulted = true
    } else if (
      bestDeny &&
      (!bestAllow || (bestDeny.priority ?? 0) >= (bestAllow.priority ?? 0))
    ) {
      // Deny wins: higher priority, or equal priority (deny-beats-allow)
      allowed      = false
      reason       = bestDeny.id
      decidingRule = bestDeny
    } else {
      allowed      = true
      reason       = bestAllow!.id
      decidingRule = bestAllow
    }

    return {
      allowed,
      effect:      allowed ? 'allow' : 'deny',
      reason,
      rule:        decidingRule as PolicyRule | undefined,
      policy:      policyLabel(),
      context:     ctx,
      evaluatedAt: new Date(),
      durationMs:  Date.now() - start,
      defaulted,
    }
  }

  // ─── Field filtering ──────────────────────────────────────────────────────

  function computeAllowedFields(
    fieldRules: FieldRule<S, R>[],
    ctx: AuthContext<S, R>,
    resource: R
  ): string[] {
    if (fieldRules.length === 0) return Object.keys(resource)

    const exposed  = new Set<string>()
    const redacted = new Set<string>()
    let   exposeAll = false

    for (const rule of fieldRules) {
      if (!rule.match(ctx)) continue

      if (rule.expose.includes('*')) {
        exposeAll = true
      } else {
        for (const f of rule.expose) exposed.add(f)
      }
      for (const f of rule.redact) redacted.add(f)
    }

    const base = exposeAll ? Object.keys(resource) : [...exposed]
    return base.filter(f => !redacted.has(f))
  }

  // ─── Observer dispatch ────────────────────────────────────────────────────

  async function fireObservers(event: DecisionEvent): Promise<void> {
    for (const observer of config.observers ?? []) {
      await observer.onDecision(event)
    }
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  async function evaluate(ctx: AuthContext<S, R>): Promise<Decision> {
    let decision: Decision

    try {
      decision = evaluateSync(ctx)
    } catch (err) {
      const onError = config.onError ?? 'deny'
      decision = {
        allowed:     onError === 'allow',
        effect:      onError === 'allow' ? 'allow' : 'deny',
        reason:      'error',
        policy:      policyLabel(),
        context:     ctx,
        evaluatedAt: new Date(),
        durationMs:  0,
        error:       err instanceof Error ? err : new Error(String(err)),
      }
    }

    await fireObservers({ decision })
    return decision
  }

  async function evaluateAll(
    input: EvaluateAllInput<S, R>
  ): Promise<Record<Action, Decision>> {
    const results: Record<Action, Decision> = {}
    for (const action of input.actions) {
      results[action] = await evaluate({
        subject:  input.subject,
        resource: input.resource,
        action,
        env:      input.env,
      })
    }
    return results
  }

  async function evaluateRead(
    input: EvaluateReadInput<S, R>
  ): Promise<EvaluateReadResult> {
    const ctx: AuthContext<S, R> = {
      subject:  input.subject,
      resource: input.resource,
      action:   'read',
      env:      input.env,
    }

    const decision = await evaluate(ctx)

    if (!decision.allowed) {
      return { decision, allowedFields: [] }
    }

    const allowedFields = computeAllowedFields(
      activePolicy.fieldRules ?? [],
      ctx,
      input.resource
    )
    return { decision, allowedFields }
  }

  async function can(
    subject: S,
    resource: R | undefined,
    action: Action
  ): Promise<boolean> {
    const decision = await evaluate({ subject, resource, action })
    return decision.allowed
  }

  function reload(policy: PolicyDefinition<S, R>): void {
    activePolicy = policy
    for (const observer of config.observers ?? []) {
      observer.onPolicyReload?.(policy as PolicyDefinition)
    }
  }

  function getPolicy(): PolicyDefinition<S, R> {
    return activePolicy
  }

  return { evaluate, evaluateAll, evaluateRead, can, reload, getPolicy }
}

export function createEnforcer<S extends Subject = Subject, R extends Resource = Resource>(
  engine: AuthEngine<S, R>,
  config: { mode: EnforcerMode }
): Enforcer<S, R> {
  let currentMode: EnforcerMode = config.mode

  // ─── Override logic ───────────────────────────────────────────────────────
  //
  // The engine always evaluates honestly and fires its observers with the real
  // decision. The enforcer inspects the returned decision and, based on the
  // current mode, may override allowed/effect before returning to the caller.
  //
  // Observers see truth. Callers see the enforcer's answer.

  function applyMode(decision: Decision): Decision {
    if (currentMode === 'audit' && !decision.allowed) {
      return { ...decision, allowed: true, effect: 'allow', override: 'permissive' }
    }
    if (currentMode === 'lockdown' && decision.allowed) {
      return { ...decision, allowed: false, effect: 'deny', override: 'lockdown' }
    }
    return decision
  }

  // ─── AuthEvaluator implementation ─────────────────────────────────────────

  async function evaluate(ctx: AuthContext<S, R>): Promise<Decision> {
    return applyMode(await engine.evaluate(ctx))
  }

  async function evaluateAll(
    input: EvaluateAllInput<S, R>
  ): Promise<Record<Action, Decision>> {
    const raw = await engine.evaluateAll(input)
    const result: Record<Action, Decision> = {}
    for (const [action, decision] of Object.entries(raw)) {
      result[action] = applyMode(decision)
    }
    return result
  }

  async function evaluateRead(
    input: EvaluateReadInput<S, R>
  ): Promise<EvaluateReadResult> {
    const raw = await engine.evaluateRead(input)
    const decision = applyMode(raw.decision)

    if (!decision.allowed) {
      return { decision, allowedFields: [] }
    }

    // Audit mode overrode a deny: the engine returned [] because it denied the
    // read. Since we're saying it's allowed, return all fields on the resource —
    // the developer sees what would have been blocked without the app breaking.
    if (raw.decision.allowed === false) {
      return { decision, allowedFields: Object.keys(input.resource) }
    }

    return { decision, allowedFields: raw.allowedFields }
  }

  async function can(
    subject: S,
    resource: R | undefined,
    action: Action
  ): Promise<boolean> {
    return (await evaluate({ subject, resource, action })).allowed
  }

  // ─── Enforcer-specific ────────────────────────────────────────────────────

  function setMode(mode: EnforcerMode): void {
    currentMode = mode
  }

  return {
    get mode() { return currentMode },
    setMode,
    evaluate,
    evaluateAll,
    evaluateRead,
    can,
  }
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
