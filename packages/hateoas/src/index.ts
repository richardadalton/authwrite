import type { AuthEvaluator, Subject, Resource, Action } from '@authwrite/core'

// ─── Link types ───────────────────────────────────────────────────────────────

export interface LinkTemplate {
  /** The URL for this action. May be a plain string or a pre-resolved href. */
  href:    string
  /** HTTP method. Defaults to 'GET'. */
  method?: string
  /** Human-readable label, useful for UI rendering. */
  title?:  string
  /** Any additional properties (templated, type, etc.) */
  [key: string]: unknown
}

/** A map of action name → link. Only permitted actions are present. */
export type LinkMap = Record<string, LinkTemplate>

// ─── buildLinks config ────────────────────────────────────────────────────────

export interface BuildLinksConfig<
  S extends Subject = Subject,
  R extends Resource = Resource,
> {
  engine:   AuthEvaluator<S, R>
  subject:  S
  resource?: R
  /**
   * Map of action name → link template.
   * Only entries whose action is permitted will appear in the result.
   */
  actions: Record<Action, LinkTemplate>
}

// ─── buildLinks ───────────────────────────────────────────────────────────────

/**
 * Evaluates every action in `config.actions` and returns a `LinkMap`
 * containing only the links the subject is permitted to follow.
 *
 * ```typescript
 * const links = await buildLinks({
 *   engine,
 *   subject,
 *   resource,
 *   actions: {
 *     read:    { href: `/documents/${id}`,         method: 'GET' },
 *     write:   { href: `/documents/${id}`,         method: 'PUT' },
 *     delete:  { href: `/documents/${id}`,         method: 'DELETE' },
 *     archive: { href: `/documents/${id}/archive`, method: 'POST' },
 *   },
 * })
 * // → only links whose policy decision was allowed: true
 * ```
 */
export async function buildLinks<
  S extends Subject = Subject,
  R extends Resource = Resource,
>(config: BuildLinksConfig<S, R>): Promise<LinkMap> {
  const actions = Object.keys(config.actions) as Action[]

  const decisions = await config.engine.evaluateAll({
    subject:  config.subject,
    resource: config.resource,
    actions,
  })

  const links: LinkMap = {}
  for (const action of actions) {
    if (decisions[action]?.allowed) {
      links[action] = config.actions[action]
    }
  }

  return links
}

// ─── embedLinks ───────────────────────────────────────────────────────────────

export interface EmbedLinksConfig<
  S extends Subject = Subject,
  R extends Resource = Resource,
> extends BuildLinksConfig<S, R> {
  /**
   * A `self` link added unconditionally — it is not subject to policy
   * evaluation since the resource has already been fetched and returned.
   */
  self?: LinkTemplate
}

/**
 * Builds permission-aware links and merges them into `data` as a `_links`
 * property, following HAL (application/hal+json) conventions.
 *
 * ```typescript
 * const body = await embedLinks(document, {
 *   engine, subject, resource: document,
 *   self: { href: `/documents/${document.id}`, method: 'GET' },
 *   actions: {
 *     write:   { href: `/documents/${document.id}`, method: 'PUT' },
 *     delete:  { href: `/documents/${document.id}`, method: 'DELETE' },
 *   },
 * })
 * // → { ...document, _links: { self: {...}, write: {...} } }
 * //   (delete absent — not permitted)
 * ```
 */
export async function embedLinks<
  T extends object,
  S extends Subject = Subject,
  R extends Resource = Resource,
>(data: T, config: EmbedLinksConfig<S, R>): Promise<T & { _links: LinkMap }> {
  const permitted = await buildLinks(config)

  const _links: LinkMap = {}
  if (config.self) _links['self'] = config.self
  Object.assign(_links, permitted)

  return { ...data, _links }
}

// ─── Decision-based link filtering (sync, from pre-fetched decisions) ─────────

/**
 * Synchronous variant for cases where you have already called `evaluateAll`
 * and want to build links without an additional async round-trip.
 *
 * ```typescript
 * const decisions = await engine.evaluateAll({ subject, resource, actions })
 * const links = linksFromDecisions(decisions, actionTemplates)
 * ```
 */
export function linksFromDecisions(
  decisions: Record<string, { allowed: boolean }>,
  actions:   Record<Action, LinkTemplate>,
): LinkMap {
  const links: LinkMap = {}
  for (const [action, template] of Object.entries(actions)) {
    if (decisions[action]?.allowed) {
      links[action] = template
    }
  }
  return links
}
