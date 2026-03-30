import type { PolicyDefinition, Subject, Resource } from '@authwrite/core'

// ─── Domain types ─────────────────────────────────────────────────────────────

export interface User extends Subject {
  // roles: ('admin' | 'editor' | 'viewer')[]  — inherited from Subject
}

export interface Document extends Resource {
  status:  'draft' | 'published' | 'archived'
  ownerId: string
}

// ─── Policy ───────────────────────────────────────────────────────────────────

export const documentPolicy: PolicyDefinition<User, Document> = {
  id:            'documents',
  version:       '1.0.0',
  description:   'Access control for a document management system',
  defaultEffect: 'deny',
  rules: [
    {
      id:          'archived-blocks-mutation',
      description: 'Archived documents cannot be mutated by anyone — including admins.',
      priority:    20,
      match:       ({ resource }) => resource?.status === 'archived',
      deny:        ['write', 'delete'],
    },
    {
      id:          'admin-full-access',
      description: 'Administrators have full access to all documents.',
      priority:    10,
      match:       ({ subject }) => subject.roles.includes('admin'),
      allow:       ['*'],
    },
    {
      id:          'owner-full-access',
      description: 'Users have full access to documents they own.',
      priority:    5,
      match:       ({ subject, resource }) => !!resource && resource.ownerId === subject.id,
      allow:       ['*'],
    },
    {
      id:          'viewer-read-only',
      description: 'Viewers can read any document regardless of ownership.',
      priority:    1,
      match:       ({ subject }) => subject.roles.includes('viewer'),
      allow:       ['read'],
    },
    {
      id:          'self-service-password',
      description: 'Any authenticated user can change their own password.',
      priority:    1,
      match:       () => true,
      allow:       ['change-password'],
    },
  ],
}

// ─── Presets ──────────────────────────────────────────────────────────────────

export type Role   = 'viewer' | 'editor' | 'admin'
export type Status = 'draft' | 'published' | 'archived'
export type Action =
  | 'read' | 'write' | 'delete'   // instance actions
  | 'create'                       // type action
  | 'change-password'              // subject action

export interface Scenario {
  label:   string
  role:    Role
  owns:    boolean
  status:  Status
  action:  Action
}

export const PRESETS: Scenario[] = [
  { label: 'Owner reads their doc',    role: 'editor', owns: true,  status: 'published', action: 'read'            },
  { label: 'Admin vs archived doc',    role: 'admin',  owns: false, status: 'archived',  action: 'write'           },
  { label: 'Viewer tries to delete',   role: 'viewer', owns: false, status: 'published', action: 'delete'          },
  { label: 'Default deny (no rule)',   role: 'editor', owns: false, status: 'published', action: 'write'           },
  { label: 'Subject action',          role: 'editor', owns: false, status: 'draft',     action: 'change-password' },
]

export const INSTANCE_ACTIONS: Action[] = ['read', 'write', 'delete', 'create']
