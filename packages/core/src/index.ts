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
  action: string
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
  /** Set when the engine's mode overrode the policy decision.
   *  'permissive' — audit mode allowed despite a policy deny.
   *  'suspended'  — suspended mode denied despite a policy allow (policy still evaluated).
   *  'lockdown'   — lockdown mode denied without evaluating the policy at all. */
  override?: 'permissive' | 'suspended' | 'lockdown'
  /** present when evaluation threw and onError fired */
  error?: Error
}

// ─── Policy rules ────────────────────────────────────────────────────────────
//
// The third generic A constrains the action names that appear in allow/deny
// arrays. When you define PolicyDefinition<User, Doc, 'read' | 'write'>,
// specifying allow: ['wrtie'] is a type error.

export interface PolicyRule<
  S extends Subject = Subject,
  R extends Resource = Resource,
  A extends string = string,
> {
  id: string
  description?: string
  /** Higher number wins. Default: 0. Deny at higher priority reliably beats allow. */
  priority?: number
  match: (ctx: AuthContext<S, R>) => boolean
  /** Actions this rule allows. '*' covers all actions. */
  allow?: (A | '*')[]
  /** Actions this rule denies. Deny always beats allow at the same priority. */
  deny?: (A | '*')[]
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

export interface PolicyDefinition<
  S extends Subject = Subject,
  R extends Resource = Resource,
  A extends string = string,
> {
  id: string
  version?: string
  description?: string
  /** The effect applied when no rule matches. 'deny' is the safe default. */
  defaultEffect: 'allow' | 'deny'
  rules: PolicyRule<S, R, A>[]
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

// ─── PolicyResolver ───────────────────────────────────────────────────────────
//
// A PolicyResolver tells the engine where to get the policy for each evaluation.
// Three forms are supported:
//
//   Static    — a PolicyDefinition object: the same policy is used for every call.
//   Dynamic   — a function: called on every evaluation, may return different policies
//               based on context (tenant, feature flag, environment, etc.).
//   Composite — intersect / union / firstMatch: combines multiple resolvers into one.
//
// Composition helpers (intersect, union, firstMatch) return a CompositeResolver.
// The fromLoader() helper converts a PolicyLoader into a dynamic resolver.

export type PolicyResolverFn<
  S extends Subject = Subject,
  R extends Resource = Resource,
  A extends string = string,
> = (ctx: AuthContext<S, R>) => PolicyDefinition<S, R, A> | Promise<PolicyDefinition<S, R, A>>

export interface CompositeResolver<
  S extends Subject = Subject,
  R extends Resource = Resource,
  A extends string = string,
> {
  readonly _tag: 'intersect' | 'union' | 'firstMatch'
  readonly resolvers: PolicyResolver<S, R, A>[]
}

export type PolicyResolver<
  S extends Subject = Subject,
  R extends Resource = Resource,
  A extends string = string,
> =
  | PolicyDefinition<S, R, A>
  | PolicyResolverFn<S, R, A>
  | CompositeResolver<S, R, A>

// ─── Pure policy evaluation ───────────────────────────────────────────────────
//
// These helpers live at module scope so evaluatePolicy can be exported as a
// pure function independent of any engine instance.

function getPolicyLabel(policy: PolicyDefinition): string {
  return policy.version
    ? `${policy.id}@${policy.version}`
    : policy.id
}

function appliesToAction(actions: string[] | undefined, action: string): boolean {
  if (!actions || actions.length === 0) return false
  return actions.includes('*') || actions.includes(action)
}

function highestPriority<S extends Subject, R extends Resource>(
  rules: PolicyRule<S, R>[]
): PolicyRule<S, R> | undefined {
  if (rules.length === 0) return undefined
  return rules.reduce((best, rule) =>
    (rule.priority ?? 0) > (best.priority ?? 0) ? rule : best
  )
}

/**
 * Pure policy evaluation — no observers, no mode handling, no engine overhead.
 *
 * Evaluates a resolved `PolicyDefinition` against an `AuthContext` and returns
 * a `Decision`. Throws if any rule function throws.
 *
 * Use this for dry-run checks, unit-testing individual rules, or whenever you
 * have a `PolicyDefinition` in hand and just want to know what the policy says.
 *
 * ```typescript
 * const decision = evaluatePolicy(myPolicy, { subject, resource, action: 'read' })
 * ```
 */
export function evaluatePolicy<
  S extends Subject = Subject,
  R extends Resource = Resource,
>(
  policy: PolicyDefinition<S, R>,
  ctx:    AuthContext<S, R>,
): Decision {
  const start = Date.now()
  const denyCandidates:  PolicyRule<S, R>[] = []
  const allowCandidates: PolicyRule<S, R>[] = []

  for (const rule of policy.rules) {
    if (!rule.match(ctx)) continue
    if (rule.condition && !rule.condition(ctx)) continue

    if (appliesToAction(rule.deny,  ctx.action)) denyCandidates.push(rule)
    if (appliesToAction(rule.allow, ctx.action)) allowCandidates.push(rule)
  }

  const bestDeny  = highestPriority(denyCandidates)
  const bestAllow = highestPriority(allowCandidates)

  let allowed:      boolean
  let reason:       string
  let decidingRule: PolicyRule<S, R> | undefined
  let defaulted:    true | undefined

  if (!bestDeny && !bestAllow) {
    allowed   = policy.defaultEffect === 'allow'
    reason    = 'default'
    defaulted = true
  } else if (
    bestDeny &&
    (!bestAllow || (bestDeny.priority ?? 0) >= (bestAllow.priority ?? 0))
  ) {
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
    policy:      getPolicyLabel(policy),
    context:     ctx,
    evaluatedAt: new Date(),
    durationMs:  Date.now() - start,
    defaulted,
  }
}

// ─── fromLoader ───────────────────────────────────────────────────────────────

/**
 * Converts a `PolicyLoader` into a `PolicyResolverFn`.
 *
 * Loads the policy eagerly, caches it, and wires up the loader's `watch`
 * callback to update the cache on hot-reload. The returned resolver function
 * is synchronous after initialisation — no additional async overhead per call.
 *
 * ```typescript
 * const engine = createAuthEngine({
 *   policy: await fromLoader(createFileLoader({ path, rules })),
 * })
 * ```
 *
 * Pass an optional `onReload` callback to be notified when the watcher fires
 * (e.g. to call `engine.reload()` and trigger `onPolicyReload` observers):
 *
 * ```typescript
 * let notifyReloaded: () => void
 * const ready = new Promise<void>(r => { notifyReloaded = r })
 * const engine = createAuthEngine({
 *   policy: await fromLoader(loader, () => notifyReloaded()),
 * })
 * ```
 */
export async function fromLoader<
  S extends Subject = Subject,
  R extends Resource = Resource,
>(
  loader:   PolicyLoader<S, R>,
  onReload?: (policy: PolicyDefinition<S, R>) => void,
): Promise<PolicyResolverFn<S, R>> {
  let cached = await loader.load()
  loader.watch?.((p) => {
    cached = p
    onReload?.(p)
  })
  return () => cached
}

// ─── Composition helpers ──────────────────────────────────────────────────────

/**
 * Allow only when **all** resolvers allow.
 * The first deny wins; its `reason` is propagated to the composite decision.
 *
 * ```typescript
 * const policy = intersect(basePolicy, tenantPolicy)
 * ```
 */
export function intersect<
  S extends Subject = Subject,
  R extends Resource = Resource,
  A extends string = string,
>(...resolvers: PolicyResolver<S, R, A>[]): CompositeResolver<S, R, A> {
  return { _tag: 'intersect', resolvers }
}

/**
 * Allow when **any** resolver allows.
 * The first allow wins; its `reason` is propagated to the composite decision.
 *
 * ```typescript
 * const policy = union(rolePolicy, ownerPolicy)
 * ```
 */
export function union<
  S extends Subject = Subject,
  R extends Resource = Resource,
  A extends string = string,
>(...resolvers: PolicyResolver<S, R, A>[]): CompositeResolver<S, R, A> {
  return { _tag: 'union', resolvers }
}

/**
 * Use the **first resolver that has a matching rule** (non-default decision).
 * Falls through to the next resolver when a policy's `defaultEffect` would apply.
 * The last resolver always wins as a fallback.
 *
 * ```typescript
 * const policy = firstMatch(specialCasePolicy, generalPolicy)
 * ```
 */
export function firstMatch<
  S extends Subject = Subject,
  R extends Resource = Resource,
  A extends string = string,
>(...resolvers: PolicyResolver<S, R, A>[]): CompositeResolver<S, R, A> {
  return { _tag: 'firstMatch', resolvers }
}

// ─── AuthEvaluator ───────────────────────────────────────────────────────────

export interface AuthEvaluator<
  S extends Subject = Subject,
  R extends Resource = Resource,
  A extends string = string,
> {
  evaluate(ctx: AuthContext<S, R>): Promise<Decision>

  /**
   * Evaluate one action against many resources. Fires observers for each
   * decision — use this for list pages where the sidebar should show
   * individual read decisions per document.
   *
   * Returns paired results so you never need to index-match parallel arrays:
   *
   *   const results = await engine.evaluateAll(user, docs, 'read')
   *   const visible = results.filter(r => r.decision.allowed).map(r => r.resource)
   */
  evaluateAll(subject: S, resources: R[], action: A): Promise<Array<{ resource: R; decision: Decision }>>

  /** Evaluate a read and compute which fields the subject is permitted to see. */
  evaluateRead(input: EvaluateReadInput<S, R>): Promise<EvaluateReadResult>

  /**
   * Batch-evaluate many actions for one subject + resource. Does NOT fire
   * observers — this is a query for UI rendering, not an enforcement decision.
   *
   *   const perms = await engine.permissions(user, doc, ['write', 'archive', 'delete'])
   *   // { write: true, archive: true, delete: false }
   *
   *   const perms = await engine.permissions(user, ['uploadTrack', 'accessAdmin'])
   *   // subject-only — no resource
   *
   * Use `can()` or `evaluate()` when you need an audited enforcement decision.
   */
  permissions<K extends A>(subject: S, actions: K[]): Promise<Record<K, boolean>>
  permissions<K extends A>(subject: S, resource: R, actions: K[]): Promise<Record<K, boolean>>

  /** Single boolean convenience. Fires observers. */
  can(subject: S, action: A): Promise<boolean>
  can(subject: S, resource: R, action: A): Promise<boolean>
}

// ─── Mode ─────────────────────────────────────────────────────────────────────

export type EnforcerMode = 'audit' | 'enforce' | 'suspended' | 'lockdown'

// ─── Engine ──────────────────────────────────────────────────────────────────

export interface AuthEngineConfig<
  S extends Subject = Subject,
  R extends Resource = Resource,
> {
  /**
   * The policy resolver. One of:
   *   - A static `PolicyDefinition` — same policy for every call.
   *   - A `PolicyResolverFn` — called per evaluation (e.g. from `fromLoader()`).
   *   - A `CompositeResolver` — built with `intersect()`, `union()`, or `firstMatch()`.
   */
  policy: PolicyResolver<S, R>
  observers?: AuthObserver[]
  /** What to do when evaluation throws. 'deny' is the safe default. */
  onError?: 'deny' | 'allow'
  /**
   * Enforcement mode. Default: 'enforce'.
   *
   *   enforce   — policy decision is final
   *   audit     — policy is evaluated and observers fire, but all requests are allowed
   *   suspended — policy is evaluated and observers fire, but all requests are denied
   *   lockdown  — policy is not evaluated; all requests are denied immediately
   *
   * In all modes, decisions flow through observers so the audit trail is complete.
   * Switch at runtime with engine.setMode().
   */
  mode?: EnforcerMode
}

export interface AuthEngine<
  S extends Subject = Subject,
  R extends Resource = Resource,
  A extends string = string,
> extends AuthEvaluator<S, R, A> {
  /** Replace the active resolver with a static policy (e.g. for manual hot-swap). */
  reload(policy: PolicyDefinition<S, R>): void
  /**
   * Returns the most recently resolved `PolicyDefinition`, if available.
   * Returns `undefined` when the engine was given a composite resolver and no
   * evaluation has run yet, or for composite resolvers in general.
   */
  getPolicy(): PolicyDefinition<S, R> | undefined
  /** Returns the current enforcement mode. */
  getMode(): EnforcerMode
  /** Switch enforcement mode in-flight without recreating the engine. */
  setMode(mode: EnforcerMode): void
}

// ─── Input / output shapes ───────────────────────────────────────────────────

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

export function createAuthEngine<
  S extends Subject = Subject,
  R extends Resource = Resource,
  A extends string = string,
>(config: AuthEngineConfig<S, R>): AuthEngine<S, R, A> {
  if (!config.policy) {
    throw new Error('createAuthEngine requires a policy')
  }
  return buildEngine<S, R, A>(config)
}

// ─── Engine implementation ────────────────────────────────────────────────────

function buildEngine<
  S extends Subject = Subject,
  R extends Resource = Resource,
  A extends string = string,
>(config: AuthEngineConfig<S, R>): AuthEngine<S, R, A> {
  let activeResolver:   PolicyResolver<S, R, A> = config.policy as PolicyResolver<S, R, A>
  let lastKnownPolicy:  PolicyDefinition<S, R> | undefined = isStaticPolicy(config.policy)
    ? config.policy as PolicyDefinition<S, R>
    : undefined
  let currentMode: EnforcerMode = config.mode ?? 'enforce'

  // ─── Resolver type guards ─────────────────────────────────────────────────

  function isStaticPolicy(r: PolicyResolver<S, R, A>): r is PolicyDefinition<S, R, A> {
    return typeof r === 'object' && r !== null && 'rules' in r
  }

  function isComposite(r: PolicyResolver<S, R, A>): r is CompositeResolver<S, R, A> {
    return typeof r === 'object' && r !== null && '_tag' in r
  }

  // ─── Resolver dispatch ────────────────────────────────────────────────────
  //
  // runResolverToDecision handles all three PolicyResolver forms. For static
  // and function resolvers it calls evaluatePolicy() on the resolved definition.
  // For composite resolvers it recursively resolves children and combines decisions.

  async function runResolverToDecision(
    resolver: PolicyResolver<S, R, A>,
    ctx:      AuthContext<S, R>,
  ): Promise<Decision> {
    if (isComposite(resolver)) {
      return runComposite(resolver, ctx)
    }

    let policy: PolicyDefinition<S, R>
    if (typeof resolver === 'function') {
      policy = await (resolver as PolicyResolverFn<S, R, A>)(ctx)
    } else {
      policy = resolver as PolicyDefinition<S, R>
    }

    lastKnownPolicy = policy
    return evaluatePolicy(policy, ctx)
  }

  async function runComposite(
    composite: CompositeResolver<S, R, A>,
    ctx:       AuthContext<S, R>,
  ): Promise<Decision> {
    const childDecisions = await Promise.all(
      composite.resolvers.map(r => runResolverToDecision(r, ctx))
    )

    const start       = Date.now()
    const policyLabel = `${composite._tag}(${childDecisions.map(d => d.policy).join(', ')})`

    if (composite._tag === 'intersect') {
      const denyDecision = childDecisions.find(d => !d.allowed)
      const allowed      = denyDecision === undefined
      return {
        allowed,
        effect:      allowed ? 'allow' : 'deny',
        reason:      denyDecision?.reason ?? 'intersect-all-allowed',
        rule:        denyDecision?.rule,
        policy:      policyLabel,
        context:     ctx,
        evaluatedAt: new Date(),
        durationMs:  Date.now() - start,
      }
    }

    if (composite._tag === 'union') {
      const allowDecision = childDecisions.find(d => d.allowed)
      const allowed       = allowDecision !== undefined
      return {
        allowed,
        effect:      allowed ? 'allow' : 'deny',
        reason:      allowDecision?.reason ?? 'union-all-denied',
        rule:        allowDecision?.rule,
        policy:      policyLabel,
        context:     ctx,
        evaluatedAt: new Date(),
        durationMs:  Date.now() - start,
      }
    }

    // firstMatch: first resolver with a non-default decision wins;
    // last resolver is the unconditional fallback.
    const winner = childDecisions.find(d => !d.defaulted) ?? childDecisions[childDecisions.length - 1]!
    return { ...winner, policy: policyLabel, context: ctx }
  }

  // ─── Mode application ─────────────────────────────────────────────────────
  //
  // Observers always receive the real policy decision (what the policy said).
  // The mode override is applied after observers fire, so the caller gets the
  // mode-adjusted result while the audit trail reflects ground truth.
  //
  // Lockdown is the exception: policy is never evaluated. The lockdown decision
  // flows through observers so the audit trail remains complete.

  function applyMode(decision: Decision): Decision {
    if (currentMode === 'audit' && !decision.allowed) {
      return { ...decision, allowed: true, effect: 'allow', override: 'permissive' }
    }
    if (currentMode === 'suspended' && decision.allowed) {
      return { ...decision, allowed: false, effect: 'deny', override: 'suspended' }
    }
    return decision
  }

  function lockdownDecision(ctx: AuthContext<S, R>): Decision {
    return {
      allowed:     false,
      effect:      'deny',
      reason:      'lockdown',
      policy:      lastKnownPolicy ? getPolicyLabel(lastKnownPolicy) : 'unknown',
      context:     ctx,
      evaluatedAt: new Date(),
      durationMs:  0,
      override:    'lockdown',
    }
  }

  // ─── Field filtering ──────────────────────────────────────────────────────

  function computeAllowedFields(
    fieldRules: FieldRule<S, R>[],
    ctx:        AuthContext<S, R>,
    resource:   R,
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
    if (currentMode === 'lockdown') {
      const decision = lockdownDecision(ctx)
      await fireObservers({ decision })
      return decision
    }

    let policyDecision: Decision

    try {
      policyDecision = await runResolverToDecision(activeResolver, ctx)
    } catch (err) {
      const onError = config.onError ?? 'deny'
      policyDecision = {
        allowed:     onError === 'allow',
        effect:      onError === 'allow' ? 'allow' : 'deny',
        reason:      'error',
        policy:      lastKnownPolicy ? getPolicyLabel(lastKnownPolicy) : 'unknown',
        context:     ctx,
        evaluatedAt: new Date(),
        durationMs:  0,
        error:       err instanceof Error ? err : new Error(String(err)),
      }
    }

    await fireObservers({ decision: policyDecision })
    return applyMode(policyDecision)
  }

  async function evaluateAll(
    subject:   S,
    resources: R[],
    action:    A,
  ): Promise<Array<{ resource: R; decision: Decision }>> {
    const results: Array<{ resource: R; decision: Decision }> = []
    for (const resource of resources) {
      const decision = await evaluate({ subject, resource, action })
      results.push({ resource, decision })
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

    if (currentMode === 'lockdown') {
      const decision = lockdownDecision(ctx)
      await fireObservers({ decision })
      return { decision, allowedFields: [] }
    }

    let policyDecision: Decision

    try {
      policyDecision = await runResolverToDecision(activeResolver, ctx)
    } catch (err) {
      const onError = config.onError ?? 'deny'
      policyDecision = {
        allowed:     onError === 'allow',
        effect:      onError === 'allow' ? 'allow' : 'deny',
        reason:      'error',
        policy:      lastKnownPolicy ? getPolicyLabel(lastKnownPolicy) : 'unknown',
        context:     ctx,
        evaluatedAt: new Date(),
        durationMs:  0,
        error:       err instanceof Error ? err : new Error(String(err)),
      }
    }

    await fireObservers({ decision: policyDecision })
    const decision = applyMode(policyDecision)

    if (!decision.allowed) {
      return { decision, allowedFields: [] }
    }

    // Audit mode overrode a deny: return all fields on the resource so the
    // developer sees what would have been blocked without the app breaking.
    if (policyDecision.allowed === false) {
      return { decision, allowedFields: Object.keys(input.resource) }
    }

    const allowedFields = computeAllowedFields(
      lastKnownPolicy?.fieldRules ?? [],
      ctx,
      input.resource,
    )
    return { decision, allowedFields }
  }

  function permissions<K extends A>(subject: S, actions: K[]): Promise<Record<K, boolean>>
  function permissions<K extends A>(subject: S, resource: R, actions: K[]): Promise<Record<K, boolean>>
  async function permissions<K extends A>(
    subject:          S,
    resourceOrActions: R | K[],
    maybeActions?:    K[],
  ): Promise<Record<K, boolean>> {
    const resource = Array.isArray(resourceOrActions) ? undefined : resourceOrActions as R
    const actions  = Array.isArray(resourceOrActions) ? resourceOrActions : maybeActions!

    // Deliberately does not fire observers — this is a query for UI rendering,
    // not an enforcement decision. Mode overrides still apply.
    if (currentMode === 'lockdown' || currentMode === 'suspended') {
      const result = {} as Record<K, boolean>
      for (const action of actions) result[action] = false
      return result
    }
    if (currentMode === 'audit') {
      const result = {} as Record<K, boolean>
      for (const action of actions) result[action] = true
      return result
    }

    // enforce mode: evaluate via resolver, no observers
    const result = {} as Record<K, boolean>
    for (const action of actions) {
      try {
        const ctx = { subject, resource, action } as AuthContext<S, R>
        const decision = await runResolverToDecision(activeResolver, ctx)
        result[action] = decision.allowed
      } catch {
        result[action] = (config.onError ?? 'deny') === 'allow'
      }
    }
    return result
  }

  function can(subject: S, action: A): Promise<boolean>
  function can(subject: S, resource: R, action: A): Promise<boolean>
  async function can(
    subject:          S,
    resourceOrAction: R | A,
    maybeAction?:     A,
  ): Promise<boolean> {
    if (typeof resourceOrAction === 'string') {
      return (await evaluate({ subject, action: resourceOrAction as A })).allowed
    }
    return (await evaluate({ subject, resource: resourceOrAction as R, action: maybeAction! })).allowed
  }

  function reload(policy: PolicyDefinition<S, R>): void {
    activeResolver  = policy as unknown as PolicyResolver<S, R, A>
    lastKnownPolicy = policy
    for (const observer of config.observers ?? []) {
      observer.onPolicyReload?.(policy as PolicyDefinition)
    }
  }

  function getPolicy(): PolicyDefinition<S, R> | undefined {
    return lastKnownPolicy
  }

  function getMode(): EnforcerMode {
    return currentMode
  }

  function setMode(mode: EnforcerMode): void {
    currentMode = mode
  }

  return { evaluate, evaluateAll, evaluateRead, permissions, can, reload, getPolicy, getMode, setMode }
}

// ─── Utilities ───────────────────────────────────────────────────────────────

/**
 * Filter an object to only the fields permitted by evaluateRead().
 * Pass the allowedFields array from EvaluateReadResult.
 */
export function applyFieldFilter<T extends Record<string, unknown>>(
  obj:           T,
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
