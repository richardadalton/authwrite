import { describe, it, expect } from 'vitest'
import { buildLinks, embedLinks, linksFromDecisions } from '@authwrite/hateoas'
import { createAuthEngine, createEnforcer } from '@authwrite/core'
import type { PolicyDefinition, Subject, Resource } from '@authwrite/core'
import type { LinkTemplate } from '@authwrite/hateoas'

// ─── Domain types ─────────────────────────────────────────────────────────────

type User = Subject
type Doc  = Resource & { status?: 'draft' | 'published' | 'archived'; ownerId?: string }

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const user  = (attrs: Partial<User> = {}): User => ({ id: 'u1', roles: ['editor'], ...attrs })
const admin = (): User => ({ id: 'admin-1', roles: ['admin'] })
const doc   = (attrs: Partial<Doc>  = {}): Doc  => ({ type: 'document', id: 'doc-1', status: 'published', ownerId: 'other', ...attrs })

const documentPolicy: PolicyDefinition<User, Doc> = {
  id: 'documents',
  version: '1.0.0',
  defaultEffect: 'deny',
  rules: [
    {
      id: 'archived-blocks-mutation',
      priority: 20,
      match: ({ resource }) => resource?.status === 'archived',
      deny: ['write', 'delete'],
    },
    {
      id: 'admin-full-access',
      priority: 10,
      match: ({ subject }) => subject.roles.includes('admin'),
      allow: ['*'],
    },
    {
      id: 'owner-full-access',
      priority: 5,
      match: ({ subject, resource }) => !!resource && resource.ownerId === subject.id,
      allow: ['*'],
    },
    {
      id: 'viewer-read-only',
      priority: 1,
      match: ({ subject }) => subject.roles.includes('viewer'),
      allow: ['read'],
    },
    {
      id: 'editor-read',
      priority: 1,
      match: ({ subject }) => subject.roles.includes('editor'),
      allow: ['read'],
    },
  ],
}

const engine = createAuthEngine({ policy: documentPolicy })

const actionTemplates: Record<string, LinkTemplate> = {
  read:    { href: '/documents/doc-1',         method: 'GET'    },
  write:   { href: '/documents/doc-1',         method: 'PUT'    },
  delete:  { href: '/documents/doc-1',         method: 'DELETE' },
  archive: { href: '/documents/doc-1/archive', method: 'POST'   },
}

// ─── buildLinks ───────────────────────────────────────────────────────────────

describe('buildLinks', () => {
  it('returns only permitted links for a viewer (read only)', async () => {
    const viewer = user({ roles: ['viewer'] })
    const links = await buildLinks({ engine, subject: viewer, resource: doc(), actions: actionTemplates })

    expect(links).toHaveProperty('read')
    expect(links).not.toHaveProperty('write')
    expect(links).not.toHaveProperty('delete')
    expect(links).not.toHaveProperty('archive')
  })

  it('returns all links for an admin', async () => {
    const links = await buildLinks({ engine, subject: admin(), resource: doc(), actions: actionTemplates })

    expect(Object.keys(links)).toEqual(expect.arrayContaining(['read', 'write', 'delete', 'archive']))
  })

  it('omits mutation links for archived document even for admin', async () => {
    const links = await buildLinks({
      engine, subject: admin(), resource: doc({ status: 'archived' }), actions: actionTemplates,
    })

    expect(links).toHaveProperty('read')
    expect(links).not.toHaveProperty('write')
    expect(links).not.toHaveProperty('delete')
  })

  it('returns owner links when subject owns the document', async () => {
    const owner = user({ id: 'u1', roles: ['editor'] })
    const ownedDoc = doc({ ownerId: 'u1' })
    const links = await buildLinks({ engine, subject: owner, resource: ownedDoc, actions: actionTemplates })

    expect(links).toHaveProperty('read')
    expect(links).toHaveProperty('write')
    expect(links).toHaveProperty('delete')
  })

  it('returns empty links when no actions are permitted', async () => {
    const stranger = user({ roles: [] })
    const links = await buildLinks({ engine, subject: stranger, resource: doc(), actions: actionTemplates })

    expect(Object.keys(links)).toHaveLength(0)
  })

  it('preserves the full link template including method and title', async () => {
    const links = await buildLinks({
      engine,
      subject: admin(),
      resource: doc(),
      actions: {
        read: { href: '/documents/doc-1', method: 'GET', title: 'View document' },
      },
    })

    expect(links.read).toEqual({ href: '/documents/doc-1', method: 'GET', title: 'View document' })
  })

  it('works without a resource (subject-level actions)', async () => {
    const policy: PolicyDefinition<User, Doc> = {
      id: 'subject-actions',
      defaultEffect: 'deny',
      rules: [{ id: 'change-password', match: () => true, allow: ['change-password'] }],
    }
    const eng = createAuthEngine({ policy })
    const links = await buildLinks({
      engine: eng,
      subject: user(),
      actions: { 'change-password': { href: '/account/password', method: 'POST' } },
    })

    expect(links).toHaveProperty('change-password')
  })
})

// ─── embedLinks ───────────────────────────────────────────────────────────────

