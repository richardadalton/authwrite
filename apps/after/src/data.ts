// ─── Data ─────────────────────────────────────────────────────────────────────
//
// FIX AP-1 (one-off booleans): User has only identity fields and a roles array.
// There are no isAdmin, canEdit, isPremium, or isLegacy flags. The policy
// decides what each role can do — that logic lives in one place (policy.ts).
//
// FIX AP-12 (business flag as auth): 'premium' is a role, not a boolean.
// It is granted through the same role assignment mechanism as any other role,
// and the policy expresses what premium users can access.

export interface User {
  id:    string
  name:  string
  roles: string[]   // the authoritative source — no parallel boolean flags
  color: string
}

export interface Doc {
  id:        string
  title:     string
  status:    'draft' | 'published' | 'archived'
  ownerId:   string
  sensitive: boolean
  excerpt:   string
}

// ─── Sentinel resource for system-level actions ───────────────────────────────
//
// Actions like accessAdmin, manageUsers, and viewReports are not scoped to a
// specific document. We evaluate them against a typed system resource so the
// policy can match on resource.type if needed.

export const SYSTEM_RESOURCE = { type: 'system' as const }

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
    sensitive: true,
    excerpt:   'Internal report documenting the March 2026 security incident. Restricted to security team and management.',
  },
]

// ─── Users ────────────────────────────────────────────────────────────────────
//
// FIX AP-10 (hardcoded ID): 'superadmin' is gone. The legacy account has been
// migrated to the normal role system. Its access comes from roles, not from
// a special-cased ID.
//
// FIX AP-5 (inconsistency): Bob is now a clean editor. The migration bug
// (canEdit: false) cannot exist here because there is no canEdit flag.
// His access is determined entirely by his roles array.

export const USERS: Record<string, User> = {
  admin: {
    id:    'admin',
    name:  'Admin',
    roles: ['admin'],
    color: '#7c3aed',
  },
  alice: {
    id:    'alice',
    name:  'Alice (editor, premium)',
    roles: ['editor', 'premium'],
    color: '#0891b2',
  },
  bob: {
    id:    'bob',
    name:  'Bob (editor)',
    roles: ['editor'],
    color: '#0891b2',
  },
  carol: {
    id:    'carol',
    name:  'Carol (viewer, premium)',
    roles: ['viewer', 'premium'],
    color: '#059669',
  },
  dave: {
    id:    'dave',
    name:  'Dave (viewer)',
    roles: ['viewer'],
    color: '#64748b',
  },
  stranger: {
    id:    'stranger',
    name:  'Stranger (no roles)',
    roles: [],
    color: '#94a3b8',
  },
}

export const STATUS_LABEL: Record<Doc['status'], string> = {
  published: 'Published',
  draft:     'Draft',
  archived:  'Archived',
}

// ─── Data access ──────────────────────────────────────────────────────────────
//
// FIX AP-6 (auth in data layer): These functions return raw data with no
// permission filtering. Authorization is the enforcer's job — the data layer
// just fetches. Routes call getDocById() and then let the auth middleware
// decide whether the user may see it.

export function getAllDocs(): Doc[] {
  return DOCS
}

export function getDocById(id: string): Doc | undefined {
  return DOCS.find(d => d.id === id)
}
