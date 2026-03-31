# Core API Reference

This reference covers `@daltonr/authwrite-core` — the zero-dependency TypeScript authorization engine.

---

## `createAuthEngine(config)`

Creates an `AuthEngine`. Always synchronous — pass a `PolicyResolver` (which may be the result of `await fromLoader(...)` if you need async initialisation).

```typescript
export function createAuthEngine<
  S extends Subject = Subject,
  R extends Resource = Resource,
  A extends string = string,
>(config: AuthEngineConfig<S, R>): AuthEngine<S, R, A>
```

```typescript
// Static policy
const engine = createAuthEngine({ policy })

// Dynamic resolver (async function)
const engine = createAuthEngine({ policy: async (ctx) => selectPolicy(ctx) })

// File-based with hot reload
const engine = createAuthEngine({ policy: await fromLoader(loader) })

// Composite policy
const engine = createAuthEngine({ policy: intersect(basePolicy, tenantPolicy) })
```

### `AuthEngineConfig` options

| Option | Type | Default | Description |
|---|---|---|---|
| `policy` | `PolicyResolver<S, R>` | — | **Required.** Static policy, dynamic function, or composite resolver. |
| `observers` | `AuthObserver[]` | `[]` | Observers notified after every decision. |
| `onError` | `'deny' \| 'allow'` | `'deny'` | Effect applied when a rule throws an unexpected error. |
| `mode` | `EnforcerMode` | `'enforce'` | Initial enforcement mode. |

---

## `AuthEngine`

```typescript
export interface AuthEngine<
  S extends Subject = Subject,
  R extends Resource = Resource,
  A extends string = string,
> extends AuthEvaluator<S, R, A> {
  reload(policy: PolicyDefinition<S, R>): void
  getPolicy(): PolicyDefinition<S, R> | undefined
  getMode(): EnforcerMode
  setMode(mode: EnforcerMode): void
}
```

Extends `AuthEvaluator` with policy and mode management.

### Methods

| Method | Signature | Description |
|---|---|---|
| `evaluate` | `(ctx: AuthContext<S, R>) => Promise<Decision>` | Evaluates a single context. Fires observers. Applies mode override. |
| `evaluateAll` | `(subject: S, resources: R[], action: A) => Promise<Array<{ resource: R; decision: Decision }>>` | Evaluates one action against many resources. Fires observers for each. Returns paired results. |
| `evaluateRead` | `(input: EvaluateReadInput<S, R>) => Promise<EvaluateReadResult>` | Evaluates read access and returns permitted fields. |
| `permissions` | `(subject: S, actions: K[]) => Promise<Record<K, boolean>>` | Batch-evaluates actions for UI rendering. Does not fire observers. Subject-only overload. |
| `permissions` | `(subject: S, resource: R, actions: K[]) => Promise<Record<K, boolean>>` | Batch-evaluates actions with a resource. Does not fire observers. |
| `can` | `(subject: S, action: A) => Promise<boolean>` | Convenience wrapper. Fires observers. Subject-only overload. |
| `can` | `(subject: S, resource: R, action: A) => Promise<boolean>` | Convenience wrapper with a resource. Fires observers. |
| `reload` | `(policy: PolicyDefinition<S, R>) => void` | Replaces the active resolver with a static policy. Fires `onPolicyReload` on observers. |
| `getPolicy` | `() => PolicyDefinition<S, R> \| undefined` | Returns the most recently resolved policy. `undefined` for composite resolvers before first evaluation, or before any evaluation with a dynamic resolver. |
| `getMode` | `() => EnforcerMode` | Returns the current enforcement mode. |
| `setMode` | `(mode: EnforcerMode) => void` | Changes the enforcement mode in-flight. Affects all subsequent evaluations. |

---

## `evaluatePolicy(policy, ctx)`

```typescript
export function evaluatePolicy<
  S extends Subject = Subject,
  R extends Resource = Resource,
>(
  policy: PolicyDefinition<S, R>,
  ctx:    AuthContext<S, R>,
): Decision
```

