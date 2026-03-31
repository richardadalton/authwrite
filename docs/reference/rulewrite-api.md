# `@daltonr/authwrite-rulewrite` API Reference

Bridge between [`@daltonr/rulewrite`](https://github.com/richardadalton/rulewrite) and `@daltonr/authwrite-core`. Wraps any evaluatable rule (a rulewrite `Rule`, or any object with `isSatisfiedBy` and `evaluate`) into the `match` + `explain` pair expected by a `PolicyRule`.

---

## Installation

```bash
npm install @daltonr/authwrite-rulewrite @daltonr/rulewrite
```

---

## `fromRule(rule)`

```typescript
function fromRule<S extends Subject = Subject, R extends Resource = Resource>(
  rule: EvaluatableRule<AuthContext<S, R>>,
): RuleMatchFns<S, R>
```

Wraps an evaluatable rule into the `match` and `explain` functions used by `PolicyRule`.

**Parameters**

| Name   | Type                                    | Description                                 |
|--------|-----------------------------------------|---------------------------------------------|
| `rule` | `EvaluatableRule<AuthContext<S, R>>`    | Any object with `isSatisfiedBy` and `evaluate`. |

**Returns** `RuleMatchFns<S, R>` — an object with `match` and `explain` functions, suitable for spreading into a `PolicyRule`.

**Behaviour**

- `match(ctx)` calls `rule.isSatisfiedBy(ctx)`. This is the fast boolean path evaluated for every rule in the policy.
- `explain(ctx)` calls `rule.evaluate(ctx)`. This is the full tree evaluation, called only on the deciding rule, and stored in `Decision.matchExplanation`.

**Example**

```typescript
import { rule }    from '@daltonr/rulewrite'
import { fromRule } from '@daltonr/authwrite-rulewrite'

const isOwner = rule<AuthContext<User, Doc>>(
  ctx => ctx.subject.id === ctx.resource?.ownerId,
  'IsOwner',
)

const policy: PolicyDefinition<User, Doc> = {
  id:            'doc-policy',
  defaultEffect: 'deny',
  rules: [
    {
      id:    'owner-read',
      ...fromRule(isOwner),
      allow: ['read'],
    },
  ],
}
```

---

## `EvaluatableRule<T>`

```typescript
interface EvaluatableRule<T> {
  isSatisfiedBy(value: T): boolean
  evaluate(value: T): unknown
}
```

A structural interface describing any rule that can be evaluated with `fromRule()`. A `@daltonr/rulewrite` `Rule<T>` satisfies this interface, as does any hand-written object that provides these two methods.

| Method          | Description                                                                              |
|-----------------|------------------------------------------------------------------------------------------|
| `isSatisfiedBy` | Fast boolean evaluation. Called by the engine during policy evaluation (every rule).     |
| `evaluate`      | Full structured evaluation. Called only on the deciding rule to produce `matchExplanation`. The return value should ideally be a serialisable `EvaluationResult` but can be any `unknown`. |

---

## `RuleMatchFns<S, R>`

```typescript
interface RuleMatchFns<S extends Subject = Subject, R extends Resource = Resource> {
  match:   (ctx: AuthContext<S, R>) => boolean
  explain: (ctx: AuthContext<S, R>) => unknown
}
```

The return type of `fromRule()`. Designed to be spread into a `PolicyRule`:

```typescript
const rule: PolicyRule<User, Doc> = {
  id:    'my-rule',
  ...fromRule(myEvaluatableRule),
  allow: ['read'],
}
```

---

## `Decision.matchExplanation`

Set by `evaluatePolicy()` after identifying the deciding rule. Contains the return value of `decidingRule.explain?.(ctx)`. Is `undefined` when:

- No rule matched (decision was defaulted).
- The deciding rule does not define an `explain` function.

The devtools sidebar (`@daltonr/authwrite-devtools`) renders `matchExplanation` as a tree when it has the shape `{ satisfied, label, children? }` — the shape produced by `@daltonr/rulewrite`'s `Rule.evaluate()`.

---

© 2026 Devjoy Ltd. MIT License.