describe('embedLinks', () => {
  it('merges _links into the data object', async () => {
    const document = { id: 'doc-1', title: 'Report', status: 'published' }
    const result = await embedLinks(document, {
      engine,
      subject:  admin(),
      resource: doc(),
      self:     { href: '/documents/doc-1', method: 'GET' },
      actions:  actionTemplates,
    })

    expect(result.id).toBe('doc-1')
    expect(result.title).toBe('Report')
    expect(result._links).toBeDefined()
    expect(result._links.self).toEqual({ href: '/documents/doc-1', method: 'GET' })
  })

  it('_links only contains permitted actions plus self', async () => {
    const viewer = user({ roles: ['viewer'] })
    const document = { id: 'doc-1', title: 'Report' }
    const result = await embedLinks(document, {
      engine,
      subject:  viewer,
      resource: doc(),
      self:     { href: '/documents/doc-1', method: 'GET' },
      actions:  actionTemplates,
    })

    expect(Object.keys(result._links)).toEqual(expect.arrayContaining(['self', 'read']))
    expect(result._links).not.toHaveProperty('write')
    expect(result._links).not.toHaveProperty('delete')
  })

  it('self is always present even when all actions are denied', async () => {
    const stranger = user({ roles: [] })
    const document = { id: 'doc-1' }
    const result = await embedLinks(document, {
      engine,
      subject:  stranger,
      resource: doc(),
      self:     { href: '/documents/doc-1', method: 'GET' },
      actions:  actionTemplates,
    })

    expect(result._links).toHaveProperty('self')
    expect(Object.keys(result._links)).toHaveLength(1)
  })

  it('self is omitted when not provided', async () => {
    const viewer = user({ roles: ['viewer'] })
    const document = { id: 'doc-1' }
    const result = await embedLinks(document, {
      engine,
      subject:  viewer,
      resource: doc(),
      actions:  { read: { href: '/documents/doc-1', method: 'GET' } },
    })

    expect(result._links).not.toHaveProperty('self')
    expect(result._links).toHaveProperty('read')
  })

  it('does not mutate the original data object', async () => {
    const document = { id: 'doc-1', title: 'Report' }
    const original = { ...document }
    await embedLinks(document, { engine, subject: admin(), resource: doc(), actions: actionTemplates })

    expect(document).toEqual(original)
    expect((document as Record<string, unknown>)['_links']).toBeUndefined()
  })
})

// ─── linksFromDecisions (sync) ────────────────────────────────────────────────

describe('linksFromDecisions', () => {
  it('returns only links for allowed decisions', () => {
    const decisions = {
      read:   { allowed: true  },
      write:  { allowed: false },
      delete: { allowed: false },
    }
    const links = linksFromDecisions(decisions, {
      read:   { href: '/doc', method: 'GET'    },
      write:  { href: '/doc', method: 'PUT'    },
      delete: { href: '/doc', method: 'DELETE' },
    })

    expect(links).toHaveProperty('read')
    expect(links).not.toHaveProperty('write')
    expect(links).not.toHaveProperty('delete')
  })

  it('returns empty map when all decisions are denied', () => {
    const decisions = { read: { allowed: false }, write: { allowed: false } }
    const links = linksFromDecisions(decisions, {
      read:  { href: '/doc', method: 'GET' },
      write: { href: '/doc', method: 'PUT' },
    })

    expect(Object.keys(links)).toHaveLength(0)
  })

  it('returns all links when all decisions are allowed', () => {
    const decisions = { read: { allowed: true }, write: { allowed: true } }
    const links = linksFromDecisions(decisions, {
      read:  { href: '/doc', method: 'GET' },
      write: { href: '/doc', method: 'PUT' },
    })

    expect(Object.keys(links)).toHaveLength(2)
  })

  it('handles decisions that have no corresponding template gracefully', () => {
    const decisions = { read: { allowed: true }, unknown: { allowed: true } }
    const links = linksFromDecisions(decisions, {
      read: { href: '/doc', method: 'GET' },
    })

    expect(links).toHaveProperty('read')
    expect(links).not.toHaveProperty('unknown')
  })

  it('works with a pre-fetched evaluateAll result', async () => {
    const decisions = await engine.evaluateAll({
      subject:  admin(),
      resource: doc({ status: 'archived' }),
      actions:  ['read', 'write', 'delete'],
    })
    const links = linksFromDecisions(decisions, {
      read:   { href: '/doc', method: 'GET'    },
      write:  { href: '/doc', method: 'PUT'    },
      delete: { href: '/doc', method: 'DELETE' },
    })

    expect(links).toHaveProperty('read')
    expect(links).not.toHaveProperty('write')
    expect(links).not.toHaveProperty('delete')
  })
})

// ─── Enforcer integration ─────────────────────────────────────────────────────

describe('enforcer integration', () => {
  it('audit mode — denied actions appear as links (permissive override)', async () => {
    const enforcer = createEnforcer(engine, { mode: 'audit' })
    const stranger = user({ roles: [] })
    const links = await buildLinks({ engine: enforcer, subject: stranger, resource: doc(), actions: actionTemplates })

    // In audit mode everything is allowed, so all links should be present
    expect(Object.keys(links).length).toBeGreaterThan(0)
  })

  it('lockdown mode — no links returned regardless of policy', async () => {
    const enforcer = createEnforcer(engine, { mode: 'lockdown' })
    const links = await buildLinks({ engine: enforcer, subject: admin(), resource: doc(), actions: actionTemplates })

    expect(Object.keys(links)).toHaveLength(0)
  })
})
