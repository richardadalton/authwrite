# Core API Reference

This reference covers `@authwrite/core` — the zero-dependency TypeScript authorization engine.

---

## `createAuthEngine(config)`

```typescript
export function createAuthEngine<S extends Subject = Subject, R extends Resource = Resource>(
  config: AuthEngineConfig<S, R>
): AuthEngine<S, R>
```

Factory function that constructs a fully configured `AuthEngine` instance.

### `AuthEngineConfig` options

| Option | Type | Default | Description |
|---|---|---|---|
| `policy` | `PolicyDefinition<S, R>` | — | Inline policy definition. Mutually exclusive with `loader`. |
| `loader` | `PolicyLoader<S, R>` | — | Async loader that provides the policy. Mutually exclusive with `policy`. |
| `observers` | `AuthObserver[]` | `[]` | Observers notified after every decision. |
| `onError` | `'deny' \| 'allow'` | `'deny'` | Effect applied when the evaluator throws an unexpected error. |

Either `policy` or `loader` must be provided. Providing neither throws at construction time.

---

## `AuthEngine`

```typescript
export interface AuthEngine<S extends Subject = Subject, R extends Resource = Resource>
  extends AuthEvaluator<S, R> {
  reload(policy: PolicyDefinition<S, R>): void
  getPolicy(): PolicyDefinition<S, R>
}
```

Extends `AuthEvaluator` with policy management methods.

### Methods

| Method | Signature | Description |
|---|---|---|
| `evaluate` | `(ctx: AuthContext<S, R>) => Promise<Decision>` | Evaluates a single context against the active policy. |
| `evaluateAll` | `(input: EvaluateAllInput<S, R>) => Promise<Record<Action, Decision>>` | Evaluates multiple actions in one call, returning a decision per action. |
| `evaluateRead` | `(input: EvaluateReadInput<S, R>) => Promise<EvaluateReadResult>` | Evaluates read access and returns the set of fields the subject may see. |
| `can` | `(subject: S, resource: R \| undefined, action: Action) => Promise<boolean>` | Convenience wrapper returning `true` when the decision is allowed. |
| `reload` | `(policy: PolicyDefinition<S, R>) => void` | Replaces the active policy synchronously and notifies observers via `onPolicyReload`. |
| `getPolicy` | `() => PolicyDefinition<S, R>` | Returns the currently active `PolicyDefinition`. |

---

## `createEnforcer(engine, config)`

```typescript
export function createEnforcer<S extends Subject = Subject, R extends Resource = Resource>(
  engine: AuthEngine<S, R>,
  config: { mode: EnforcerMode }
): Enforcer<S, R>
```

Wraps an `AuthEngine` with a runtime mode that can override evaluation outcomes.

### `EnforcerMode` values

| Value | Meaning |
|---|---|
| `'audit'` | Evaluates normally but never blocks. All decisions report the real outcome but the enforcer does not act on denials. |
| `'enforce'` | Standard behaviour. Denials are enforced exactly as the policy dictates. |
| `'lockdown'` | All requests are denied regardless of policy. Decision includes `override: 'lockdown'`. |

---

## `Enforcer`

```typescript
export interface Enforcer<S extends Subject = Subject, R extends Resource = Resource>
  extends AuthEvaluator<S, R> {
  readonly mode: EnforcerMode
  setMode(mode: EnforcerMode): void
}
```

Extends `AuthEvaluator` with mode management. Inherits all `AuthEvaluator` methods from the underlying engine.

### Properties and methods

| Member | Type | Description |
|---|---|---|
| `mode` | `EnforcerMode` | The current operating mode. Read-only. |
| `setMode` | `(mode: EnforcerMode) => void` | Updates the operating mode at runtime. |
| `evaluate` | `(ctx: AuthContext<S, R>) => Promise<Decision>` | Delegates to the engine; outcome may be overridden by the current mode. |
| `evaluateAll` | `(input: EvaluateAllInput<S, R>) => Promise<Record<Action, Decision>>` | Delegates to the engine with mode override applied to each decision. |
| `evaluateRead` | `(input: EvaluateReadInput<S, R>) => Promise<EvaluateReadResult>` | Delegates to the engine with mode override applied. |
| `can` | `(subject: S, resource: R \| undefined, action: Action) => Promise<boolean>` | Returns `true` when the mode-adjusted decision is allowed. |