Pure policy evaluation — no engine, no observers, no mode override. Evaluates a resolved `PolicyDefinition` against a context and returns a `Decision`. Throws if any rule function throws.

Use this for:
- Unit-testing individual rules in isolation
- Dry-running a policy before installing it
- Composition helpers (internally)

```typescript
import { evaluatePolicy } from '@daltonr/authwrite-core'

const decision = evaluatePolicy(myPolicy, {
  subject:  user,
  resource: doc,
  action:   'write',
})
```

---

## `fromLoader(loader, onReload?)`

```typescript
export async function fromLoader<
  S extends Subject = Subject,
  R extends Resource = Resource,
>(
  loader:    PolicyLoader<S, R>,
  onReload?: (policy: PolicyDefinition<S, R>) => void,
): Promise<PolicyResolverFn<S, R>>
```

Converts a `PolicyLoader` into a `PolicyResolverFn`. Loads the policy eagerly, caches it, and wires the loader's `watch()` callback to update the cache on hot-reload. The returned function is synchronous after initialisation.

```typescript
const engine = createAuthEngine({
  policy: await fromLoader(createFileLoader({ path, rules })),
})
```

Pass an optional `onReload` callback to be notified when the watcher fires:

```typescript
const policy = await fromLoader(loader, (newPolicy) => {
  console.log(`Reloaded: ${newPolicy.id}`)
})
```

---

## `intersect(...resolvers)`

```typescript
export function intersect<S, R, A>(
  ...resolvers: PolicyResolver<S, R, A>[]
): CompositeResolver<S, R, A>
```

Returns a `CompositeResolver` that allows only when **all** child resolvers allow. The first denial wins; its `reason` is propagated.

```typescript
const engine = createAuthEngine({ policy: intersect(basePolicy, tenantPolicy) })
```

`decision.policy` format: `intersect(base@1.0, tenant@2.0)`

---

## `union(...resolvers)`

```typescript
export function union<S, R, A>(
  ...resolvers: PolicyResolver<S, R, A>[]
): CompositeResolver<S, R, A>
```

Returns a `CompositeResolver` that allows when **any** child resolver allows. The first allow wins; its `reason` is propagated. If all deny, `reason` is `'union-all-denied'`.

```typescript
const engine = createAuthEngine({ policy: union(ownerPolicy, adminPolicy) })
```

---

## `firstMatch(...resolvers)`

```typescript
export function firstMatch<S, R, A>(
  ...resolvers: PolicyResolver<S, R, A>[]
): CompositeResolver<S, R, A>
```

Returns a `CompositeResolver` that uses the first resolver with a non-default decision (a matched rule). Falls through to the next when a policy's `defaultEffect` would apply. The last resolver is the unconditional fallback.

```typescript
const engine = createAuthEngine({ policy: firstMatch(specialCase, general) })
```

---

## `evaluate(ctx)`

```typescript
evaluate(ctx: AuthContext<S, R>): Promise<Decision>
```

Evaluates a single authorization context and returns a `Decision`. Fires observers. Applies mode override.

### `AuthContext` properties

| Property | Type | Description |
|---|---|---|
| `subject` | `S` | The entity requesting access. |
| `resource` | `R` | (optional) The resource being accessed. Absent for subject actions. |
| `action` | `string` | The action being attempted (e.g. `'read'`, `'delete'`). |
| `env` | `object` | (optional) Ambient request metadata. |

### `AuthContext.env` fields

| Field | Type | Description |
|---|---|---|
| `ip` | `string` | (optional) Client IP address. |
| `userAgent` | `string` | (optional) Client user-agent string. |
| `timestamp` | `Date` | (optional) Time the request was made. |
| `[key]` | `unknown` | Additional custom fields. |

---

## `evaluateAll(subject, resources, action)`

