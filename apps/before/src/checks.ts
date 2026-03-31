import type { User, Doc } from './data.js'

// ─── Permission check functions ───────────────────────────────────────────────
//
// These were written at different times by different developers. Each is
// slightly different from the others. Routes that use these functions get
// different behaviour from routes that duplicate the logic inline.
//
// ANTI-PATTERN (duplicated logic): The same fundamental question — "can this
// user mutate this document?" — is answered three slightly different ways
// across these functions, and a fourth way inline in several routes.

// Written first, when only admin + owner needed write access
export function canEditDocument(user: User, doc: Doc): boolean {
  return user.isAdmin || doc.ownerId === user.id
}

// Written later when editors were added — copies canEditDocument but adds role
// ANTI-PATTERN: slightly inconsistent with canEditDocument (uses role, not canEdit flag)
export function canWriteDocument(user: User, doc: Doc): boolean {
  if (user.isAdmin) return true
  if (doc.ownerId === user.id) return true
  if (user.role === 'editor') return true
  return false
}

// Written for the archive feature — yet another variant
// ANTI-PATTERN: archived docs can still be "archived" again because the check
// doesn't guard against that edge case (unlike the policy in the "after" demo)
export function canArchiveDocument(user: User, doc: Doc): boolean {
  // Admins always can
  if (user.isAdmin) return true
  // Owners can archive their own
  if (doc.ownerId === user.id) return true
  // ANTI-PATTERN (one-off boolean): uses canEdit flag, which is out of sync
  // for Bob (he's an editor but canEdit is false due to a migration bug)
  if (user.canEdit) return true
  return false
}

// ANTI-PATTERN (allow by default): This function only checks the deny case.
// Any user who isn't explicitly blocked is allowed — including future roles
// that haven't been thought of yet.
export function canViewDocumentHistory(user: User, _doc: Doc): boolean {
  if (user.role === 'guest') return false
  // "everyone else can see history, we'll add granularity later"
  return true
}

// ANTI-PATTERN (coarse-grained): One flag for "admin area" covers the entire
// admin section — user management, system config, reports, audit logs.
// There's no way to grant partial admin access.
export function canAccessAdmin(user: User): boolean {
  return user.isAdmin || user.id === 'superadmin'
}
