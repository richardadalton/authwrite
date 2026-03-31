import type { PolicyDefinition } from '@daltonr/authwrite-core'
import type { User, Doc } from './data.js'

// ─── Policy ───────────────────────────────────────────────────────────────────
//
// FIX AP-5 (duplicated logic): Every permission question in the application
// is answered exactly once, here. There are no permission check functions
// (checks.ts), no role comparisons in route handlers, and no auth logic in
// view templates. This is the single source of truth.
//
// FIX AP-8 (allow by default): defaultEffect: 'deny' means every action is
// denied unless a rule explicitly allows it. New roles, new users, and new
// actions that haven't been thought of yet are all denied by default.
//
// FIX AP-11 (coarse-grained): Separate named rules for each access concern.
// Admin system access, user management, and reports are distinct allow grants
// — it is possible to assign partial admin access.
//
// Document actions:   read | write | archive | delete | viewHistory
// System actions:     accessAdmin | manageUsers | viewReports

type Resource = (Doc & { type?: string }) | { type: 'system' } | undefined

export const documentPolicy: PolicyDefinition<User, Resource> = {
  id:            'documents',
  version:       '1.0.0',
  defaultEffect: 'deny',

  rules: [

    // ── Highest priority: sensitive document restriction ─────────────────────
    // FIX AP-2 / AP-6: Sensitivity is enforced by policy, not by data-layer
    // filtering or absent checks in route handlers. Any attempt to access a
    // sensitive document by a non-admin is denied here, regardless of what
    // lower-priority rules say.
    {
      id:       'sensitive-blocks-non-admin',
      priority: 25,
      match:    ({ subject, resource }) =>
        (resource as Doc)?.sensitive === true &&
        !subject.roles.includes('admin'),
      deny: ['read', 'write', 'archive', 'delete', 'viewHistory'],
    },

    // ── Archived documents: no mutation ─────────────────────────────────────
    {
      id:       'archived-blocks-mutation',
      priority: 20,
      match:    ({ resource }) => (resource as Doc)?.status === 'archived',
      deny:     ['write', 'delete', 'archive'],
    },

    // ── Admin: full access to everything ────────────────────────────────────
    // FIX AP-10 (hardcoded ID): Access comes from the role, not from
    // user.id === 'superadmin'. Any user with the 'admin' role is an admin.
    {
      id:       'admin-full-access',
      priority: 15,
      match:    ({ subject }) => subject.roles.includes('admin'),
      allow:    ['*'],
    },

    // ── Document owner: full access to own documents ─────────────────────────
    {
      id:       'owner-full-access',
      priority: 10,
      match:    ({ subject, resource }) =>
        !!(resource as Doc)?.ownerId &&
        (resource as Doc).ownerId === subject.id,
      allow:    ['read', 'write', 'archive', 'delete', 'viewHistory'],
    },

    // ── Editor: read, write, archive, and view history ───────────────────────
    // FIX AP-5 (inconsistency): One rule covers all editor access. The
    // GET /edit handler and POST /edit handler can't disagree because they
    // both route through the same policy rule.
    {
      id:       'editor-access',
      priority: 5,
      match:    ({ subject }) => subject.roles.includes('editor'),
      allow:    ['read', 'write', 'archive', 'viewHistory'],
    },

    // ── Viewer: read published non-sensitive documents ───────────────────────
    // FIX AP-8: This is an explicit grant. Viewers cannot read drafts,
    // archived docs, or sensitive docs. They can't view history. Each of those
    // denials comes from the default effect, not from a missing check.
    {
      id:       'viewer-read-published',
      priority: 1,
      match:    ({ subject, resource }) =>
        subject.roles.includes('viewer') &&
        (resource as Doc)?.status === 'published',
      allow:    ['read'],
    },

    // ── Premium: access to reports ───────────────────────────────────────────
    // FIX AP-12 (business flag as auth): 'premium' is a role, evaluated by
    // the policy just like any other role. Admin override works naturally:
    // admins have the admin-full-access rule above which allows everything,
    // including viewReports — no special case needed.
    {
      id:       'premium-reports',
      priority: 1,
      match:    ({ subject }) => subject.roles.includes('premium'),
      allow:    ['viewReports'],
    },

    // ── Admin: system-level actions ──────────────────────────────────────────
    // FIX AP-11 (coarse-grained): accessAdmin, manageUsers, and viewReports
    // are separate actions. It is now possible to grant a user viewReports
    // without granting manageUsers, using a dedicated rule.
    {
      id:       'admin-system-access',
      priority: 1,
      match:    ({ subject }) => subject.roles.includes('admin'),
      allow:    ['accessAdmin', 'manageUsers', 'viewReports'],
    },

  ],
}
