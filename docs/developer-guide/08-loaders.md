# Chapter 8: Policy Loaders

A policy defined directly in TypeScript source is tightly coupled to your deployment cycle. Changing which rule fires on a given action, adjusting priorities, or toggling `defaultEffect` all require a code change, a build, and a deploy. For low-traffic internal tools that might be acceptable, but for anything that serves real users, the inability to update policy without a redeploy is a significant constraint. Loaders solve this by separating the policy structure — which can live in a file that operators can edit — from the match and condition logic, which must remain in code. This chapter covers the `PolicyLoader` interface, the YAML/JSON file loader, the registry pattern that bridges the two halves, and how to wire up hot reload using `fromLoader`.

---

## The PolicyLoader interface

A loader is any object that implements two methods: `load()`, which fetches the current policy asynchronously, and the optional `watch()`, which registers a callback to be called whenever the policy changes.

```typescript
interface PolicyLoader<S, R> {
  load(): Promise<PolicyDefinition<S, R>>
  watch?(cb: (policy: PolicyDefinition<S, R>) => void): void
}
```

The interface is intentionally minimal. You could implement a loader that fetches from a remote configuration service, reads from a database, or constructs a policy from feature flags — as long as it satisfies this contract, the engine does not care.

---

## The file loader

The `@daltonr/authwrite-loader-yaml` package provides `createFileLoader`, which reads a policy from a `.yaml`, `.yml`, or `.json` file on disk. It implements both `load()` and `watch()`.

```
┌─────────────────────────────────────────────────────────┐
│                     Disk                                 │
│  ┌──────────────────────────────────────────────────┐   │
│  │  policy.yaml  (id, version, rules, fieldRules)   │   │
│  └─────────────────────┬────────────────────────────┘   │
└────────────────────────┼────────────────────────────────┘
                         │ fs.watch (50ms debounce)
                         ▼
              ┌─────────────────────┐
              │    createFileLoader  │
              │                     │
              │  parse YAML/JSON    │
              │  hydrate with       │
              │  RuleRegistry fns   │
              └──────────┬──────────┘
                         │
                         ▼
              PolicyDefinition<S, R>
                         │
                         ▼
              fromLoader cache updated
```

---

## Why functions cannot live in YAML

Policy files are data. They can express that a rule named `owner-full-access` should allow the actions `['*']` for any subject matching a condition — but they cannot express what "matching a condition" means in terms of your actual domain objects. That logic is TypeScript: it reads fields on your `Subject` and `Resource` types, calls methods, and returns a boolean.

The registry pattern bridges this gap. The YAML file gives rules their identity and structure. The code gives rules their behavior.

---

## YAML schema

A policy file has four top-level keys: `id`, `version`, `defaultEffect`, and `rules`. An optional `fieldRules` array controls field-level access for `evaluateRead`.

```yaml
id: documents
version: 1.2.0
defaultEffect: deny

rules:
  - id: owner-full-access
    description: Document owners can do anything
    allow: ['*']

  - id: archived-blocks-mutation
    description: Archived documents cannot be written or deleted
    priority: 5
    deny: [write, delete]

  - id: reviewer-can-read
    description: Users with the reviewer role can read any document
    allow: [read]

fieldRules:
  - id: confidential-field-guard
    expose: [id, title, status, createdAt]
    redact: [content, internalNotes]
```

A few things to notice:

- `priority` is optional. Rules without an explicit priority have priority 0. A higher number means higher priority — `priority: 5` beats an unprioritised rule.
- `allow: ['*']` matches any action. This is the only wildcard the schema supports.
- `fieldRules` entries are keyed by `id` so the registry can attach match logic to them, just like action rules.

---

## The rule registry

The `RuleRegistry` maps each rule ID from the YAML file to a `RuleFn` object. The `match` function determines whether the rule applies to a given context. The optional `condition` function is an additional predicate that must also pass before the rule fires.

