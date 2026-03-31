import type { AuthContext, Subject, Resource } from '@daltonr/authwrite-core'

// ─── Evaluatable rule interface ───────────────────────────────────────────────
//
// A minimal structural interface that any evaluatable rule satisfies.
// Designed to work with @daltonr/rulewrite but accepts any compatible object —
// anything with isSatisfiedBy() and evaluate() fits the contract.

export interface EvaluatableRule<T> {
  isSatisfiedBy(value: T): boolean
  /** Returns a structured evaluation tree. The shape matches @daltonr/rulewrite's
   *  EvaluationResult: { satisfied, label, children? }. */
  evaluate(value: T): unknown
}

// ─── fromRule ─────────────────────────────────────────────────────────────────

export interface RuleMatchFns<
  S extends Subject  = Subject,
  R extends Resource = Resource,
> {
  match:   (ctx: AuthContext<S, R>) => boolean
  explain: (ctx: AuthContext<S, R>) => unknown
}

/**
 * Wraps an evaluatable rule (e.g. a `@daltonr/rulewrite` `Rule`) into the
 * `match` + `explain` pair expected by a `PolicyRule`.
 *
 * `match` calls `rule.isSatisfiedBy(ctx)` — the fast boolean path used
 * during policy evaluation. `explain` calls `rule.evaluate(ctx)` — the full
 * tree evaluation, called only on the deciding rule and attached to
 * `Decision.matchExplanation` so the devtools sidebar (and your own observers)
 * can display a human-readable trace.
 *
 * @example
 * ```typescript
 * import { rule, all } from '@daltonr/rulewrite'
 * import { fromRule } from '@daltonr/authwrite-rulewrite'
 * import type { PolicyRule } from '@daltonr/authwrite-core'
 *
 * const isOwner  = rule<AuthContext<User, Doc>>(
 *   ctx => ctx.subject.id === ctx.resource?.ownerId,
 *   'IsOwner'
 * )
 * const isEditor = rule<AuthContext<User, Doc>>(
 *   ctx => ctx.subject.roles.includes('editor'),
 *   'IsEditor'
 * )
 *
 * const policy: PolicyDefinition<User, Doc> = {
 *   id:            'doc-policy',
 *   defaultEffect: 'deny',
 *   rules: [
 *     {
 *       id:    'owner-or-editor',
 *       ...fromRule(isOwner.or(isEditor)),
 *       allow: ['read', 'update'],
 *     },
 *   ],
 * }
 * ```
 */
export function fromRule<
  S extends Subject  = Subject,
  R extends Resource = Resource,
>(
  rule: EvaluatableRule<AuthContext<S, R>>,
): RuleMatchFns<S, R> {
  return {
    match:   (ctx) => rule.isSatisfiedBy(ctx),
    explain: (ctx) => rule.evaluate(ctx),
  }
}