---

## `evaluate(ctx)`

```typescript
evaluate(ctx: AuthContext<S, R>): Promise<Decision>
```

Evaluates a single authorization context and returns a `Decision`.

### `AuthContext` properties

| Property | Type | Description |
|---|---|---|
| `subject` | `S` | The entity requesting access. |
| `resource` | `R` | (optional) The resource being accessed. |
| `action` | `Action` | The action being attempted (e.g. `'read'`, `'delete'`). |
| `env` | `object` | (optional) Ambient request metadata. See `env` fields below. |

### `AuthContext.env` fields

| Field | Type | Description |
|---|---|---|
| `ip` | `string` | (optional) Client IP address. |
| `userAgent` | `string` | (optional) Client user-agent string. |
| `timestamp` | `Date` | (optional) Time the request was made. |
| `[key]` | `unknown` | Additional custom fields. |

---

## `evaluateAll(input)`

```typescript
evaluateAll(input: EvaluateAllInput<S, R>): Promise<Record<Action, Decision>>
```

Evaluates multiple actions against the same subject and resource in a single call.

### `EvaluateAllInput` properties

| Property | Type | Description |
|---|---|---|
| `subject` | `S` | The entity requesting access. |
| `resource` | `R` | (optional) The resource being accessed. |
| `actions` | `Action[]` | List of actions to evaluate. |
| `env` | `AuthContext['env']` | (optional) Ambient request metadata. |

Returns `Record<Action, Decision>` — a map from each action string to its `Decision`.

---

## `evaluateRead(input)`

```typescript
evaluateRead(input: EvaluateReadInput<S, R>): Promise<EvaluateReadResult>
```

Evaluates read access and resolves field-level visibility for the subject on the given resource.

### `EvaluateReadInput` properties

| Property | Type | Description |
|---|---|---|
| `subject` | `S` | The entity requesting access. |
| `resource` | `R` | The resource being read. Required. |
| `env` | `AuthContext['env']` | (optional) Ambient request metadata. |

---

## `can(subject, resource, action)`

```typescript
can(subject: S, resource: R | undefined, action: Action): Promise<boolean>
```

Convenience method. Returns `true` when `evaluate()` produces an allowed decision, `false` otherwise. Equivalent to `(await engine.evaluate({ subject, resource, action })).allowed`.

---

## `applyFieldFilter(obj, allowedFields)`

```typescript
export function applyFieldFilter<T extends Record<string, unknown>>(
  obj: T,
  allowedFields: string[]
): Partial<T>
```

Returns a shallow copy of `obj` containing only the keys listed in `allowedFields`. Keys not present in `allowedFields` are omitted from the result. Pass the `allowedFields` from an `EvaluateReadResult` to apply field-level access control to a plain object.

---