```typescript
import { createFileLoader } from '@daltonr/authwrite-loader-yaml'
import type { RuleRegistry } from '@daltonr/authwrite-loader-yaml'

interface Subject { id: string; role: string }
interface Resource { id: string; ownerId: string; status: string }

const rules: RuleRegistry<Subject, Resource> = {
  'owner-full-access': {
    match: ({ subject, resource }) => resource?.ownerId === subject.id,
  },
  'archived-blocks-mutation': {
    match: ({ resource }) => resource?.status === 'archived',
  },
  'reviewer-can-read': {
    match: ({ subject }) => subject.role === 'reviewer',
  },
  'confidential-field-guard': {
    match: ({ resource }) => resource?.status === 'confidential',
  },
}

const loader = createFileLoader<Subject, Resource>({
  path: './policy.yaml',
  rules,
})
```

A few things to notice:

- Every rule ID in the YAML file that needs custom logic must have a corresponding entry in the registry. Rules without a registry entry will still parse, but their `match` function will default to always-true.
- The `resource` parameter may be `undefined` — guard against it when your rules depend on resource properties.
- The registry is defined once at startup. It is ordinary TypeScript and can import from anywhere in your codebase.

---

## Startup pattern with fromLoader

Use `fromLoader` from `@daltonr/authwrite-core` to convert a `PolicyLoader` into a `PolicyResolver`. `fromLoader` loads the policy eagerly, caches it, and wires the loader's `watch()` callback to update the cache automatically. The engine is then created synchronously.

```typescript
import { createAuthEngine, fromLoader } from '@daltonr/authwrite-core'
import { createFileLoader } from '@daltonr/authwrite-loader-yaml'

async function bootstrap() {
  const loader = createFileLoader<Subject, Resource>({
    path: './policy.yaml',
    rules,
  })

  // fromLoader loads the initial policy and wires watch() for hot reload
  const policy = await fromLoader(loader)

  // createAuthEngine is now synchronous
  const engine = createAuthEngine({ policy })

  return engine
}
```

When the file changes, the watcher callback fires and the cached policy updates. The next evaluation uses the new policy automatically.

If you need to be notified when a reload occurs — for example, to fire `onPolicyReload` observers or to signal in a test — pass an optional callback to `fromLoader`:

```typescript
const policy = await fromLoader(loader, (newPolicy) => {
  console.log(`Policy reloaded: ${newPolicy.id}@${newPolicy.version}`)
  // engine.reload(newPolicy)  // call this to trigger onPolicyReload observers
})
```

If you need explicit control — for example, to validate the policy before it goes live — you can manage `load()` and `watch()` manually and use `engine.reload()` directly:

```typescript
const initialPolicy = await loader.load()
const engine = createAuthEngine({ policy: initialPolicy })

loader.watch((updatedPolicy) => {
  // Validate before applying
  if (validate(updatedPolicy)) {
    engine.reload(updatedPolicy)
  }
})
```

---

## The 50ms debounce

Most text editors do not write files in a single atomic operation. A save event typically produces two or three filesystem events in rapid succession as the editor writes a temp file, renames it, and updates metadata. Without debouncing, each of those events would trigger a reload and your observers would fire multiple times for a single save.

`createFileLoader` applies a 50ms debounce to the `fs.watch` callback. If three events arrive within 50ms of each other, only one reload fires. You do not need to implement this yourself.

---

## What you can change without a code deploy

The loader pattern gives operators a meaningful change surface that does not require touching application code.

| Change | Requires deploy? |
|---|---|
| Add a new rule to the YAML file | No — but the registry entry must already exist |
| Remove a rule from the YAML file | No |
| Change a rule's priority | No |
| Change which actions a rule allows or denies | No |
| Change `defaultEffect` | No |
| Change the `match` or `condition` logic | Yes — that is TypeScript code |
| Add a new rule with new match logic | Yes — registry entry needed first |
| Add a new field to `fieldRules` | No — if the rule ID is already registered |

The practical workflow for a new rule with new logic: deploy a code change that adds the registry entry (but does not yet add the rule to the YAML), then edit the YAML file at any time afterward to activate the rule. This separates code deployment from policy activation.

---

Chapter 9 covers testing: how to write a test suite for your policy, use the `decisionRecorder` to capture events, and use `coverageReport` to find rules that never fired.

© 2026 Devjoy Ltd. MIT License.
