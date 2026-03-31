# Chapter 12: Policy Resolvers

A static `PolicyDefinition` works well when your authorization rules are fixed at startup. But real applications often need policies that change over time — loaded from files, fetched from a database, or varied by tenant. The `PolicyResolver` abstraction handles all of these cases uniformly, and adds composition strategies for combining multiple policies into one. This chapter covers the three resolver forms, how to convert a loader into a resolver, and how to use `intersect`, `union`, and `firstMatch` to build layered authorization logic.

---

## The three resolver forms

`PolicyResolver` is a union type accepted wherever a policy is expected:

```typescript
type PolicyResolver<S, R, A> =
  | PolicyDefinition<S, R, A>           // static: same policy every call
  | PolicyResolverFn<S, R, A>           // dynamic: function called per evaluation
  | CompositeResolver<S, R, A>          // composite: intersect / union / firstMatch
```

Pass any of these forms to `createAuthEngine`:

```typescript
// Static policy
const engine = createAuthEngine({ policy: myPolicy })

// Dynamic resolver function
const engine = createAuthEngine({ policy: (ctx) => choosePolicy(ctx) })

// Composite
const engine = createAuthEngine({ policy: intersect(basePolicy, tenantPolicy) })
```

---

## Static policy

The simplest form. A `PolicyDefinition` object is used for every evaluation. `engine.getPolicy()` returns it immediately.

```typescript
const policy: PolicyDefinition<User, Doc> = {
  id:            'documents',
  defaultEffect: 'deny',
  rules: [
    { id: 'owner-access', match: ctx => ctx.resource?.ownerId === ctx.subject.id, allow: ['*'] },
  ],
}

const engine = createAuthEngine({ policy })
```

---

## Dynamic resolver function

A `PolicyResolverFn` is called on every evaluation. It receives the full `AuthContext` and returns a `PolicyDefinition` (or a `Promise<PolicyDefinition>`). Use this when the correct policy depends on runtime context.

```typescript
// Different policies for different resource types
const engine = createAuthEngine({
  policy: async (ctx) => {
    if (ctx.resource?.type === 'document') return documentPolicy
    if (ctx.resource?.type === 'project')  return projectPolicy
    return systemPolicy
  },
})
```

A function resolver updates `engine.getPolicy()` after each evaluation — it caches the most recently resolved policy. Before the first evaluation, `getPolicy()` returns `undefined`.

```typescript
const engine = createAuthEngine({ policy: () => documentPolicy })

engine.getPolicy()  // → undefined (no evaluation yet)

await engine.evaluate({ subject, resource, action: 'read' })

engine.getPolicy()  // → documentPolicy (cached after first evaluation)
```

---

## fromLoader

`fromLoader` converts a `PolicyLoader` into a `PolicyResolverFn`. It loads the policy eagerly, caches it, and wires up the loader's `watch` callback to update the cache on hot-reload. The returned resolver function is synchronous after initialisation.

```typescript
import { createAuthEngine, fromLoader } from '@authwrite/core'
import { createFileLoader } from '@authwrite/loader-yaml'

const loader = createFileLoader<User, Doc>({ path: './policy.yaml', rules })

// Initialise the resolver — loads the policy and wires watch()
const policy = await fromLoader(loader)

// Engine creation is synchronous from here
const engine = createAuthEngine({ policy })
```

When the file changes, the watcher callback runs and the cached policy is updated. The next evaluation uses the new policy automatically.

Pass an optional `onReload` callback to be notified when the policy updates — useful for triggering `engine.reload()` to fire `onPolicyReload` observers, or for signalling in tests:

```typescript
const policy = await fromLoader(loader, (newPolicy) => {
  console.log(`Policy updated: ${newPolicy.id}@${newPolicy.version}`)
})
```

---

## Composition

Three helpers combine multiple resolvers into a single `CompositeResolver`. The engine evaluates all children and combines their decisions according to the strategy.

### `intersect` — all must allow

`intersect` evaluates every resolver and allows only when all of them allow. The first denial wins; its `reason` appears on the composite decision.

```typescript
import { createAuthEngine, intersect } from '@authwrite/core'

// Subject must satisfy both the base policy and the tenant-specific policy
const engine = createAuthEngine({
  policy: intersect(basePolicy, tenantPolicy),
})
```

**When to use:** Layered access control — a baseline policy sets the floor, a tenant or context policy can only restrict it further, never expand it.

### `union` — any may allow

`union` evaluates every resolver and allows when any of them allows. The first allow wins; its `reason` appears on the composite decision. If all deny, the reason is `'union-all-denied'`.

```typescript
// Subject can access if they are the owner OR an admin
const engine = createAuthEngine({
  policy: union(ownerPolicy, adminPolicy),
})
```

**When to use:** Parallel grant paths — owner access, role-based access, and delegation are separate policies that each grant independently.

### `firstMatch` — first with a rule wins

`firstMatch` evaluates resolvers in order and uses the first one that has a matching rule (a non-default decision). If a policy's `defaultEffect` would apply, it falls through to the next resolver. The last resolver is the unconditional fallback.

```typescript
// Use the special-case policy if it has a rule for this action;
// fall through to the general policy otherwise
const engine = createAuthEngine({
  policy: firstMatch(specialCasePolicy, generalPolicy),
})
```

**When to use:** Policy chains with override layers — a customer-specific policy sits on top of a product-wide default, and only overrides what it explicitly handles.

---

## Composite policy labels

When a composite resolver produces a decision, `decision.policy` identifies all the child policies that participated:

```
intersect(base-policy@1.0.0, tenant-policy@2.0.0)
union(owner-policy, admin-policy)
firstMatch(special-case, general@1.0.0)
```

This makes it straightforward to identify which policies were active when auditing a specific decision.

---

## evaluatePolicy — pure dry-run

`evaluatePolicy` evaluates a `PolicyDefinition` against a context and returns a `Decision` without creating an engine, firing observers, or applying any mode override. Use it to unit-test individual rules or to dry-run a policy before installing it.

```typescript
import { evaluatePolicy } from '@authwrite/core'

// Test a single rule without an engine
const decision = evaluatePolicy(myPolicy, {
  subject:  { id: 'u1', roles: ['viewer'] },
  resource: { type: 'document', id: 'doc-1', ownerId: 'u2' },
  action:   'write',
})

expect(decision.allowed).toBe(false)
expect(decision.reason).toBe('default')
```

`evaluatePolicy` throws if a rule function throws — there is no error swallowing. This is intentional for testing: if a rule throws during evaluation, the test fails immediately.

---

## Choosing the right form

| Scenario | Use |
|---|---|
| Single policy, never changes | Static `PolicyDefinition` |
| Policy loaded from a file or database | `fromLoader(loader)` |
| Different policies for different resource types | Dynamic resolver function |
| All conditions must be satisfied (e.g. role AND tenant) | `intersect` |
| Any condition is sufficient (e.g. owner OR admin) | `union` |
| Specialised override layer on top of a general policy | `firstMatch` |
| Testing a rule in isolation | `evaluatePolicy` |

---

Chapter 13 covers authorization anti-patterns — the thirteen most common mistakes teams make when implementing authorization, and how Authwrite addresses each one.

© 2026 Devjoy Ltd. MIT License.
