import { describe, it, expect, afterEach } from 'vitest'
import { createFileLoader } from '@authwrite/loader-yaml'
import { createAuthEngine, fromLoader } from '@authwrite/core'
import { writeFileSync, rmSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { Subject, Resource, AuthContext } from '@authwrite/core'

// ─── Test domain types ────────────────────────────────────────────────────────

type User = Subject & { department?: string }
type Doc  = Resource & { status?: string; ownerId?: string; sensitivity?: string }

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const user = (attrs: Partial<User> = {}): User => ({ id: 'u1', roles: [], ...attrs })
const doc  = (attrs: Partial<Doc>  = {}): Doc  => ({ type: 'document', id: 'doc-1', ...attrs })

// ─── Temp file helpers ────────────────────────────────────────────────────────

const tmpDir = mkdtempSync(join(tmpdir(), 'authwrite-loader-test-'))
const cleanups: string[] = []

function writeTmp(name: string, content: string): string {
  const path = join(tmpDir, name)
  writeFileSync(path, content, 'utf-8')
  cleanups.push(path)
  return path
}

afterEach(() => {
  for (const p of cleanups.splice(0)) {
    try { rmSync(p) } catch { /* already gone */ }
  }
})

// ─── Registry used across most tests ─────────────────────────────────────────

const ownerMatch = ({ subject, resource }: AuthContext<User, Doc>) =>
  resource?.ownerId === subject.id

const adminMatch = ({ subject }: AuthContext<User, Doc>) =>
  subject.roles.includes('admin')

const archivedMatch = ({ resource }: AuthContext<User, Doc>) =>
  resource?.status === 'archived'

const baseRegistry = {
  'owner-full-access':       { match: ownerMatch },
  'admin-override':          { match: adminMatch },
  'archived-blocks-mutation':{ match: archivedMatch },
}

// ─── YAML loading ─────────────────────────────────────────────────────────────

describe('YAML loading', () => {
  it('loads a policy from a .yaml file', async () => {
    const path = writeTmp('policy.yaml', `
id: documents
defaultEffect: deny
rules:
  - id: owner-full-access
    allow: ['*']
`)
    const loader = createFileLoader({ path, rules: baseRegistry })
    const policy = await loader.load()

    expect(policy.id).toBe('documents')
    expect(policy.defaultEffect).toBe('deny')
    expect(policy.rules).toHaveLength(1)
  })

  it('loads a policy from a .yml file', async () => {
    const path = writeTmp('policy.yml', `
id: documents
defaultEffect: allow
rules: []
`)
    const loader = createFileLoader({ path, rules: {} })
    const policy = await loader.load()

    expect(policy.id).toBe('documents')
  })

  it('loads a policy from a .json file', async () => {
    const path = writeTmp('policy.json', JSON.stringify({
      id: 'documents',
      defaultEffect: 'deny',
      rules: [{ id: 'owner-full-access', allow: ['*'] }],
    }))
    const loader = createFileLoader({ path, rules: baseRegistry })
    const policy = await loader.load()

    expect(policy.id).toBe('documents')
    expect(policy.rules).toHaveLength(1)
  })

  it('preserves version and description', async () => {
    const path = writeTmp('policy.yaml', `
id: documents
version: '2.1.0'
description: Document access policy
defaultEffect: deny
rules: []
`)
    const loader = createFileLoader({ path, rules: {} })
    const policy = await loader.load()

    expect(policy.version).toBe('2.1.0')
    expect(policy.description).toBe('Document access policy')
  })

  it('merges match functions from the registry into rules', async () => {
    const path = writeTmp('policy.yaml', `
id: documents
defaultEffect: deny
rules:
  - id: owner-full-access
    allow: ['*']
  - id: admin-override
    priority: 10
    allow: ['*']
`)
    const loader = createFileLoader<User, Doc>({ path, rules: baseRegistry })
    const policy = await loader.load()

    expect(policy.rules[0].match).toBe(ownerMatch)
    expect(policy.rules[1].match).toBe(adminMatch)
  })

  it('preserves priority, allow, and deny from the file', async () => {
    const path = writeTmp('policy.yaml', `
id: documents
defaultEffect: deny
rules:
  - id: archived-blocks-mutation
    priority: 5
    deny: [write, delete]
`)
    const loader = createFileLoader<User, Doc>({ path, rules: baseRegistry })
    const policy = await loader.load()

    const rule = policy.rules[0]
    expect(rule.priority).toBe(5)
    expect(rule.deny).toEqual(['write', 'delete'])
    expect(rule.allow).toBeUndefined()
  })

  it('preserves rule description from the file', async () => {
    const path = writeTmp('policy.yaml', `
id: documents
defaultEffect: deny
rules:
  - id: owner-full-access
    description: Owner has full access to their documents
    allow: ['*']
`)
    const loader = createFileLoader<User, Doc>({ path, rules: baseRegistry })
    const policy = await loader.load()

    expect(policy.rules[0].description).toBe('Owner has full access to their documents')
  })

  it('attaches condition function from the registry when provided', async () => {
    const conditionFn = ({ subject }: AuthContext<User, Doc>) => subject.roles.includes('verified')
    const path = writeTmp('policy.yaml', `
id: documents
defaultEffect: deny
rules:
  - id: owner-full-access
    allow: ['*']
`)
    const loader = createFileLoader<User, Doc>({
      path,
      rules: {
        'owner-full-access': { match: ownerMatch, condition: conditionFn },
      },
    })
    const policy = await loader.load()

    expect(policy.rules[0].condition).toBe(conditionFn)
  })

  it('rules without a condition in the registry have no condition on the merged rule', async () => {
    const path = writeTmp('policy.yaml', `
id: documents
defaultEffect: deny
rules:
  - id: owner-full-access
    allow: ['*']
`)
    const loader = createFileLoader<User, Doc>({ path, rules: baseRegistry })
    const policy = await loader.load()

    expect(policy.rules[0].condition).toBeUndefined()
  })
})

// ─── Field rules ──────────────────────────────────────────────────────────────

describe('fieldRules', () => {
  it('loads fieldRules when present', async () => {
    const path = writeTmp('policy.yaml', `
id: documents
defaultEffect: allow
rules: []
fieldRules:
  - id: owner-sees-own-fields
    expose: [id, title, content]
    redact: [internalNotes]
`)
    const loader = createFileLoader<User, Doc>({
      path,
      rules: { 'owner-sees-own-fields': { match: ownerMatch } },
    })
    const policy = await loader.load()

    expect(policy.fieldRules).toHaveLength(1)
    expect(policy.fieldRules![0].expose).toEqual(['id', 'title', 'content'])
    expect(policy.fieldRules![0].redact).toEqual(['internalNotes'])
    expect(policy.fieldRules![0].match).toBe(ownerMatch)
  })

  it('omits fieldRules when not in the file', async () => {
    const path = writeTmp('policy.yaml', `
id: documents
defaultEffect: deny
rules: []
`)
    const loader = createFileLoader({ path, rules: {} })
    const policy = await loader.load()

    expect(policy.fieldRules).toBeUndefined()
  })
})

// ─── Validation ───────────────────────────────────────────────────────────────

describe('validation', () => {
  it('throws when a rule in the file has no matching registry entry', async () => {
    const path = writeTmp('policy.yaml', `
id: documents
defaultEffect: deny
rules:
  - id: nonexistent-rule
    allow: ['*']
`)
    const loader = createFileLoader({ path, rules: {} })

    await expect(loader.load()).rejects.toThrow('nonexistent-rule')
  })

  it('throws when the policy id is missing', async () => {
    const path = writeTmp('policy.yaml', `
defaultEffect: deny
rules: []
`)
    const loader = createFileLoader({ path, rules: {} })

    await expect(loader.load()).rejects.toThrow()
  })

  it('throws when defaultEffect is invalid', async () => {
    const path = writeTmp('policy.yaml', `
id: documents
defaultEffect: maybe
rules: []
`)
    const loader = createFileLoader({ path, rules: {} })

    await expect(loader.load()).rejects.toThrow()
  })

  it('throws when the file does not exist', async () => {
    const loader = createFileLoader({ path: '/nonexistent/path/policy.yaml', rules: {} })

    await expect(loader.load()).rejects.toThrow()
  })

  it('throws when the file is not valid YAML', async () => {
    const path = writeTmp('policy.yaml', `
id: documents
  badly: indented: yaml: [
`)
    const loader = createFileLoader({ path, rules: {} })

    await expect(loader.load()).rejects.toThrow()
  })

  it('throws when a fieldRule in the file has no matching registry entry', async () => {
    const path = writeTmp('policy.yaml', `
id: documents
defaultEffect: allow
rules: []
fieldRules:
  - id: unknown-field-rule
    expose: [id]
    redact: []
`)
    const loader = createFileLoader({ path, rules: {} })

    await expect(loader.load()).rejects.toThrow('unknown-field-rule')
  })
})

// ─── File watching ────────────────────────────────────────────────────────────

describe('watch()', () => {
  it('calls the callback when the file changes', async () => {
    const path = writeTmp('watch-policy.yaml', `
id: documents
defaultEffect: deny
rules: []
`)
    const loader = createFileLoader({ path, rules: {} })
    await loader.load()

    const callbackFired = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('watch callback not fired')), 3000)
      loader.watch!(() => {
        clearTimeout(timeout)
        resolve()
      })
      // Small delay so the watcher is ready before we write
      setTimeout(() => {
        writeFileSync(path, `
id: documents
defaultEffect: allow
rules: []
`)
      }, 50)
    })

    await callbackFired
  })

  it('callback receives the updated policy', async () => {
    const path = writeTmp('watch-policy2.yaml', `
id: documents
defaultEffect: deny
rules: []
`)
    const loader = createFileLoader({ path, rules: {} })
    await loader.load()

    const updated = new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('watch callback not fired')), 3000)
      loader.watch!(policy => {
        clearTimeout(timeout)
        resolve(policy.defaultEffect)
      })
      setTimeout(() => {
        writeFileSync(path, `
id: documents
defaultEffect: allow
rules: []
`)
      }, 50)
    })

    expect(await updated).toBe('allow')
  })

  it('callback fires again on subsequent changes', async () => {
    const path = writeTmp('watch-policy3.yaml', `
id: documents
defaultEffect: deny
rules: []
`)
    const loader = createFileLoader({ path, rules: {} })
    await loader.load()

    const effects: string[] = []

    const twoFired = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('watch did not fire twice')), 5000)
      loader.watch!(policy => {
        effects.push(policy.defaultEffect)
        if (effects.length === 2) {
          clearTimeout(timeout)
          resolve()
        }
      })
      setTimeout(() => writeFileSync(path, `id: documents\ndefaultEffect: allow\nrules: []\n`), 50)
      setTimeout(() => writeFileSync(path, `id: documents\ndefaultEffect: deny\nrules: []\n`), 200)
    })

    await twoFired
    expect(effects).toEqual(['allow', 'deny'])
  })
})

