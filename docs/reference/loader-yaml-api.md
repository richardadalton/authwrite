# Loader YAML API Reference

This reference covers `@authwrite/loader-yaml` — a file-based `PolicyLoader` that reads policy definitions from YAML or JSON files.

---

## `createFileLoader(config)`

```typescript
export function createFileLoader<S extends Subject = Subject, R extends Resource = Resource>(
  config: FileLoaderConfig<S, R>
): PolicyLoader<S, R>
```

Factory function that returns a `PolicyLoader` backed by a file on disk. Supports `.yaml`, `.yml`, and `.json` file extensions. The returned loader satisfies the `PolicyLoader` interface and can be passed directly to `createAuthEngine`.

### `FileLoaderConfig` options

| Option | Type | Default | Description |
|---|---|---|---|
| `path` | `string` | required | Absolute or relative path to the policy file. Supports `.yaml`, `.yml`, and `.json` extensions. |
| `rules` | `RuleRegistry<S, R>` | required | Map of rule IDs to their runtime function implementations. Every rule ID referenced in the file must have an entry here. |

---

## `RuleRegistry`

```typescript
export type RuleRegistry<S extends Subject = Subject, R extends Resource = Resource> =
  Record<string, RuleFn<S, R>>
```

A plain object mapping each rule `id` string to a `RuleFn`. The registry provides the JavaScript functions that cannot be expressed in a static YAML or JSON file.

### `RuleFn`

```typescript
export interface RuleFn<S extends Subject = Subject, R extends Resource = Resource> {
  match: (ctx: AuthContext<S, R>) => boolean
  condition?: (ctx: AuthContext<S, R>) => boolean
}
```

| Property | Type | Description |
|---|---|---|
| `match` | `(ctx: AuthContext<S, R>) => boolean` | Required. Determines whether the rule applies to the given context. Corresponds to `PolicyRule.match`. |
| `condition` | `(ctx: AuthContext<S, R>) => boolean` | (optional) Secondary predicate evaluated after `match`. Corresponds to `PolicyRule.condition`. |

The `allow`, `deny`, `id`, `description`, and `priority` fields for each rule are read from the file. The `match` and `condition` functions are supplied by the registry entry.

---

## YAML / JSON schema

The following fields are recognised in the policy file.

### Top-level fields

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | `string` | yes | Unique identifier for the policy. Becomes `PolicyDefinition.id`. |
| `version` | `string` | no | Optional version label for audit purposes. |
| `description` | `string` | no | Human-readable description of the policy. |
| `defaultEffect` | `'allow' \| 'deny'` | yes | Effect applied when no rule matches. |
| `rules` | `object[]` | yes | List of rule definitions. May be an empty array. |
| `fieldRules` | `object[]` | no | List of field-level visibility rule definitions. |

### `rules[]` fields

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | `string` | yes | Rule identifier. Must match an entry in the `RuleRegistry`. Appears as `Decision.reason` when the rule fires. |
| `description` | `string` | no | Human-readable description of the rule. |
| `priority` | `number` | no | Evaluation order. Lower values are evaluated first. Defaults to `0`. |
| `allow` | `string[]` | no | Actions this rule allows. |
| `deny` | `string[]` | no | Actions this rule denies. |

### `fieldRules[]` fields

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | `string` | yes | Unique identifier for the field rule. Must match an entry in the `RuleRegistry` for its `match` function. |
| `expose` | `string[]` | yes | Field names visible when this rule matches. |
| `redact` | `string[]` | yes | Field names hidden when this rule matches. Takes precedence over `expose`. |

### Example YAML

```yaml
id: documents-policy
version: "1.0.0"
description: Access rules for the documents resource.
defaultEffect: deny

rules:
  - id: admin-full-access
    description: Admins can perform any action.
    priority: 0
    allow: ["read", "update", "delete", "publish"]

  - id: owner-can-edit
    description: Resource owners may read and update their own documents.
    priority: 10
    allow: ["read", "update"]

fieldRules:
  - id: hide-internal-fields
    expose: ["id", "title", "body", "createdAt"]
    redact: ["internalNotes", "auditLog"]
```

---

## `load()`

```typescript
load(): Promise<PolicyDefinition<S, R>>
```

Reads the file at `config.path`, parses it, merges the `RuleRegistry` functions into the parsed rules, and returns a fully constructed `PolicyDefinition`.

### Errors thrown

| Condition | Error message |
|---|---|
| File not found at `config.path` | Thrown as a filesystem error from the underlying `fs` call. |
| File content is not valid YAML or JSON | Thrown as a parse error with the parser's message. |
| Required top-level field missing (`id` or `defaultEffect`) | Thrown with a message identifying the missing field. |
| `rules` field is absent | Thrown with a message indicating `rules` is required. |
| A rule `id` in the file has no matching entry in `RuleRegistry` | Thrown with a message identifying the unregistered rule ID. |

---

## `watch(cb)`

```typescript
watch(cb: (policy: PolicyDefinition<S, R>) => void): void
```

Subscribes to file changes. When the file at `config.path` changes on disk, the loader re-runs `load()` and passes the new `PolicyDefinition` to `cb`.

| Parameter | Type | Description |
|---|---|---|
| `cb` | `(policy: PolicyDefinition<S, R>) => void` | Callback invoked with the freshly loaded policy after each detected change. |

File watching is implemented with Node's `fs.watch` with a 50 ms debounce to coalesce rapid successive write events. Pass this loader to `createAuthEngine` and call `engine.reload()` inside the callback to apply updates at runtime without restarting the process.

```typescript
const loader = createFileLoader({ path: './policy.yaml', rules: myRegistry })

const engine = createAuthEngine({ loader })

loader.watch(updated => {
  engine.reload(updated)
})
```

---

© 2026 Devjoy Ltd. MIT License.
