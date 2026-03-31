# Authwrite Documentation

This documentation covers the full Authwrite authorization library — a zero-dependency TypeScript engine for deny-by-default authorization with structured decision reasons, field-level filtering, observer hooks, and first-class testing utilities. It is organized into three sections: getting started guides for first-time setup, a developer guide for building real-world policies, and a package-level API reference for day-to-day lookup.

---

## Getting Started

| File | Description |
|---|---|
| [Installation](./getting-started/installation.md) | How to install the core package and optional adapters. Covers npm, pnpm, and yarn. |
| [Core Concepts](./getting-started/core-concepts.md) | Subjects, resources, actions, policies, rules, and the deny-by-default model explained. |
| [First Policy](./getting-started/first-policy.md) | Step-by-step walkthrough: define a policy, create an engine, evaluate your first decision. |

---

## Developer Guide

| Chapter | Title | What you learn |
|---|---|---|
| 1 | [How the Engine Works](./developer-guide/01-engine-and-decisions.md) | The core decision model: how policies are evaluated, what a `Decision` contains, and why the engine is deny-by-default. |
| 2 | [Policies and Rules](./developer-guide/02-policies-and-rules.md) | The structure of a `PolicyDefinition`, the anatomy of a `PolicyRule`, and the design choices that make rules composable and testable. |
| 3 | [Actions, Subjects, and Resources](./developer-guide/03-actions-and-resources.md) | The `Subject`, `Resource`, and `Action` interfaces, the `AuthContext` that binds them, and the three action categories that determine which fields are present on the context. |
| 4 | [Priority and Conflict Resolution](./developer-guide/04-priority-and-conflicts.md) | How Authwrite resolves conflicts when two rules both match and disagree on the outcome, what `priority` means in practice, and how to model common override scenarios correctly. |
| 5 | [Field-Level Filtering](./developer-guide/05-field-filtering.md) | How `evaluateRead` works, how to define `fieldRules` that expose or redact specific fields, and how field decisions relate to action decisions. |
| 6 | [Enforcement Modes](./developer-guide/06-enforcer.md) | How to shadow-run a policy in `audit` mode before enforcing it, what `lockdown` mode does, and why engine observers always see the honest decision. |
| 7 | [Observers](./developer-guide/07-observers.md) | The `AuthObserver` interface, how to write an audit log observer, what `onError` and `onPolicyReload` are for, and why side effects belong in observers rather than rules. |
| 8 | [Policy Loaders](./developer-guide/08-loaders.md) | How to load a policy from a YAML or JSON file, the `RuleRegistry` pattern that connects file-defined rules to TypeScript match functions, and how hot reload works via `fromLoader`. |
| 9 | [Testing](./developer-guide/09-testing.md) | How to test your policy directly against the engine, use `decisionRecorder` to capture decisions, use `coverageReport` to find rules that never fired, and test enforcement modes. |
| 10 | [Framework Adapters](./developer-guide/10-framework-adapters.md) | How the Express, Fastify, Next.js, and Hono adapters translate `AuthEvaluator` into framework-native middleware, and how subject and resource resolvers work. |
| 11 | [HATEOAS](./developer-guide/11-hateoas.md) | How to build permission-aware hypermedia links using `buildLinks`, `embedLinks`, and `linksFromDecisions`. |
| 12 | [Policy Resolvers](./developer-guide/12-policy-resolver.md) | How `PolicyResolver` supports static policies, dynamic resolver functions, and composition strategies (`intersect`, `union`, `firstMatch`). Includes `fromLoader` and `evaluatePolicy`. |
| 13 | [Authorization Anti-Patterns](./developer-guide/13-anti-patterns.md) | Thirteen common authorization mistakes — with bad code examples, explanations of why each fails, and the Authwrite fix. |
| 14 | [Composable Rules with rulewrite](./developer-guide/14-rulewrite.md) | How to build rules from composable predicates using `@daltonr/rulewrite`, wire them into a policy with `fromRule()`, and read the structured match trace from `Decision.matchExplanation`. |

---

## Reference

| Package | File | What it covers |
|---|---|---|
| `@daltonr/authwrite-core` | [core-api.md](./reference/core-api.md) | `createAuthEngine`, `evaluatePolicy`, `fromLoader`, `intersect`, `union`, `firstMatch`, and all core types. |
| `@daltonr/authwrite-express` | [express-api.md](./reference/express-api.md) | `createExpressAuth`, `createAuthMiddleware`, resolver signatures, `req.authDecision`, and `onDeny`. |
| `@daltonr/authwrite-fastify` | [fastify-api.md](./reference/fastify-api.md) | `createAuthHook`, `AuthHookConfig`, resolver signatures, `req.authDecision`, and `onDeny`. |
| `@daltonr/authwrite-nextjs` | [nextjs-api.md](./reference/nextjs-api.md) | `withAuth`, `WithAuthConfig`, `RouteContext`, resolver signatures, and `onDeny`. |
| `@daltonr/authwrite-hono` | [hono-api.md](./reference/hono-api.md) | `createAuthMiddleware`, `AuthMiddlewareConfig`, `AUTH_DECISION_KEY`, resolver signatures, and `onDeny`. |
| `@daltonr/authwrite-hateoas` | [hateoas-api.md](./reference/hateoas-api.md) | `buildLinks`, `embedLinks`, `linksFromDecisions`, `LinkTemplate`, `LinkMap`, and enforcer mode behaviour. |
| `@daltonr/authwrite-testing` | [testing-api.md](./reference/testing-api.md) | `decisionRecorder`, `DecisionRecorder` methods, `coverageReport`, and `CoverageReport`. |
| `@daltonr/authwrite-loader-yaml` | [loader-yaml-api.md](./reference/loader-yaml-api.md) | `createFileLoader`, `FileLoaderConfig`, `RuleRegistry`, `RuleFn`, the YAML/JSON schema, and `watch` behaviour. |
| `@daltonr/authwrite-loader-db` | [loader-db-api.md](./reference/loader-db-api.md) | `createDbLoader`, `DbLoaderConfig`, `RuleRegistry`, `RuleFn`, the serializable policy schema, and polling behaviour. |
| `@daltonr/authwrite-observer-otel` | [observer-otel-api.md](./reference/observer-otel-api.md) | `createOtelObserver`, `OtelObserverConfig`, span attributes, metric instruments, and peer dependency requirements. |
| `@daltonr/authwrite-observer-pg` | [observer-pg-api.md](./reference/observer-pg-api.md) | `createPgObserver`, `PgObserverConfig`, `QueryClient`, table schema, and fire-and-forget write behaviour. |
| `@daltonr/authwrite-observer-redis` | [observer-redis-api.md](./reference/observer-redis-api.md) | `createRedisObserver`, `RedisObserverConfig`, `RedisObserver`, `lookup`, `invalidate`, `flush`, and TTL behaviour. |
| `@daltonr/authwrite-devtools` | [devtools-api.md](./reference/devtools-api.md) | `createDevTools`, `DevToolsObserver`, `createDevServer`, `PolicySwitcherOptions`, decision flagging, and dev server endpoints. |
| `@daltonr/authwrite-rulewrite` | [rulewrite-api.md](./reference/rulewrite-api.md) | `fromRule`, `EvaluatableRule`, `RuleMatchFns`, and `Decision.matchExplanation`. |

---

© 2026 Devjoy Ltd. MIT License.