// ─── Integration ──────────────────────────────────────────────────────────────

describe('integration with createAuthEngine', () => {
  it('loaded policy evaluates correctly', async () => {
    const path = writeTmp('integration.yaml', `
id: documents
defaultEffect: deny
rules:
  - id: owner-full-access
    allow: ['*']
`)
    const loader = createFileLoader<User, Doc>({ path, rules: baseRegistry })
    const engine = createAuthEngine({ policy: await loader.load() })

    const owner = user({ id: 'u1' })
    const ownedDoc = doc({ ownerId: 'u1' })

    expect(await engine.can(owner, ownedDoc, 'read')).toBe(true)
    expect(await engine.can(owner, doc({ ownerId: 'u2' }), 'delete')).toBe(false)
  })

  it('hot reload via watch + engine.reload() updates live policy', async () => {
    const path = writeTmp('hot-reload.yaml', `
id: documents
defaultEffect: deny
rules: []
`)
    const loader = createFileLoader<User, Doc>({ path, rules: baseRegistry })
    const engine = createAuthEngine({ policy: await loader.load() })

    // Initially denied
    expect(await engine.can(user(), doc(), 'read')).toBe(false)

    const reloaded = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('reload not triggered')), 3000)
      loader.watch!(policy => {
        engine.reload(policy)
        clearTimeout(timeout)
        resolve()
      })
      setTimeout(() => {
        writeFileSync(path, `
id: documents
defaultEffect: allow
rules: []
`)
      }, 50)
    })

    await reloaded

    // Now allowed after reload
    expect(await engine.can(user(), doc(), 'read')).toBe(true)
  })
})

