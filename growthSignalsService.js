/**
 * Growth Signals Service (K18)
 *
 * Processes normalized events for growth, retention, and engagement signals.
 * Tracks invite graphs, retention notifications, and feed session strategies.
 *
 * SLA: <100ms per event
 */

const { incCounter } = require('./metricsService');

const logger = {
  warn: (msg, data) => console.warn(`[growthSignalsService] WARN: ${msg}`, data || ''),
  error: (msg, data) => console.error(`[growthSignalsService] ERROR: ${msg}`, data || ''),
};

/**
 * Growth event types and their signal categories.
 */
const GROWTH_EVENT_TYPES = new Set([
  'invite_sent',
  'invite_accepted',
  'share_clicked',
  'session_returned',
  'first_30s_complete',
]);

/**
 * Process a normalized event for growth signals.
 *
 * Handles the following event types:
 *   - invite_sent / invite_accepted → increments invite counter
 *   - share_clicked                 → increments share counter
 *   - session_returned              → increments return counter
 *   - first_30s_complete            → increments completion counter
 *
 * Non-growth events are silently ignored.
 *
 * @param {import('knex').Knex} db - Knex database instance
 * @param {string|number} userId - The user ID
 * @param {Object} normalizedEvent - Normalized event from eventNormalizationService
 * @param {string} normalizedEvent.event_type - The event type
 * @param {string} [normalizedEvent.session_id] - Session identifier
 * @param {Object} [normalizedEvent.raw_payload] - Original raw event payload
 * @returns {Promise<void>}
 */
async function processGrowthEvent(db, userId, normalizedEvent) {
  if (!normalizedEvent || !GROWTH_EVENT_TYPES.has(normalizedEvent.event_type)) {
    return;
  }

  const { event_type, session_id, raw_payload } = normalizedEvent;

  try {
    switch (event_type) {
      case 'invite_sent': {
        incCounter('growth_signal_invites_total', { type: 'sent' });
        // If the raw payload contains an invitee_id, record the invite link
        const inviteeId = raw_payload?.invitee_id;
        if (db && inviteeId) {
          await recordInviteLink(db, userId, inviteeId);
        }
        break;
      }

      case 'invite_accepted': {
        incCounter('growth_signal_invites_total', { type: 'accepted' });
        // If the raw payload contains an inviter_id, record the reverse link
        const inviterId = raw_payload?.inviter_id;
        if (db && inviterId) {
          await recordInviteLink(db, inviterId, userId);
        }
        break;
      }

      case 'share_clicked': {
        incCounter('growth_signal_shares_total', {});
        break;
      }

      case 'session_returned': {
        incCounter('retention_signal_returns_total', {});
        // Record a retention notification entry if we have a session
        if (db && session_id) {
          await db('feed_session_strategies')
            .insert({
              user_id: userId,
              session_id,
              strategy: 'return_session',
              computed_at: new Date(),
              event_count: 1,
            })
            .onConflict()
            .ignore()
            .catch((err) => {
              logger.warn('Failed to record session_returned strategy', { error: err.message });
            });
        }
        break;
      }

      case 'first_30s_complete': {
        incCounter('engagement_signal_completions_total', {});
        break;
      }

      default:
        break;
    }
  } catch (err) {
    logger.error('processGrowthEvent failed', { event_type, userId, error: err.message });
    // Non-critical — swallow errors so caller is not affected
  }
}

/**
 * Record an invite relationship in the user_invite_graph table.
 *
 * @param {import('knex').Knex} db - Knex database instance
 * @param {string|number} inviterId - The user who sent the invite
 * @param {string|number} inviteeId - The user who received the invite
 * @param {string} [inviteType='direct'] - The type of invite
 * @returns {Promise<void>}
 */
async function recordInviteLink(db, inviterId, inviteeId, inviteType = 'direct') {
  if (!db || !inviterId || !inviteeId) return;

  try {
    await db('user_invite_graph').insert({
      inviter_id: inviterId,
      invitee_id: inviteeId,
      invite_type: inviteType,
      created_at: new Date(),
    });
  } catch (err) {
    logger.error('recordInviteLink failed', { inviterId, inviteeId, error: err.message });
    // Non-critical — swallow errors
  }
}

/**
 * Get aggregated growth metrics for a user.
 *
 * @param {import('knex').Knex} db - Knex database instance
 * @param {string|number} userId - The user ID
 * @returns {Promise<{ invitesSent: number, invitesAccepted: number, sharesTotal: number, returnsTotal: number, completionsTotal: number }>}
 */
async function getGrowthMetrics(db, userId) {
  if (!db || !userId) {
    return {
      invitesSent: 0,
      invitesAccepted: 0,
      sharesTotal: 0,
      returnsTotal: 0,
      completionsTotal: 0,
    };
  }

  try {
    const [invitesSentRow] = await db('user_invite_graph')
      .where('inviter_id', userId)
      .count('id as count');

    const [invitesAcceptedRow] = await db('user_invite_graph')
      .where('invitee_id', userId)
      .count('id as count');

    const [sharesRow] = await db('client_events')
      .where({ user_id: userId, event_type: 'share_clicked' })
      .count('id as count');

    const [returnsRow] = await db('client_events')
      .where({ user_id: userId, event_type: 'session_returned' })
      .count('id as count');

    const [completionsRow] = await db('client_events')
      .where({ user_id: userId, event_type: 'first_30s_complete' })
      .count('id as count');

    return {
      invitesSent: Number(invitesSentRow?.count || 0),
      invitesAccepted: Number(invitesAcceptedRow?.count || 0),
      sharesTotal: Number(sharesRow?.count || 0),
      returnsTotal: Number(returnsRow?.count || 0),
      completionsTotal: Number(completionsRow?.count || 0),
    };
  } catch (err) {
    logger.error('getGrowthMetrics failed', { userId, error: err.message });
    return {
      invitesSent: 0,
      invitesAccepted: 0,
      sharesTotal: 0,
      returnsTotal: 0,
      completionsTotal: 0,
    };
  }
}

module.exports = {
  processGrowthEvent,
  recordInviteLink,
  getGrowthMetrics,
};
