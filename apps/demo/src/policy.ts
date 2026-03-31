import { rule, all, any }         from '@daltonr/rulewrite'
import { fromRule }                from '@daltonr/authwrite-rulewrite'
import type { PolicyDefinition, AuthContext } from '@daltonr/authwrite-core'
import type { Doc, User }          from './data.js'

// ─── Atomic predicates ────────────────────────────────────────────────────────

type Ctx = AuthContext<User, Doc>

const isAdmin = rule<Ctx>(
  ({ subject }) => subject.roles.includes('admin'),
  'IsAdmin',
)

const isEditor = rule<Ctx>(
  ({ subject }) => subject.roles.includes('editor'),
  'IsEditor',
)

const isViewer = rule<Ctx>(
  ({ subject }) => subject.roles.includes('viewer'),
  'IsViewer',
)

const isOwner = rule<Ctx>(
  ({ subject, resource }) => !!resource && resource.ownerId === subject.id,
  'IsOwner',
)

const isArchived = rule<Ctx>(
  ({ resource }) => resource?.status === 'archived',
  'IsArchived',
)

const isPublished = rule<Ctx>(
  ({ resource }) => resource?.status === 'published',
  'IsPublished',
)

// ─── Composed rules ───────────────────────────────────────────────────────────

// Archived docs block mutations — highest priority, applies to everyone
const blocksArchivedMutation = isArchived

// Admins bypass everything below
const hasAdminAccess = isAdmin

// Owners have full access to their own documents
const hasOwnerAccess = isOwner

// Editors can read and write; archived status is handled by the block rule above
const hasEditorAccess = isEditor

// Viewers may only read documents that are published
const hasViewerReadAccess = all(isViewer, isPublished)

// ─── Policy ───────────────────────────────────────────────────────────────────

export const documentPolicy: PolicyDefinition<User, Doc> = {
  id:            'documents',
  version:       '1.0.0',
  defaultEffect: 'deny',
  rules: [
    {
      id:          'archived-blocks-mutation',
      priority:    20,
      description: 'Archived documents cannot be mutated by anyone',
      ...fromRule(blocksArchivedMutation),
      deny:        ['write', 'delete', 'archive'],
    },
    {
      id:          'admin-full-access',
      priority:    10,
      description: 'Admins can perform any action on any document',
      ...fromRule(hasAdminAccess),
      allow:       ['*'],
    },
    {
      id:          'owner-full-access',
      priority:    5,
      description: 'Owners have full access to their own documents',
      ...fromRule(hasOwnerAccess),
      allow:       ['*'],
    },
    {
      id:          'editor-read-write',
      priority:    1,
      description: 'Editors can read, write, and archive any document',
      ...fromRule(hasEditorAccess),
      allow:       ['read', 'write', 'archive'],
    },
    {
      id:          'viewer-read-published',
      priority:    1,
      description: 'Viewers may only read published documents',
      ...fromRule(hasViewerReadAccess),
      allow:       ['read'],
    },
  ],
}
