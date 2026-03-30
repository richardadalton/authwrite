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
| 1 | [Defining Policies](./developer-guide/defining-policies.md) | How to structure `PolicyDefinition` objects, set `defaultEffect`, and organise rules with priorities. |
| 2 | [Writing Rules](./developer-guide/writing-rules.md) | `match` and `condition` predicates, `allow` and `deny` action lists, and rule evaluation order. |
| 3 | [Field Filtering](./developer-guide/field-filtering.md) | `FieldRule` definitions, `evaluateRead`, and using `applyFieldFilter` to strip redacted fields. |
| 4 | [Observers](./developer-guide/observers.md) | Implementing `AuthObserver`, wiring observers into the engine, and async observer patterns. |
| 5 | [Policy Loaders](./developer-guide/policy-loaders.md) | Implementing `PolicyLoader`, loading from YAML files, and live reloading with `watch`. |
| 6 | [The Enforcer](./developer-guide/enforcer.md) | Wrapping an engine with `createEnforcer`, switching between `audit`, `enforce`, and `lockdown` modes. |
| 7 | [Testing Policies](./developer-guide/testing-policies.md) | Using `decisionRecorder` and `coverageReport` to assert behaviour and enforce full rule coverage. |
| 8 | [Express Integration](./developer-guide/express-integration.md) | Adding `createAuthMiddleware` to an Express app, custom deny handlers, and `req.authDecision`. |

---

## Reference

| Package | File | What it covers |
|---|---|---|
| `@authwrite/core` | [core-api.md](./reference/core-api.md) | `createAuthEngine`, `AuthEngine`, `createEnforcer`, `Enforcer`, all evaluator methods, `applyFieldFilter`, and every core type. |
| `@authwrite/express` | [express-api.md](./reference/express-api.md) | `createAuthMiddleware`, `AuthMiddlewareConfig`, resolver signatures, `req.authDecision`, and deny response shape. |
| `@authwrite/testing` | [testing-api.md](./reference/testing-api.md) | `decisionRecorder`, `DecisionRecorder` methods, `coverageReport`, and `CoverageReport` properties. |
| `@authwrite/loader-yaml` | [loader-yaml-api.md](./reference/loader-yaml-api.md) | `createFileLoader`, `FileLoaderConfig`, `RuleRegistry`, YAML/JSON schema, `load()`, and `watch()`. |
| `@authwrite/observer-otel` | [observer-otel-api.md](./reference/observer-otel-api.md) | `createOtelObserver`, `OtelObserverConfig`, span attributes, metric instruments, and observer lifecycle. |

---

© 2026 Devjoy Ltd. MIT License.