```typescript
evaluateAll(subject: S, resources: R[], action: A): Promise<Array<{ resource: R; decision: Decision }>>
```

Evaluates one action against many resources. Fires observers for each decision — use this for list pages where each item needs an individual access decision.

Returns paired `{ resource, decision }` results so you never need to index-match parallel arrays:

```typescript
const results = await engine.evaluateAll(user, docs, 'read')
const visible  = results.filter(r => r.decision.allowed).map(r => r.resource)
```

---

## `evaluateRead(input)`

```typescript
evaluateRead(input: EvaluateReadInput<S, R>): Promise<EvaluateReadResult>
```

Evaluates read access and resolves field-level visibility.

### `EvaluateReadInput` properties

| Property | Type | Description |
|---|---|---|
| `subject` | `S` | The entity requesting access. |
| `resource` | `R` | The resource being read. Required. |
| `env` | `AuthContext['env']` | (optional) Ambient request metadata. |

---

## `can(subject, action)` / `can(subject, resource, action)`

```typescript
can(subject: S, action: A): Promise<boolean>
can(subject: S, resource: R, action: A): Promise<boolean>
```

Convenience method. Returns `true` when the decision is allowed. Fires observers. Equivalent to `(await engine.evaluate({ subject, resource, action })).allowed`.

Subject-only form (no resource):

```typescript
const canUpload = await engine.can(user, 'uploadFile')
```

With resource:

```typescript
const canDelete = await engine.can(user, doc, 'delete')
```

---

## `permissions(subject, actions)` / `permissions(subject, resource, actions)`

```typescript
permissions<K extends A>(subject: S, actions: K[]): Promise<Record<K, boolean>>
permissions<K extends A>(subject: S, resource: R, actions: K[]): Promise<Record<K, boolean>>
```

Batch-evaluates many actions for one subject. **Does not fire observers** — this is a query for UI rendering, not an enforcement decision.

Subject-only (no resource):

```typescript
const perms = await engine.permissions(user, ['accessAdmin', 'viewReports'])
// { accessAdmin: true, viewReports: true }
```

With resource:

```typescript
const perms = await engine.permissions(user, doc, ['write', 'archive', 'delete'])
// { write: true, archive: true, delete: false }
```

Use `can()` or `evaluate()` when you need an audited enforcement decision.

---

## `applyFieldFilter(obj, allowedFields)`

```typescript
export function applyFieldFilter<T extends Record<string, unknown>>(
  obj:           T,
  allowedFields: string[]
): Partial<T>
```

Returns a shallow copy of `obj` containing only the keys listed in `allowedFields`. Pass the `allowedFields` from an `EvaluateReadResult` to apply field-level access control to a plain object.

---

## Types reference

### `PolicyResolver`

```typescript
export type PolicyResolver<
  S extends Subject = Subject,
  R extends Resource = Resource,
  A extends string = string,
> =
  | PolicyDefinition<S, R, A>
  | PolicyResolverFn<S, R, A>
  | CompositeResolver<S, R, A>
```

The union of all accepted policy forms. Static policy, dynamic function, or composite.

### `PolicyResolverFn`

```typescript
export type PolicyResolverFn<S, R, A> =
  (ctx: AuthContext<S, R>) => PolicyDefinition<S, R, A> | Promise<PolicyDefinition<S, R, A>>
```

A function called on every evaluation. May return synchronously or asynchronously.

### `CompositeResolver`

```typescript
export interface CompositeResolver<S, R, A> {
  readonly _tag: 'intersect' | 'union' | 'firstMatch'
  readonly resolvers: PolicyResolver<S, R, A>[]
}
```

Produced by the `intersect`, `union`, and `firstMatch` helpers. Not constructed directly.

---

### `Subject`

```typescript
export interface Subject {
  id: string
  roles: string[]
  attributes?: Record<string, unknown>
}
```

| Property | Type | Description |
|---|---|---|
| `id` | `string` | Unique identifier for the subject. |
| `roles` | `string[]` | List of role strings used in policy matching. |
| `attributes` | `Record<string, unknown>` | (optional) Arbitrary subject metadata. |

