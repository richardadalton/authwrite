export interface Doc {
  type:    string   // satisfies Resource constraint — always 'document'
  id:      string
  title:   string
  status:  'draft' | 'published' | 'archived'
  ownerId: string
  excerpt: string
}

export interface User {
  id:    string
  name:  string
  roles: string[]
  color: string
}

// ─── Documents ────────────────────────────────────────────────────────────────

export const DOCS: Doc[] = [
  {
    type:    'document',
    id:      'doc-1',
    title:   'Q4 Financial Report',
    status:  'published',
    ownerId: 'alice',
    excerpt: 'Quarterly revenue summary covering October through December. Final figures pending auditor sign-off.',
  },
  {
    type:    'document',
    id:      'doc-2',
    title:   'Product Roadmap 2026',
    status:  'draft',
    ownerId: 'bob',
    excerpt: 'Working draft of the upcoming product roadmap. Includes proposed feature set and delivery milestones.',
  },
  {
    type:    'document',
    id:      'doc-3',
    title:   'Legacy API Specification',
    status:  'archived',
    ownerId: 'alice',
    excerpt: 'Archived documentation for the v1 API. Superseded by the v2 specification released in Q2 2025.',
  },
  {
    type:    'document',
    id:      'doc-4',
    title:   'Engineering Onboarding Guide',
    status:  'published',
    ownerId: 'bob',
    excerpt: 'Step-by-step onboarding guide for new engineers. Covers local setup, CI pipeline, and deployment.',
  },
  {
    type:    'document',
    id:      'doc-5',
    title:   'Security Incident Report — March',
    status:  'draft',
    ownerId: 'alice',
    excerpt: 'Internal report documenting the March 2026 security incident. Restricted to security team and management.',
  },
]

// ─── Users ────────────────────────────────────────────────────────────────────

export const USERS: Record<string, User> = {
  admin: {
    id:    'admin',
    name:  'Admin',
    roles: ['admin'],
    color: '#7c3aed',
  },
  alice: {
    id:    'alice',
    name:  'Alice (editor, owner)',
    roles: ['editor'],
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
    name:  'Carol (viewer)',
    roles: ['viewer'],
    color: '#059669',
  },
  stranger: {
    id:    'stranger',
    name:  'Stranger (no roles)',
    roles: [],
    color: '#64748b',
  },
}

export const STATUS_LABEL: Record<Doc['status'], string> = {
  published: 'Published',
  draft:     'Draft',
  archived:  'Archived',
}
