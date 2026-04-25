const crypto = require("crypto");

const ACCESS_TOKEN_TTL = process.env.ACCESS_TOKEN_TTL || "15m";
const REFRESH_TOKEN_TTL_DAYS = Number(process.env.REFRESH_TOKEN_TTL_DAYS || 45);

function createOpaqueToken() {
  return crypto.randomBytes(48).toString("hex");
}

function hashToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

function getRefreshExpiryDate() {
  return new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
}

async function createRefreshSession(db, userId, meta = {}) {
  const plainToken = createOpaqueToken();
  const expiresAt = getRefreshExpiryDate();

  const [row] = await db("auth_refresh_tokens")
    .insert({
      user_id: userId,
      token_hash: hashToken(plainToken),
      expires_at: expiresAt.toISOString(),
      user_agent: meta.userAgent || null,
      ip_address: meta.ipAddress || null,
    })
    .returning("*");

  return {
    session: row,
    refreshToken: plainToken,
    expiresAt,
  };
}

async function findRefreshSession(db, refreshToken) {
  if (!refreshToken) return null;
  const tokenHash = hashToken(refreshToken);

  const row = await db("auth_refresh_tokens")
    .where({ token_hash: tokenHash })
    .first();

  if (!row) return null;
  if (row.revoked_at) return null;
  if (new Date(row.expires_at).getTime() <= Date.now()) return null;

  return row;
}

async function rotateRefreshSession(db, currentSession, meta = {}) {
  const { session, refreshToken, expiresAt } = await createRefreshSession(db, currentSession.user_id, meta);

  await db("auth_refresh_tokens")
    .where({ id: currentSession.id })
    .update({
      revoked_at: new Date().toISOString(),
      replaced_by_token_id: session.id,
      last_used_at: new Date().toISOString(),
    });

  return { session, refreshToken, expiresAt };
}

async function revokeRefreshSession(db, refreshToken) {
  if (!refreshToken) return;
  await db("auth_refresh_tokens")
    .where({ token_hash: hashToken(refreshToken) })
    .whereNull("revoked_at")
    .update({ revoked_at: new Date().toISOString() });
}

async function revokeAllUserSessions(db, userId) {
  await db("auth_refresh_tokens")
    .where({ user_id: userId })
    .whereNull("revoked_at")
    .update({ revoked_at: new Date().toISOString() });
}

module.exports = {
  ACCESS_TOKEN_TTL,
  createRefreshSession,
  findRefreshSession,
  hashToken,
  revokeAllUserSessions,
  revokeRefreshSession,
  rotateRefreshSession,
};
