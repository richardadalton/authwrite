import { describe, it } from 'vitest'
import * as fc from 'fast-check'
import { buildLinks, linksFromDecisions } from '@daltonr/authwrite-hateoas'
import { createAuthEngine } from '@daltonr/authwrite-core'
import type { PolicyDefinition, Subject, Resource } from '@daltonr/authwrite-core'
import type { LinkTemplate } from '@daltonr/authwrite-hateoas'

// ─── Arbitraries ──────────────────────────────────────────────────────────────

const arbId = fc.string({ minLength: 1, maxLength: 20 })

const arbSubject = fc.record({
  id:    arbId,
  roles: fc.array(arbId, { maxLength: 3 }),
})

const arbResource = fc.record({
  type: arbId,
  id:   fc.option(arbId, { nil: undefined }),
})

const arbHref   = fc.string({ minLength: 1, maxLength: 50 })
const arbMethod = fc.constantFrom('GET', 'POST', 'PUT', 'PATCH', 'DELETE')

const arbLinkTemplate: fc.Arbitrary<LinkTemplate> = fc.record({
  href:   arbHref,
  method: arbMethod,
})

// A set of named action templates (1–5 actions)
const arbActionTemplates: fc.Arbitrary<Record<string, LinkTemplate>> = fc
  .array(
    fc.tuple(fc.constantFrom('read', 'write', 'delete', 'create', 'archive'), arbLinkTemplate),
    { minLength: 1, maxLength: 5 },
  )
  .map(entries => Object.fromEntries(entries))

// ─── buildLinks invariants ────────────────────────────────────────────────────

describe('buildLinks invariants', () => {
  it('result keys are always a subset of the provided action names', async () => {
    const policy: PolicyDefinition = { id: 'p', defaultEffect: 'allow', rules: [] }
    const engine = createAuthEngine({ policy })

    await fc.assert(fc.asyncProperty(arbSubject, arbResource, arbActionTemplates, async (subject, resource, actions) => {
      const links = await buildLinks({ engine, subject, resource, actions })
      const resultKeys  = Object.keys(links)
      const actionKeys  = Object.keys(actions)
      return resultKeys.every(k => actionKeys.includes(k))
    }))
  })

  it('with allow-all policy, result contains every provided action', async () => {
    const policy: PolicyDefinition = { id: 'p', defaultEffect: 'allow', rules: [] }
    const engine = createAuthEngine({ policy })

    await fc.assert(fc.asyncProperty(arbSubject, arbResource, arbActionTemplates, async (subject, resource, actions) => {
      const links = await buildLinks({ engine, subject, resource, actions })
      return Object.keys(actions).every(k => k in links)
    }))
  })

  it('with deny-all policy, result is always empty', async () => {
    const policy: PolicyDefinition = { id: 'p', defaultEffect: 'deny', rules: [] }
    const engine = createAuthEngine({ policy })

    await fc.assert(fc.asyncProperty(arbSubject, arbResource, arbActionTemplates, async (subject, resource, actions) => {
      const links = await buildLinks({ engine, subject, resource, actions })
      return Object.keys(links).length === 0
    }))
  })

  it('each link in the result has href and method', async () => {
    const policy: PolicyDefinition = { id: 'p', defaultEffect: 'allow', rules: [] }
    const engine = createAuthEngine({ policy })

    await fc.assert(fc.asyncProperty(arbSubject, arbResource, arbActionTemplates, async (subject, resource, actions) => {
      const links = await buildLinks({ engine, subject, resource, actions })
      return Object.values(links).every(l => typeof l.href === 'string' && typeof l.method === 'string')
    }))
  })

  it('link href and method always match the template provided for that action', async () => {
    const policy: PolicyDefinition = { id: 'p', defaultEffect: 'allow', rules: [] }
    const engine = createAuthEngine({ policy })

    await fc.assert(fc.asyncProperty(arbSubject, arbResource, arbActionTemplates, async (subject, resource, actions) => {
      const links = await buildLinks({ engine, subject, resource, actions })
      return Object.entries(links).every(([action, link]) =>
        link.href   === actions[action].href &&
        link.method === actions[action].method
      )
    }))
  })

  it('suspended mode always returns empty links', async () => {
    const policy: PolicyDefinition = { id: 'p', defaultEffect: 'allow', rules: [] }
    const engine = createAuthEngine({ policy, mode: 'suspended' })

    await fc.assert(fc.asyncProperty(arbSubject, arbResource, arbActionTemplates, async (subject, resource, actions) => {
      const links = await buildLinks({ engine, subject, resource, actions })
      return Object.keys(links).length === 0
    }))
  })

  it('audit mode always returns all provided action links', async () => {
    const policy: PolicyDefinition = { id: 'p', defaultEffect: 'deny', rules: [] }
    const engine = createAuthEngine({ policy, mode: 'audit' })

    await fc.assert(fc.asyncProperty(arbSubject, arbResource, arbActionTemplates, async (subject, resource, actions) => {
      const links = await buildLinks({ engine, subject, resource, actions })
      return Object.keys(actions).every(k => k in links)
    }))
  })
})

// ─── linksFromDecisions invariants ───────────────────────────────────────────

describe('linksFromDecisions invariants', () => {
  it('only allowed permissions produce links', async () => {
    await fc.assert(fc.property(
      fc.array(
        fc.tuple(
          fc.constantFrom('read', 'write', 'delete', 'create'),
          fc.boolean(),
          arbLinkTemplate,
        ),
        { minLength: 1, maxLength: 4 },
      ),
      (entries) => {
        const perms: Record<string, boolean> = {}
        const templates: Record<string, LinkTemplate> = {}
        for (const [action, allowed, template] of entries) {
          perms[action]     = allowed
          templates[action] = template
        }

        const links = linksFromDecisions(perms, templates)

        // Every link in the result corresponds to an allowed permission
        const allLinksAllowed = Object.keys(links).every(a => perms[a] === true)
        // Every allowed permission has a link
        const allAllowedHaveLinks = Object.entries(perms)
          .filter(([, allowed]) => allowed)
          .every(([a]) => a in links)

        return allLinksAllowed && allAllowedHaveLinks
      }
    ))
  })

  it('result keys are always a subset of provided template keys', async () => {
    await fc.assert(fc.property(
      fc.array(
        fc.tuple(fc.constantFrom('read', 'write', 'delete'), fc.boolean(), arbLinkTemplate),
        { minLength: 1, maxLength: 3 },
      ),
      (entries) => {
        const perms: Record<string, boolean> = {}
        const templates: Record<string, LinkTemplate> = {}
        for (const [action, allowed, template] of entries) {
          perms[action]     = allowed
          templates[action] = template
        }
        const links = linksFromDecisions(perms, templates)
        return Object.keys(links).every(k => k in templates)
      }
    ))
  })
})
