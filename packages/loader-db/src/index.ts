import type {
  Action,
  AuthContext,
  FieldRule,
  PolicyDefinition,
  PolicyLoader,
  PolicyRule,
  Resource,
  Subject,
} from '@daltonr/authwrite-core'

// ─── Serializable schema ──────────────────────────────────────────────────────
//
// Rules returned by the query contain everything EXCEPT functions.
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

export interface DbLoaderConfig<
  S extends Subject = Subject,
  R extends Resource = Resource,
> {
  /**
   * Called on each load/poll to fetch raw policy data from the database.
   * Must return an object matching the serializable policy schema.
   */
  query: () => Promise<unknown>
  /** Maps rule IDs (from the query result) to their match/condition implementations. */
  rules: RuleRegistry<S, R>
  /**
   * How often to poll for policy changes, in milliseconds.
   * @default 30000
   */
  pollInterval?: number
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function validate(raw: unknown): SerializablePolicy {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Policy data must be an object')
  }

  const p = raw as Record<string, unknown>

  if (typeof p['id'] !== 'string' || !p['id']) {
    throw new Error('Policy data must have a string "id" field')
  }
  if (p['defaultEffect'] !== 'allow' && p['defaultEffect'] !== 'deny') {
    throw new Error(`"defaultEffect" must be "allow" or "deny", got: ${JSON.stringify(p['defaultEffect'])}`)
  }
  if (!Array.isArray(p['rules'])) {
    throw new Error('Policy data must have a "rules" array')
  }

  return p as unknown as SerializablePolicy
}

function mergeRules<S extends Subject, R extends Resource>(
  serializableRules: SerializableRule[],
  registry: RuleRegistry<S, R>,
): PolicyRule<S, R>[] {
  return serializableRules.map(sr => {
    const fn = registry[sr.id]
    if (!fn) {
      throw new Error(
        `Rule "${sr.id}" has no implementation in the registry. ` +
        `Add an entry for "${sr.id}" to the rules registry.`
      )
    }
    const rule: PolicyRule<S, R> = {
      id:    sr.id,
      match: fn.match,
      allow: sr.allow,
      deny:  sr.deny,
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
  raw: unknown,
  registry: RuleRegistry<S, R>,
): PolicyDefinition<S, R> {
  const serializable = validate(raw)

  const policy: PolicyDefinition<S, R> = {
    id:            serializable.id,
    defaultEffect: serializable.defaultEffect,
    rules:         mergeRules(serializable.rules, registry),
  }

  if (serializable.version     !== undefined) policy.version     = serializable.version
  if (serializable.description !== undefined) policy.description = serializable.description

  if (serializable.fieldRules && serializable.fieldRules.length > 0) {
    policy.fieldRules = mergeFieldRules(serializable.fieldRules, registry)
  }

  return policy
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export function createDbLoader<
  S extends Subject = Subject,
  R extends Resource = Resource,
>(config: DbLoaderConfig<S, R>): PolicyLoader<S, R> {
  const pollInterval = config.pollInterval ?? 30_000

  async function load(): Promise<PolicyDefinition<S, R>> {
    const raw = await config.query()
    return buildPolicy(raw, config.rules)
  }

  function watch(cb: (policy: PolicyDefinition<S, R>) => void): void {
    setInterval(async () => {
      try {
        const policy = await load()
        cb(policy)
      } catch {
        // Swallow errors during polling — transient DB failures should not
        // crash the watch loop. The next interval will retry automatically.
      }
    }, pollInterval)
  }

  return { load, watch }
}