// ─── fromLoader integration ───────────────────────────────────────────────────

describe('fromLoader with createFileLoader', () => {
  it('creates a working engine from a YAML file', async () => {
    const path = writeTmp('loader-init.yaml', `
id: documents
defaultEffect: deny
rules:
  - id: owner-full-access
    allow: ['*']
`)
    const loader = createFileLoader<User, Doc>({ path, rules: baseRegistry })
    const engine = createAuthEngine({ policy: await fromLoader(loader) })

    expect(await engine.can(user({ id: 'u1' }), doc({ ownerId: 'u1' }), 'read')).toBe(true)
    expect(await engine.can(user({ id: 'u1' }), doc({ ownerId: 'u2' }), 'read')).toBe(false)
  })

  it('file changes propagate to engine via watch callback', async () => {
    const path = writeTmp('loader-watch.yaml', `
id: documents
defaultEffect: deny
rules: []
`)
    const loader = createFileLoader<User, Doc>({ path, rules: baseRegistry })

    let resolveReloaded!: () => void
    const reloaded = new Promise<void>(r => { resolveReloaded = r })

    const engine = createAuthEngine({
      policy: await fromLoader(loader, () => resolveReloaded()),
    })

    expect(await engine.can(user(), doc(), 'read')).toBe(false)

    setTimeout(() => {
      writeFileSync(path, `id: documents\ndefaultEffect: allow\nrules: []\n`)
    }, 50)

    await Promise.race([
      reloaded,
      new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error('reload not triggered')), 3000)
      ),
    ])

    expect(await engine.can(user(), doc(), 'read')).toBe(true)
  })
})
