import { randomUUID } from 'node:crypto';

function mapExternalIdentityRow(row) {
  if (!row) return undefined;
  return {
    id: row.id,
    userId: row.user_id,
    providerIssuer: row.provider_issuer,
    providerSubject: row.provider_subject,
    emailAtLinkTime: row.email_at_link_time,
    emailVerifiedAtLinkTime: Boolean(row.email_verified_at_link_time),
    linkedAt: row.linked_at,
    lastLoginAt: row.last_login_at,
    disabledAt: row.disabled_at,
  };
}

export function createExternalIdentitiesRepository(db) {
  return {
    findActive({ providerIssuer, providerSubject }) {
      const row = db.prepare(`
        SELECT *
        FROM external_identities
        WHERE provider_issuer = ?
          AND provider_subject = ?
          AND disabled_at IS NULL
      `).get(providerIssuer, providerSubject);
      return mapExternalIdentityRow(row);
    },

    createLink({ userId, providerIssuer, providerSubject, emailAtLinkTime, emailVerifiedAtLinkTime }) {
      const row = db.prepare(`
        INSERT INTO external_identities (
          id,
          user_id,
          provider_issuer,
          provider_subject,
          email_at_link_time,
          email_verified_at_link_time
        )
        VALUES (?, ?, ?, ?, ?, ?)
        RETURNING *
      `).get(
        randomUUID(),
        userId,
        providerIssuer,
        providerSubject,
        emailAtLinkTime || null,
        emailVerifiedAtLinkTime ? 1 : 0,
      );
      return mapExternalIdentityRow(row);
    },

    markLogin({ providerIssuer, providerSubject, lastLoginAt }) {
      const row = db.prepare(`
        UPDATE external_identities
        SET last_login_at = ?
        WHERE provider_issuer = ?
          AND provider_subject = ?
          AND disabled_at IS NULL
        RETURNING *
      `).get(lastLoginAt, providerIssuer, providerSubject);
      return mapExternalIdentityRow(row);
    },
  };
}