## Types reference

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
| `attributes` | `Record<string, unknown>` | (optional) Arbitrary subject metadata available in rule conditions. |

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
| `id` | `string` | (optional) Instance identifier for the resource. |
| `ownerId` | `string` | (optional) Subject ID of the resource owner. |
| `attributes` | `Record<string, unknown>` | (optional) Arbitrary resource metadata available in rule conditions. |

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
  override?: 'permissive' | 'lockdown'
  error?: Error
}
```

| Property | Type | Description |
|---|---|---|
| `allowed` | `boolean` | `true` when access is granted. |
| `effect` | `'allow' \| 'deny'` | The final effect applied to this decision. |
| `reason` | `string` | Human-readable explanation of why the decision was reached. Matches the `id` of the matching rule, or a built-in reason string for defaults and errors. |
| `rule` | `PolicyRule` | (optional) The specific rule that produced this decision. Absent when the default effect applied or an error occurred. |
| `policy` | `string` | The `id` of the policy that was evaluated. |
| `context` | `AuthContext` | The full context passed to the evaluator. |
| `evaluatedAt` | `Date` | Timestamp when evaluation completed. |
| `durationMs` | `number` | Wall-clock time taken to evaluate, in milliseconds. |
| `defaulted` | `boolean` | (optional) `true` when no rule matched and the policy's `defaultEffect` was applied. |
| `override` | `'permissive' \| 'lockdown'` | (optional) Set when an `Enforcer` mode overrode the policy outcome. |
| `error` | `Error` | (optional) The error that caused this decision when `onError` produced the outcome. |

---

### `PolicyDefinition`

```typescript
export interface PolicyDefinition<S extends Subject = Subject, R extends Resource = Resource> {
  id: string
  version?: string
  description?: string
  defaultEffect: 'allow' | 'deny'
  rules: PolicyRule<S, R>[]
  fieldRules?: FieldRule<S, R>[]
}
```

| Property | Type | Description |
|---|---|---|
| `id` | `string` | Unique identifier for the policy. |
| `version` | `string` | (optional) Semantic version or label for audit purposes. |
| `description` | `string` | (optional) Human-readable description of the policy. |
| `defaultEffect` | `'allow' \| 'deny'` | Effect applied when no rule matches. Recommended value is `'deny'`. |
| `rules` | `PolicyRule<S, R>[]` | Ordered list of rules. Rules are evaluated from lowest to highest `priority`. |
| `fieldRules` | `FieldRule<S, R>[]` | (optional) Field-level visibility rules used by `evaluateRead`. |

---

### `PolicyRule`

```typescript
export interface PolicyRule<S extends Subject = Subject, R extends Resource = Resource> {
  id: string
  description?: string
  priority?: number
  match: (ctx: AuthContext<S, R>) => boolean
  allow?: Action[]
  deny?: Action[]
  condition?: (ctx: AuthContext<S, R>) => boolean
}
```

| Property | Type | Description |
|---|---|---|
| `id` | `string` | Unique identifier within the policy. Appears as `Decision.reason` when this rule fires. |
| `description` | `string` | (optional) Human-readable description of the rule's purpose. |
| `priority` | `number` | (optional) Evaluation order. Lower values are evaluated first. Defaults to `0`. |
| `match` | `(ctx: AuthContext<S, R>) => boolean` | Predicate that determines whether this rule applies to the given context. |
| `allow` | `Action[]` | (optional) Actions this rule allows when `match` returns `true`. |
| `deny` | `Action[]` | (optional) Actions this rule denies when `match` returns `true`. |
| `condition` | `(ctx: AuthContext<S, R>) => boolean` | (optional) Secondary predicate evaluated after `match`. The rule only fires when both return `true`. |

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
| `id` | `string` | Unique identifier for the field rule. |
| `match` | `(ctx: AuthContext<S, R>) => boolean` | Predicate that determines whether this field rule applies to the context. |
| `expose` | `string[]` | Field names that are visible when this rule matches. |
| `redact` | `string[]` | Field names that are hidden when this rule matches. Takes precedence over `expose`. |

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
| `onDecision` | `(event: DecisionEvent) => void \| Promise<void>` | Called after every evaluation. Required. |
| `onError` | `(err: Error, ctx: AuthContext) => void` | (optional) Called when an unexpected error is caught during evaluation. |
| `onPolicyReload` | `(policy: PolicyDefinition) => void` | (optional) Called when `AuthEngine.reload()` is invoked with a new policy. |

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
| `decision` | `Decision` | The decision produced by the evaluation. |
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
| `load` | `() => Promise<PolicyDefinition<S, R>>` | Asynchronously loads and returns the policy. Called once at engine construction. |
| `watch` | `(cb: (policy: PolicyDefinition<S, R>) => void) => void` | (optional) Subscribes to policy changes. The callback is invoked with the new policy whenever the source changes. |

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
| `allowedFields` | `string[]` | List of field names the subject is permitted to read. Empty when `decision.allowed` is `false`. |

---

© 2026 Devjoy Ltd. MIT License.
