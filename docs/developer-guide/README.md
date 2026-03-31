# Authwrite Developer Guide

This guide covers everything you need to build with Authwrite, from understanding how the decision engine works to wiring it into a production Express application. Each chapter builds on the last. If you are new to the library, read in order. If you are looking for a specific topic, use the table below.

---

| Chapter | Title | What you learn |
|---|---|---|
| 1 | How the Engine Works | The core decision model: how policies are evaluated, what a `Decision` contains, and why the engine is deny-by-default. |
| 2 | Defining a Policy | How to construct a `PolicyDefinition` in TypeScript, write rules with `allow` and `deny` entries, and set rule priorities. |
| 3 | Subjects and Resources | How to type your `Subject` and `Resource` domain objects and pass them into the engine via `AuthContext`. |
| 4 | Actions | The three built-in action categories (`read`, `write`, `delete`), how to use wildcard matching, and how to define custom actions. |
| 5 | Field Filtering | How `evaluateRead` works, how to define `fieldRules` that expose or redact specific fields, and how field decisions relate to action decisions. |
| 6 | Enforcement Modes | How to shadow-run a policy in `audit` mode before enforcing it, what `lockdown` mode does, and why engine observers always see the honest decision. |
| 7 | Observers | The `AuthObserver` interface, how to write an audit log observer, what `onError` and `onPolicyReload` are for, and why side effects belong in observers rather than rules. |
| 8 | Policy Loaders | How to load a policy from a YAML or JSON file, the `RuleRegistry` pattern that connects file-defined rules to TypeScript match functions, and how hot reload works via `fromLoader`. |
| 9 | Testing | How to test your policy directly against the engine, use `decisionRecorder` to capture decisions, use `coverageReport` to find rules that never fired, and test enforcement modes. |
| 10 | Framework Adapters | How the Express, Fastify, Next.js, and Hono adapters translate `AuthEvaluator` into framework-native middleware, and how subject and resource resolvers work. |
| 11 | HATEOAS | How to build permission-aware hypermedia links using `buildLinks`, `embedLinks`, and `linksFromDecisions`. |
| 12 | Policy Resolvers | How `PolicyResolver` supports static policies, dynamic resolver functions, and composition strategies (`intersect`, `union`, `firstMatch`). Includes `fromLoader` and `evaluatePolicy`. |
| 13 | Authorization Anti-Patterns | Thirteen common authorization mistakes — with bad code examples, explanations of why each fails, and the Authwrite fix. |

---

© 2026 Devjoy Ltd. MIT License.
