/**
 * Return Engine Service (K21)
 *
 * Checks for inactive users and triggers return push notifications.
 * Rate-limited to 1 notification per user per 48-hour window.
 *
 * Integrates with:
 *   - pushNotificationService.queuePushDelivery
 *   - retention_notifications table (migration 20260510000001)
 */

const { queuePushDelivery } = require('./pushNotificationService');

/**
 * Check if a user has received a retention notification within the given window.
 *
 * @param {object} db - Knex instance
 * @param {number} userId
 * @param {number} windowHours - Look-back window in hours (default 48)
 * @returns {Promise<boolean>}
 */
async function hasRecentRetentionNotification(db, userId, windowHours = 48) {
  const cutoff = new Date(Date.now() - windowHours * 60 * 60 * 1000).toISOString();

  const row = await db('retention_notifications')
    .where('user_id', userId)
    .where('sent_at', '>=', cutoff)
    .first();

  return Boolean(row);
}

/**
 * Record a retention notification in the database.
 *
 * @param {object} db - Knex instance
 * @param {number} userId
 * @param {string} messageType - e.g. 'new_answers', 'reactions', 'trending', 'miss_you'
 * @param {string} triggerReason - human-readable reason for the trigger
 * @param {string} [pushStatus='sent'] - 'sent' | 'push_skipped' | 'notifications_disabled'
 * @returns {Promise<object>} The inserted row
 */
async function recordRetentionNotification(db, userId, messageType, triggerReason, pushStatus = 'sent') {
  const [row] = await db('retention_notifications')
    .insert({
      user_id: userId,
      message_type: messageType,
      trigger_reason: triggerReason,
      status: pushStatus,
      sent_at: db.fn.now(),
    })
    .returning('*');

  return row;
}

/**
 * Build a dynamic return message for a user based on their recent activity.
 *
 * Priority:
 *   1. New answers on their questions → "Your question got new answers"
 *   2. New reactions on their content → "People are reacting"
 *   3. Viral score increased > 50 points → "You're trending"
 *   4. Default → "Come back and see what's new"
 *
 * @param {object} db - Knex instance
 * @param {number} userId
 * @returns {Promise<{ title: string, body: string, message_type: string, trigger_reason: string }>}
 */
async function buildReturnMessage(db, userId) {
  // Check for new answers on user's questions (answers created after user's last_active)
  const newAnswersRow = await db('answers as a')
    .join('questions as q', 'q.id', 'a.question_id')
    .join('users as u', 'u.id', 'q.user_id')
    .where('q.user_id', userId)
    .where('a.user_id', '!=', userId)
    .where(function () {
      this.whereRaw('a.created_at > u.last_active');
    })
    .count('a.id as cnt')
    .first();

  const newAnswersCount = parseInt(newAnswersRow?.cnt || '0', 10);
  if (newAnswersCount > 0) {
    return {
      title: 'New activity on your question',
      body: 'Your question got new answers',
      message_type: 'new_answers',
      trigger_reason: `${newAnswersCount} new answer(s) on user questions`,
    };
  }

  // Check for new reactions (likes) on user's answers
  const newReactionsRow = await db('answer_reactions as ar')
    .join('answers as a', 'a.id', 'ar.answer_id')
    .join('users as u', 'u.id', 'a.user_id')
    .where('a.user_id', userId)
    .where(function () {
      this.whereRaw('ar.created_at > u.last_active');
    })
    .count('ar.id as cnt')
    .first()
    .catch(() => ({ cnt: '0' })); // table may not exist in all environments

  const newReactionsCount = parseInt(newReactionsRow?.cnt || '0', 10);
  if (newReactionsCount > 0) {
    return {
      title: 'People are reacting',
      body: 'People are reacting',
      message_type: 'reactions',
      trigger_reason: `${newReactionsCount} new reaction(s) on user answers`,
    };
  }

  // Check if viral score increased > 50 points since last_active
  const viralRow = await db('question_stats as qs')
    .join('questions as q', 'q.id', 'qs.question_id')
    .join('users as u', 'u.id', 'q.user_id')
    .where('q.user_id', userId)
    .where('qs.viral_score', '>', 50)
    .where(function () {
      this.whereRaw('qs.viral_score_updated_at > u.last_active');
    })
    .first()
    .catch(() => null); // viral_score columns may not exist yet

  if (viralRow) {
    return {
      title: "You're trending",
      body: "You're trending",
      message_type: 'trending',
      trigger_reason: `viral score > 50 on user content`,
    };
  }

  // Default message
  return {
    title: 'Come back and see what\'s new',
    body: 'Come back and see what\'s new',
    message_type: 'miss_you',
    trigger_reason: 'user inactive for 24+ hours',
  };
}

