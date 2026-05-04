/**
 * GDPR Export Service
 *
 * Mbledh të gjitha të dhënat e një përdoruesi për eksport GDPR.
 * Eksporti prodhon JSON me të gjitha të dhënat (pa fjalëkalime/hash-e).
 * SLA: eksporti duhet të përfundojë brenda 24 orësh (Kërkesa 11.4).
 */

// Fushat e ndjeshme që duhen hequr nga eksporti
const SENSITIVE_FIELDS = [
  'password',
  'password_hash',
  'hashed_password',
  'token',
  'token_hash',
  'secret',
];

/**
 * Hiq fushat e ndjeshme nga një objekt.
 * @param {object} obj
 * @returns {object}
 */
function stripSensitiveFields(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const result = { ...obj };
  for (const field of SENSITIVE_FIELDS) {
    delete result[field];
  }
  return result;
}

/**
 * Mbledh të gjitha të dhënat e përdoruesit nga DB për eksport GDPR.
 *
 * @param {import('knex').Knex} db
 * @param {number|string} userId
 * @returns {Promise<object>} — objekt JSON me të gjitha të dhënat e përdoruesit
 */
async function exportUserData(db, userId) {
  const uid = Number(userId);

  // Mbledh të dhënat paralelisht për performancë
  const [
    userRow,
    answers,
    clientEvents,
    pushTokens,
    userConsents,
    refreshTokens,
  ] = await Promise.all([
    db('users')
      .where('id', uid)
      .select(
        'id',
        'username',
        'email',
        'country',
        'role',
        'is_premium',
        'created_at',
        'updated_at',
        'last_login_at',
        'deleted_at',
        'bio',
        'avatar_url',
        'phone',
        'date_of_birth',
        'language',
        'timezone',
      )
      .first(),

    db('answers')
      .where('user_id', uid)
      .select(
        'id',
        'question_id',
        'answer_type',
        'text_content',
        'video_url',
        'audio_url',
        'duration_ms',
        'views',
        'likes',
        'shares',
        'created_at',
        'updated_at',
        'deleted_at',
        'is_hidden',
      )
      .orderBy('created_at', 'desc'),

    db('client_events')
      .where('user_id', uid)
      .select(
        'id',
        'event_type',
        'event_id',
        'category',
        'weight',
        'raw_payload',
        'normalized_at',
        'created_at',
      )
      .orderBy('created_at', 'desc')
      .limit(10000), // kufizim i arsyeshëm për eksport

    db('push_tokens')
      .where('user_id', uid)
      .select(
        'id',
        'platform',
        'created_at',
        'updated_at',
        'is_active',
        // 'token' hiqet — është e ndjeshme
      ),

    db('user_consents')
      .where('user_id', uid)
      .select(
        'id',
        'consent_type',
        'granted',
        'granted_at',
        'revoked_at',
        'ip_address',
        'user_agent',
        'created_at',
        'updated_at',
      )
      .orderBy('created_at', 'desc'),

    db('auth_refresh_tokens')
      .where('user_id', uid)
      .select(
        'id',
        'created_at',
        'expires_at',
        'revoked_at',
        'user_agent',
        'ip_address',
        // 'token' dhe 'token_hash' hiqen — janë të ndjeshme
      )
      .orderBy('created_at', 'desc'),
  ]);

  if (!userRow) {
    throw new Error('user_not_found');
  }

  return {
    exported_at: new Date().toISOString(),
    user: stripSensitiveFields(userRow),
    answers: answers.map(stripSensitiveFields),
    client_events: clientEvents.map(stripSensitiveFields),
    push_tokens: pushTokens.map(stripSensitiveFields),
    user_consents: userConsents.map(stripSensitiveFields),
    auth_sessions: refreshTokens.map(stripSensitiveFields),
    summary: {
      total_answers: answers.length,
      total_events: clientEvents.length,
      total_consents: userConsents.length,
      total_sessions: refreshTokens.length,
    },
  };
}

module.exports = {
  exportUserData,
  stripSensitiveFields,
};
