// ─── Data ─────────────────────────────────────────────────────────────────────
//
// ANTI-PATTERN: User model has accumulated one-off boolean flags for every
// permission question that ever came up. Each flag was added to solve an
// immediate problem but no one ever removed the old ones or kept them
// consistent with the role field.
//
// isAdmin   — added when the admin panel was built
// canEdit   — added when inline editing was shipped ("just a flag for now")
// isPremium — a billing flag that leaked into auth checks when reports were
//             gated behind a paywall
// isLegacy  — true for the one account that predates the role system and
//             gets hardcoded special-cases throughout the codebase

export interface User {
  id:        string
  name:      string
  email:     string
  // The "official" role — but half the codebase ignores this and uses the
  // boolean flags below instead
  role:      'admin' | 'editor' | 'viewer' | 'guest'
  // One-off boolean flags — all partially redundant, all out of sync
  isAdmin:   boolean
  canEdit:   boolean
  isPremium: boolean
  isLegacy:  boolean
  color:     string
}

export interface Doc {
  id:        string
  title:     string
  status:    'draft' | 'published' | 'archived'
  ownerId:   string
  excerpt:   string
  sensitive: boolean   // "sensitive" docs should be admin-only — but this is
                       // only checked in some places
}

// ─── Documents ────────────────────────────────────────────────────────────────

export const DOCS: Doc[] = [
  {
    id:        'doc-1',
    title:     'Q4 Financial Report',
    status:    'published',
    ownerId:   'alice',
    sensitive: false,
    excerpt:   'Quarterly revenue summary covering October through December. Final figures pending auditor sign-off.',
  },
  {
    id:        'doc-2',
    title:     'Product Roadmap 2026',
    status:    'draft',
    ownerId:   'bob',
    sensitive: false,
    excerpt:   'Working draft of the upcoming product roadmap. Includes proposed feature set and delivery milestones.',
  },
  {
    id:        'doc-3',
    title:     'Legacy API Specification',
    status:    'archived',
    ownerId:   'alice',
    sensitive: false,
    excerpt:   'Archived documentation for the v1 API. Superseded by the v2 specification released in Q2 2025.',
  },
  {
    id:        'doc-4',
    title:     'Engineering Onboarding Guide',
    status:    'published',
    ownerId:   'bob',
    sensitive: false,
    excerpt:   'Step-by-step onboarding guide for new engineers. Covers local setup, CI pipeline, and deployment.',
  },
  {
    id:        'doc-5',
    title:     'Security Incident Report — March',
    status:    'draft',
    ownerId:   'alice',
    sensitive: true,    // restricted — but the restriction is inconsistently enforced
    excerpt:   'Internal report documenting the March 2026 security incident. Restricted to security team and management.',
  },
]

// ─── Users ────────────────────────────────────────────────────────────────────

export const USERS: Record<string, User> = {
  // ANTI-PATTERN (hardcoded ID): 'superadmin' is a legacy account that
  // pre-dates the role system. Instead of migrating it properly, the codebase
  // has `user.id === 'superadmin'` checks scattered in several places.
  superadmin: {
    id:        'superadmin',
    name:      'Super Admin (legacy)',
    email:     'super@example.com',
    role:      'admin',
    isAdmin:   true,
    canEdit:   true,
    isPremium: true,
    isLegacy:  true,
    color:     '#dc2626',
  },
  admin: {
    id:        'admin',
    name:      'Admin',
    email:     'admin@example.com',
    role:      'admin',
    isAdmin:   true,
    canEdit:   true,
    isPremium: true,
    isLegacy:  false,
    color:     '#7c3aed',
  },
  alice: {
    id:        'alice',
    name:      'Alice (editor)',
    email:     'alice@example.com',
    role:      'editor',
    isAdmin:   false,
    canEdit:   true,    // consistent with role
    isPremium: true,
    isLegacy:  false,
    color:     '#0891b2',
  },
  bob: {
    id:        'bob',
    name:      'Bob (editor, no premium)',
    email:     'bob@example.com',
    role:      'editor',
    isAdmin:   false,
    // ANTI-PATTERN (flags out of sync): Bob is an editor (canEdit should be
    // true) but his canEdit flag is false due to a data migration bug that was
    // never caught because auth checks are inconsistent.
    canEdit:   false,
    isPremium: false,
    isLegacy:  false,
    color:     '#0891b2',
  },
  carol: {
    id:        'carol',
    name:      'Carol (viewer, premium)',
    email:     'carol@example.com',
    role:      'viewer',
    isAdmin:   false,
    canEdit:   false,
    isPremium: true,    // pays for premium but is still a viewer
    isLegacy:  false,
    color:     '#059669',
  },
  dave: {
    id:        'dave',
    name:      'Dave (viewer)',
    email:     'dave@example.com',
    role:      'viewer',
    isAdmin:   false,
    canEdit:   false,
    isPremium: false,
    isLegacy:  false,
    color:     '#64748b',
  },
  stranger: {
    id:        'stranger',
    name:      'Stranger (guest)',
    email:     '',
    role:      'guest',
    isAdmin:   false,
    canEdit:   false,
    isPremium: false,
    isLegacy:  false,
    color:     '#94a3b8',
  },
}

export const STATUS_LABEL: Record<Doc['status'], string> = {
  published: 'Published',
  draft:     'Draft',
  archived:  'Archived',
}

// ─── Data access ──────────────────────────────────────────────────────────────
//
// ANTI-PATTERN (auth in the data layer): These functions mix data retrieval
// with authorization filtering. Authorization logic now lives in three places:
// here, in the routes, and in the view templates. They will inevitably drift.

export function getDocsForUser(user: User): Doc[] {
  // Admins see everything
  if (user.isAdmin) return DOCS

  // Editors see their own docs plus published ones
  if (user.role === 'editor') {
    return DOCS.filter(d => d.ownerId === user.id || d.status === 'published')
  }

  // Viewers only see published, non-sensitive docs
  // ANTI-PATTERN: sensitive check is only here, not in the route handler
  return DOCS.filter(d => d.status === 'published' && !d.sensitive)
}

export function getDocById(id: string): Doc | undefined {
  return DOCS.find(d => d.id === id)
}
