# Authwrite Developer Guide

This guide covers everything you need to build with Authwrite, from understanding how the decision engine works to wiring it into a production Express application. Each chapter builds on the last. If you are new to the library, read in order. If you are looking for a specific topic, use the table below.

---

| Chapter | Title | What you learn |
|---|---|---|
| 1 | [How the Engine Works](01-engine-and-decisions.md) | The core decision model: how policies are evaluated, what a `Decision` contains, and why the engine is deny-by-default. |
| 2 | [Policies and Rules](02-policies-and-rules.md) | The structure of a `PolicyDefinition`, the anatomy of a `PolicyRule`, and the design choices that make rules composable and testable. |
| 3 | [Actions, Subjects, and Resources](03-actions-and-resources.md) | The `Subject`, `Resource`, and `Action` interfaces, the `AuthContext` that binds them, and the three action categories that determine which fields are present on the context. |
| 4 | [Priority and Conflict Resolution](04-priority-and-conflicts.md) | How Authwrite resolves conflicts when two rules both match and disagree on the outcome, what `priority` means in practice, and how to model common override scenarios correctly. |
| 5 | [Field-Level Filtering](05-field-filtering.md) | How `evaluateRead` works, how to define `fieldRules` that expose or redact specific fields, and how field decisions relate to action decisions. |
| 6 | [Enforcement Modes](06-enforcer.md) | How to shadow-run a policy in `audit` mode before enforcing it, what `lockdown` mode does, and why engine observers always see the honest decision. |
| 7 | [Observers](07-observers.md) | The `AuthObserver` interface, how to write an audit log observer, what `onError` and `onPolicyReload` are for, and why side effects belong in observers rather than rules. |
| 8 | [Policy Loaders](08-loaders.md) | How to load a policy from a YAML or JSON file, the `RuleRegistry` pattern that connects file-defined rules to TypeScript match functions, and how hot reload works via `fromLoader`. |
| 9 | [Testing](09-testing.md) | How to test your policy directly against the engine, use `decisionRecorder` to capture decisions, use `coverageReport` to find rules that never fired, and test enforcement modes. |
| 10 | [Framework Adapters](10-framework-adapters.md) | How the Express, Fastify, Next.js, and Hono adapters translate `AuthEvaluator` into framework-native middleware, and how subject and resource resolvers work. |
| 11 | [HATEOAS](11-hateoas.md) | How to build permission-aware hypermedia links using `buildLinks`, `embedLinks`, and `linksFromDecisions`. |
| 12 | [Policy Resolvers](12-policy-resolver.md) | How `PolicyResolver` supports static policies, dynamic resolver functions, and composition strategies (`intersect`, `union`, `firstMatch`). Includes `fromLoader` and `evaluatePolicy`. |
| 13 | [Authorization Anti-Patterns](13-anti-patterns.md) | Thirteen common authorization mistakes — with bad code examples, explanations of why each fails, and the Authwrite fix. |
| 14 | [Composable Rules with rulewrite](14-rulewrite.md) | How to build rules from composable predicates using `@daltonr/rulewrite`, wire them into a policy with `fromRule()`, and read the structured match trace from `Decision.matchExplanation`. |

---

© 2026 Devjoy Ltd. MIT License.
