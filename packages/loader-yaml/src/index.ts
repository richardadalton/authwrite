import { readFile } from 'node:fs/promises'
import { watch } from 'node:fs'
import { parse as parseYaml } from 'yaml'
import type {
  Action,
  AuthContext,
  FieldRule,
  PolicyDefinition,
  PolicyLoader,
  PolicyRule,
  Resource,
  Subject,
} from '@authwrite/core'

// ─── Serializable file schema ─────────────────────────────────────────────────
//
// Rules and fieldRules in the file contain everything EXCEPT functions.
// The match/condition functions are provided through the RuleRegistry.

interface SerializableRule {
  id: string
  description?: string
  priority?: number
  allow?: Action[]
  deny?: Action[]
}

interface SerializableFieldRule {
  id: string
  expose: string[]
  redact: string[]
}

interface SerializablePolicy {
  id: string
  version?: string
  description?: string
  defaultEffect: 'allow' | 'deny'
  rules: SerializableRule[]
  fieldRules?: SerializableFieldRule[]
}

// ─── Rule registry ────────────────────────────────────────────────────────────
//
// Maps rule IDs to their runtime functions. Entries may be used by both
// rules and fieldRules — the match/condition shape is the same for both.

export interface RuleFn<
  S extends Subject = Subject,
  R extends Resource = Resource,
> {
  match: (ctx: AuthContext<S, R>) => boolean
  condition?: (ctx: AuthContext<S, R>) => boolean
}

export type RuleRegistry<
  S extends Subject = Subject,
  R extends Resource = Resource,
> = Record<string, RuleFn<S, R>>

// ─── Config ───────────────────────────────────────────────────────────────────

export interface FileLoaderConfig<
  S extends Subject = Subject,
  R extends Resource = Resource,
> {
  /** Absolute or relative path to a .yaml, .yml, or .json policy file. */
  path: string
  /** Maps rule IDs (from the file) to their match/condition implementations. */
  rules: RuleRegistry<S, R>
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function validate(raw: unknown): SerializablePolicy {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Policy file must be a YAML/JSON object')
  }

  const p = raw as Record<string, unknown>

  if (typeof p['id'] !== 'string' || !p['id']) {
    throw new Error('Policy file must have a string "id" field')
  }
  if (p['defaultEffect'] !== 'allow' && p['defaultEffect'] !== 'deny') {
    throw new Error(`"defaultEffect" must be "allow" or "deny", got: ${JSON.stringify(p['defaultEffect'])}`)
  }
  if (!Array.isArray(p['rules'])) {
    throw new Error('Policy file must have a "rules" array')
  }

  return p as unknown as SerializablePolicy
}

function mergeRules<S extends Subject, R extends Resource>(
  serializableRules: SerializableRule[],
  registry: RuleRegistry<S, R>,
  context: 'rules' | 'fieldRules',
): PolicyRule<S, R>[] {
  return serializableRules.map(sr => {
    const fn = registry[sr.id]
    if (!fn) {
      throw new Error(
        `Rule "${sr.id}" (from ${context}) has no implementation in the registry. ` +
        `Add an entry for "${sr.id}" to the rules registry.`
      )
    }
    const rule: PolicyRule<S, R> = {
      id:          sr.id,
      match:       fn.match,
      allow:       sr.allow,
      deny:        sr.deny,
    }
    if (sr.description !== undefined) rule.description = sr.description
    if (sr.priority    !== undefined) rule.priority    = sr.priority
    if (fn.condition   !== undefined) rule.condition   = fn.condition
    return rule
  })
}

function mergeFieldRules<S extends Subject, R extends Resource>(
  serializableFieldRules: SerializableFieldRule[],
  registry: RuleRegistry<S, R>,
): FieldRule<S, R>[] {
  return serializableFieldRules.map(sfr => {
    const fn = registry[sfr.id]
    if (!fn) {
      throw new Error(
        `FieldRule "${sfr.id}" has no implementation in the registry. ` +
        `Add an entry for "${sfr.id}" to the rules registry.`
      )
    }
    return {
      id:     sfr.id,
      match:  fn.match,
      expose: sfr.expose,
      redact: sfr.redact,
    }
  })
}

function buildPolicy<S extends Subject, R extends Resource>(
  content: string,
  registry: RuleRegistry<S, R>,
): PolicyDefinition<S, R> {
  const raw = parseYaml(content)
  const serializable = validate(raw)

  const policy: PolicyDefinition<S, R> = {
    id:            serializable.id,
    defaultEffect: serializable.defaultEffect,
    rules:         mergeRules(serializable.rules, registry, 'rules'),
  }

  if (serializable.version     !== undefined) policy.version     = serializable.version
  if (serializable.description !== undefined) policy.description = serializable.description

  if (serializable.fieldRules && serializable.fieldRules.length > 0) {
    policy.fieldRules = mergeFieldRules(serializable.fieldRules, registry)
  }

  return policy
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export function createFileLoader<
  S extends Subject = Subject,
  R extends Resource = Resource,
>(config: FileLoaderConfig<S, R>): PolicyLoader<S, R> {

  async function load(): Promise<PolicyDefinition<S, R>> {
    const content = await readFile(config.path, 'utf-8')
    return buildPolicy(content, config.rules)
  }

  function watchFile(cb: (policy: PolicyDefinition<S, R>) => void): void {
    // Debounce: many editors write files in multiple events for a single save.
    let debounceTimer: ReturnType<typeof setTimeout> | undefined

    watch(config.path, () => {
      clearTimeout(debounceTimer)
      debounceTimer = setTimeout(async () => {
        try {
          const policy = await load()
          cb(policy)
        } catch {
          // Swallow parse errors during watch — the file may be mid-write.
          // The next fs event (when the write completes) will retry.
        }
      }, 50)
    })
  }

  return { load, watch: watchFile }
}