---

### `Resource`

```typescript
export interface Resource {
  type: string
  id?: string
  ownerId?: string
  attributes?: Record<string, unknown>
}
```

| Property | Type | Description |
|---|---|---|
| `type` | `string` | Resource type identifier (e.g. `'document'`, `'project'`). |
| `id` | `string` | (optional) Instance identifier. Absent for type actions (create). |
| `ownerId` | `string` | (optional) Subject ID of the resource owner. |
| `attributes` | `Record<string, unknown>` | (optional) Arbitrary resource metadata. |

---

### `AuthContext`

See [`evaluate(ctx)`](#evaluatectx) above for the full property table.

---

### `Decision`

```typescript
export interface Decision {
  allowed: boolean
  effect: 'allow' | 'deny'
  reason: string
  rule?: PolicyRule
  policy: string
  context: AuthContext
  evaluatedAt: Date
  durationMs: number
  defaulted?: boolean
  override?: 'permissive' | 'suspended' | 'lockdown'
  error?: Error
}
```

| Property | Type | Description |
|---|---|---|
| `allowed` | `boolean` | `true` when access is granted. |
| `effect` | `'allow' \| 'deny'` | The final effect applied. |
| `reason` | `string` | The `id` of the matching rule, `'default'` when no rule matched, `'lockdown'` in lockdown mode, or `'error'` when a rule threw. |
| `rule` | `PolicyRule` | (optional) The rule that produced this decision. Absent on default, error, lockdown, or composite decisions. |
| `policy` | `string` | `id@version` of the evaluated policy, or composite label (`intersect(...)`) for composites. |
| `context` | `AuthContext` | The full context passed to the evaluator. |
| `evaluatedAt` | `Date` | Timestamp when evaluation completed. |
| `durationMs` | `number` | Wall-clock time taken, in milliseconds. |
| `defaulted` | `boolean` | (optional) `true` when no rule matched and `defaultEffect` was applied. |
| `override` | `'permissive' \| 'suspended' \| 'lockdown' \| undefined` | Set when the engine mode overrode the policy outcome. |
| `error` | `Error` | (optional) Present when a rule threw and `onError` determined the outcome. |

---

### `EnforcerMode`

```typescript
export type EnforcerMode = 'audit' | 'enforce' | 'suspended' | 'lockdown'
```

| Value | Meaning |
|---|---|
| `'audit'` | Evaluates normally. Denials are overridden to allow (`override: 'permissive'`). Observers see the honest decision. |
| `'enforce'` | Standard behaviour. Policy decision is final. |
| `'suspended'` | Policy evaluates and observers fire. Allows are overridden to deny (`override: 'suspended'`). |
| `'lockdown'` | Policy is skipped. Immediate deny. Observers fire with `reason: 'lockdown'`. |

---

### `PolicyDefinition`

```typescript
export interface PolicyDefinition<
  S extends Subject = Subject,
  R extends Resource = Resource,
  A extends string = string,
> {
  id: string
  version?: string
  description?: string
  defaultEffect: 'allow' | 'deny'
  rules: PolicyRule<S, R, A>[]
  fieldRules?: FieldRule<S, R>[]
}
```

| Property | Type | Description |
|---|---|---|
| `id` | `string` | Unique identifier for the policy. |
| `version` | `string` | (optional) Semantic version for audit purposes. Appears in `decision.policy` as `id@version`. |
| `description` | `string` | (optional) Human-readable description. |
| `defaultEffect` | `'allow' \| 'deny'` | Effect when no rule matches. Use `'deny'` for least-privilege. |
| `rules` | `PolicyRule<S, R, A>[]` | Rules evaluated for action decisions. |
| `fieldRules` | `FieldRule<S, R>[]` | (optional) Rules for field-level visibility in `evaluateRead`. |

---

### `PolicyRule`

```typescript
export interface PolicyRule<
  S extends Subject = Subject,
  R extends Resource = Resource,
  A extends string = string,
> {
  id: string
  description?: string
  priority?: number
  match: (ctx: AuthContext<S, R>) => boolean
  allow?: (A | '*')[]
  deny?: (A | '*')[]
  condition?: (ctx: AuthContext<S, R>) => boolean
}
```

| Property | Type | Description |
|---|---|---|
| `id` | `string` | Unique identifier. Appears as `Decision.reason` when this rule fires. |
| `description` | `string` | (optional) Human-readable description. |
| `priority` | `number` | (optional) Higher number wins. Default `0`. At equal priority, deny beats allow. |
| `match` | `(ctx) => boolean` | Predicate — returns `true` when this rule is a candidate for this context. |
| `allow` | `(A \| '*')[]` | (optional) Actions allowed when `match` (and `condition`) pass. `'*'` covers all actions. |
| `deny` | `(A \| '*')[]` | (optional) Actions denied when `match` (and `condition`) pass. |
| `condition` | `(ctx) => boolean` | (optional) Secondary predicate evaluated after `match`. Both must return `true` for the rule to fire. |

---

### `FieldRule`

```typescript
export interface FieldRule<S extends Subject = Subject, R extends Resource = Resource> {
  id: string
  match: (ctx: AuthContext<S, R>) => boolean
  expose: string[]
  redact: string[]
}
```

| Property | Type | Description |
|---|---|---|
| `id` | `string` | Unique identifier. |
| `match` | `(ctx) => boolean` | Predicate — returns `true` when this field rule applies. |
| `expose` | `string[]` | Field names visible when this rule matches. `'*'` exposes all fields. |
| `redact` | `string[]` | Field names hidden when this rule matches. Takes precedence over `expose`. |

---

### `AuthObserver`

```typescript
export interface AuthObserver {
  onDecision(event: DecisionEvent): void | Promise<void>
  onError?(err: Error, ctx: AuthContext): void
  onPolicyReload?(policy: PolicyDefinition): void
}
```

| Method | Signature | Description |
|---|---|---|
| `onDecision` | `(event: DecisionEvent) => void \| Promise<void>` | Called after every evaluation. Always receives the honest (pre-mode-override) decision. |
| `onError` | `(err: Error, ctx: AuthContext) => void` | (optional) Called when an error is caught during evaluation. |
| `onPolicyReload` | `(policy: PolicyDefinition) => void` | (optional) Called when `engine.reload()` is invoked. |

---

### `DecisionEvent`

```typescript
export interface DecisionEvent {
  decision: Decision
  traceId?: string
  source?: string
}
```

| Property | Type | Description |
|---|---|---|
| `decision` | `Decision` | The honest (pre-override) decision. |
| `traceId` | `string` | (optional) Correlation ID for distributed tracing. |
| `source` | `string` | (optional) Label identifying which part of the application triggered the evaluation. |

---

### `PolicyLoader`

```typescript
export interface PolicyLoader<S extends Subject = Subject, R extends Resource = Resource> {
  load(): Promise<PolicyDefinition<S, R>>
  watch?(cb: (policy: PolicyDefinition<S, R>) => void): void
}
```

| Method | Signature | Description |
|---|---|---|
| `load` | `() => Promise<PolicyDefinition<S, R>>` | Asynchronously loads and returns the policy. |
| `watch` | `(cb) => void` | (optional) Subscribes to policy changes. Pass to `fromLoader` rather than wiring manually. |

---

### `EvaluateReadResult`

```typescript
export interface EvaluateReadResult {
  decision: Decision
  allowedFields: string[]
}
```

| Property | Type | Description |
|---|---|---|
| `decision` | `Decision` | The access decision for the read action. |
| `allowedFields` | `string[]` | Fields the subject may read. Empty when `decision.allowed` is `false`. |

---

© 2026 Devjoy Ltd. MIT License.