/**
 * Find users inactive for 24+ hours and trigger return push notifications.
 * Rate-limited: max 1 notification per user per 48-hour window.
 *
 * @param {object} db - Knex instance
 * @returns {Promise<{ checked: number, triggered: number, skipped: number }>}
 */
async function checkAndTriggerReturns(db) {
  const cutoff24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  // Find users who have been inactive for 24+ hours and have push tokens
  const inactiveUsers = await db('users as u')
    .join('push_tokens as pt', function () {
      this.on('pt.user_id', '=', 'u.id')
        .andOn(db.raw('pt.status = ?', ['active']))
        .andOnNull('pt.revoked_at');
    })
    .whereNull('u.deleted_at')
    .where(function () {
      this.whereNull('u.is_blocked').orWhere('u.is_blocked', false);
    })
    .where(function () {
      // last_active is older than 24 hours ago
      this.where('u.last_active', '<', cutoff24h)
        .orWhereNull('u.last_active');
    })
    .select('u.id as user_id', 'u.push_notifications_enabled')
    .distinct('u.id as user_id', 'u.push_notifications_enabled');

  const checked = inactiveUsers.length;
  let triggered = 0;
  let skipped = 0;

  for (const user of inactiveUsers) {
    const userId = user.user_id;

    // Check if notifications are disabled for this user
    if (user.push_notifications_enabled === false) {
      await recordRetentionNotification(
        db,
        userId,
        'miss_you',
        'user inactive for 24+ hours',
        'notifications_disabled'
      ).catch((err) => {
        console.error(`Failed to record notifications_disabled for user ${userId}:`, err);
      });
      skipped += 1;
      continue;
    }

    // Rate limit: skip if already notified within 48 hours
    const alreadyNotified = await hasRecentRetentionNotification(db, userId, 48);
    if (alreadyNotified) {
      skipped += 1;
      continue;
    }

    // Build the dynamic message
    const message = await buildReturnMessage(db, userId);

    // Attempt to queue the push notification
    try {
      await queuePushDelivery(db, {
        userIds: [userId],
        title: message.title,
        body: message.body,
        data: { type: 'return_engine', message_type: message.message_type },
        dedupeKey: `return-engine:user:${userId}:${new Date().toISOString().slice(0, 13)}`,
      });

      // Record the notification as sent
      await recordRetentionNotification(
        db,
        userId,
        message.message_type,
        message.trigger_reason,
        'sent'
      );

      triggered += 1;
    } catch (err) {
      // Invalid/expired push token or other push error → log as push_skipped
      console.error(`Push delivery failed for user ${userId}:`, err);

      await recordRetentionNotification(
        db,
        userId,
        message.message_type,
        message.trigger_reason,
        'push_skipped'
      ).catch((recordErr) => {
        console.error(`Failed to record push_skipped for user ${userId}:`, recordErr);
      });

      skipped += 1;
    }
  }

  return { checked, triggered, skipped };
}

module.exports = {
  checkAndTriggerReturns,
  buildReturnMessage,
  hasRecentRetentionNotification,
  recordRetentionNotification,
};
