import type { PolicyDefinition } from '@daltonr/authwrite-core'
import type { Doc, User } from './data.js'

export const documentPolicy: PolicyDefinition<User, Doc> = {
  id:            'documents',
  version:       '1.0.0',
  defaultEffect: 'deny',
  rules: [
    // Archived documents block all mutation regardless of who asks
    {
      id:       'archived-blocks-mutation',
      priority: 20,
      match:    ({ resource }) => resource?.status === 'archived',
      deny:     ['write', 'delete', 'archive'],
    },
    // Admins can do anything
    {
      id:       'admin-full-access',
      priority: 10,
      match:    ({ subject }) => subject.roles.includes('admin'),
      allow:    ['*'],
    },
    // Owners have full access to their own documents
    {
      id:       'owner-full-access',
      priority: 5,
      match:    ({ subject, resource }) => !!resource && resource.ownerId === subject.id,
      allow:    ['*'],
    },
    // Editors can read all documents and write/archive non-archived ones
    {
      id:       'editor-read-write',
      priority: 1,
      match:    ({ subject }) => subject.roles.includes('editor'),
      allow:    ['read', 'write', 'archive'],
    },
    // Viewers can only read published documents
    {
      id:       'viewer-read-published',
      priority: 1,
      match:    ({ subject, resource }) =>
        subject.roles.includes('viewer') && resource?.status === 'published',
      allow:    ['read'],
    },
  ],
}
