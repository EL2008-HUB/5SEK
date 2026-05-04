/**
 * Admin Service - Core admin functionality
 */

const {
  restoreAnswer,
  restoreUser,
  setUserBlocked,
  softDeleteAnswer,
  softDeleteUser,
} = require("./safetyService");
const { createRefund, hasStripeSecret } = require("./stripeService");

function parseJsonMaybe(value, fallback) {
  if (value == null) return fallback;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch (_) {
    return fallback;
  }
}

function numberValue(value) {
  return Number(value || 0);
}

function extractStripePaymentReference(payload) {
  const root = parseJsonMaybe(payload, {});
  const object = root?.data?.object || root || {};
  return {
    customerId: object.customer || object.customer_id || null,
    paymentIntentId:
      object.payment_intent ||
      object.payment_intent_id ||
      object?.latest_invoice?.payment_intent ||
      object?.charges?.data?.[0]?.payment_intent ||
      null,
    chargeId:
      object.charge ||
      object.latest_charge ||
      object?.charges?.data?.[0]?.id ||
      null,
  };
}

async function resolveRefundReference(db, refundRequest) {
  if (refundRequest.stripe_payment_intent_id) {
    return {
      paymentIntentId: refundRequest.stripe_payment_intent_id,
      chargeId: null,
    };
  }

  const user = await db("users")
    .where("id", refundRequest.user_id)
    .select("id", "stripe_customer_id")
    .first();

  if (!user?.stripe_customer_id) {
    return null;
  }

  const events = await db("payment_events")
    .orderBy("processed_at", "desc")
    .limit(100);

  for (const event of events) {
    const reference = extractStripePaymentReference(event.payload);
    if (reference.customerId !== user.stripe_customer_id) {
      continue;
    }

    if (reference.paymentIntentId || reference.chargeId) {
      return reference;
    }
  }

  return null;
}

const adminService = {
  // User Management
  async getUsers(db, filters = {}, pagination = { page: 1, limit: 50 }) {
    const { page, limit } = pagination;
    const offset = (page - 1) * limit;
    
    let query = db('users')
      .select(
        'id',
        'username',
        'email',
        'country',
        'role',
        'is_premium',
        'created_at',
        'last_login_at',
        'is_admin'
      )
      .orderBy('created_at', 'desc')
      .limit(limit)
      .offset(offset);

    if (filters.role) {
      query = query.where('role', filters.role);
    }
    if (filters.country) {
      query = query.where('country', filters.country);
    }
    if (filters.isPremium !== undefined) {
      query = query.where('is_premium', filters.isPremium);
    }
    if (filters.search) {
      query = query.where(builder => {
        builder.where('username', 'ilike', `%${filters.search}%`)
          .orWhere('email', 'ilike', `%${filters.search}%`);
      });
    }

    const users = await query;
    const total = await db('users').count('id as count').first();

    return {
      users,
      pagination: {
        page,
        limit,
        total: parseInt(total.count),
        totalPages: Math.ceil(total.count / limit)
      }
    };
  },

  async getUserDetails(db, userId) {
    const user = await db('users')
      .select('*')
      .where('id', userId)
      .first();

    if (!user) return null;

    // Get user stats
    const stats = await db('answers')
      .where('user_id', userId)
      .select(
        db.raw('COUNT(*) as total_answers'),
        db.raw('SUM(CASE WHEN answer_type = ? THEN 1 ELSE 0 END) as video_answers', ['video']),
        db.raw('SUM(views) as total_views'),
        db.raw('SUM(likes) as total_likes')
      )
      .first();

    // Get moderation history
    const moderationHistory = await db('user_moderation_actions')
      .where('user_id', userId)
      .orderBy('created_at', 'desc')
      .select('*');

    // Get support tickets
    const tickets = await db('support_tickets')
      .where('user_id', userId)
      .orderBy('created_at', 'desc')
      .select('id', 'subject', 'status', 'created_at');

    return {
      ...user,
      stats,
      moderationHistory,
      tickets
    };
  },

  async updateUserRole(db, userId, { role, adminPermissions, adminId }) {
    const updateData = {
      role,
      updated_at: new Date()
    };

    if (role === 'admin' || role === 'super_admin' || role === 'moderator') {
      updateData.is_admin = true;
      updateData.admin_since = new Date();
      updateData.admin_permissions = JSON.stringify(adminPermissions || ['moderate']);
    } else {
      updateData.is_admin = false;
      updateData.admin_permissions = null;
    }

    await db('users')
      .where('id', userId)
      .update(updateData);

    // Log admin action
    await db('admin_activity_log').insert({
      admin_id: adminId,
      action_type: 'other',
      description: `Updated user ${userId} role to ${role}`,
      metadata: { user_id: userId, new_role: role, permissions: adminPermissions }
    });

    return { success: true };
  },

  // Daily Questions Management
  async scheduleDailyQuestion(db, { questionId, scheduledFor, country, priority, adminId }) {
    const existing = await db('daily_questions_schedule')
      .where({ scheduled_for: scheduledFor, country: country || 'GLOBAL' })
      .first();

    if (existing) {
      throw new Error(`A question is already scheduled for ${scheduledFor} in ${country || 'GLOBAL'}`);
    }

    const [id] = await db('daily_questions_schedule').insert({
      question_id: questionId,
      scheduled_for: scheduledFor,
      country: country || 'GLOBAL',
      priority: priority || 0,
      status: 'scheduled',
      created_by_admin: adminId,
      created_at: new Date(),
      updated_at: new Date()
    }).returning('id');

    return { id, success: true };
  },

  async getScheduledQuestions(db, filters = {}) {
    let query = db('daily_questions_schedule')
      .join('questions', 'daily_questions_schedule.question_id', 'questions.id')
      .select(
        'daily_questions_schedule.*',
        'questions.text as question_text',
        'questions.category'
      )
      .orderBy('scheduled_for', 'desc');

    if (filters.status) {
      query = query.where('daily_questions_schedule.status', filters.status);
    }
    if (filters.country) {
      query = query.where('daily_questions_schedule.country', filters.country);
    }
    if (filters.fromDate) {
      query = query.where('scheduled_for', '>=', filters.fromDate);
    }
    if (filters.toDate) {
      query = query.where('scheduled_for', '<=', filters.toDate);
    }

    return await query;
  },

  async updateScheduledQuestion(db, scheduleId, updates, adminId) {
    await db('daily_questions_schedule')
      .where('id', scheduleId)
      .update({
        ...updates,
        updated_at: new Date()
      });

    return { success: true };
  },

  // Hot Questions / Trending
  async getTrendingQuestions(db, options = {}) {
    const { country = 'GLOBAL', limit = 20 } = options;
    
    return await db('trending_questions')
      .join('questions', 'trending_questions.question_id', 'questions.id')
      .where('trending_questions.country', country)
      .where('trending_questions.expires_at', '>', new Date())
      .select(
        'trending_questions.*',
        'questions.text as question_text',
        'questions.category'
      )
      .orderBy('trending_score', 'desc')
      .limit(limit);
  },

  async calculateTrendingQuestions(db, country = 'GLOBAL') {
    // Calculate trending score based on recent activity
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    
    const trending = await db.raw(`
      SELECT 
        q.id as question_id,
        q.country,
        COUNT(DISTINCT a.id) as answers_last_hour,
        COUNT(DISTINCT CASE WHEN a.created_at > ? THEN a.id END) * 10 +
        COALESCE(SUM(a.views), 0) * 2 +
        COALESCE(SUM(a.likes), 0) * 3 +
        COALESCE(SUM(a.shares), 0) * 4 as trending_score
      FROM questions q
      LEFT JOIN answers a ON a.question_id = q.id AND a.created_at > ?
      WHERE q.country = ? OR q.country = 'GLOBAL'
      GROUP BY q.id, q.country
      HAVING COUNT(DISTINCT a.id) > 0
      ORDER BY trending_score DESC
      LIMIT 50
    `, [oneHourAgo, oneHourAgo, country]);

    // Insert/update trending questions
    for (const item of trending.rows || trending) {
      await db('trending_questions')
        .insert({
          question_id: item.question_id,
          country: item.country || country,
          trending_score: item.trending_score,
          answers_last_hour: item.answers_last_hour,
          calculated_at: new Date(),
          expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000)
        })
        .onConflict(['question_id', 'country'])
        .merge();
    }

    return { calculated: trending.length || trending.rows?.length || 0 };
  },

  // KPIs & Analytics
  async getKPIs(db, dateRange = {}) {
    const { startDate, endDate } = dateRange;
    const start = startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const end = endDate || new Date();

    const retention = await db.raw(`
      SELECT 
        DATE(u.created_at) as date,
        COUNT(*) as total_users,
        COUNT(DISTINCT CASE WHEN ce.user_id IS NOT NULL THEN u.id END) as retained_users,
        ROUND(
          COUNT(DISTINCT CASE WHEN ce.user_id IS NOT NULL THEN u.id END) * 100.0 / NULLIF(COUNT(*), 0),
          2
        ) as retention_rate
      FROM users u
      LEFT JOIN client_events ce
        ON ce.user_id = u.id
        AND ce.created_at >= DATE_TRUNC('day', u.created_at) + INTERVAL '1 day'
        AND ce.created_at < DATE_TRUNC('day', u.created_at) + INTERVAL '2 day'
      WHERE u.created_at BETWEEN ? AND ?
        AND u.deleted_at IS NULL
      GROUP BY DATE(u.created_at)
      ORDER BY date DESC
    `, [start, end]);

    const completionRate = await db.raw(`
      SELECT 
        COUNT(*) FILTER (WHERE event_type = 'answer_start') as started,
        COUNT(*) FILTER (WHERE event_type = 'answer_complete') as completed,
        ROUND(
          COUNT(*) FILTER (WHERE event_type = 'answer_complete') * 100.0 /
          NULLIF(COUNT(*) FILTER (WHERE event_type = 'answer_start'), 0),
          2
        ) as completion_rate
      FROM client_events
      WHERE created_at BETWEEN ? AND ?
    `, [start, end]);

    const sessionLength = await db.raw(`
      SELECT ROUND(AVG(session_watch_time), 2) as avg_duration
      FROM (
        SELECT session_id, SUM(COALESCE(watch_time, 0)) as session_watch_time
        FROM answer_events
        WHERE created_at BETWEEN ? AND ?
          AND session_id IS NOT NULL
        GROUP BY session_id
      ) sessions
    `, [start, end]);

    const duelStats = await db.raw(`
      SELECT
        COUNT(DISTINCT CASE WHEN event_type IN ('app_open', 'app_resume', 'feed_open', 'feed_swipe', 'answer_start', 'answer_complete') THEN user_id END) as active_users,
        COUNT(DISTINCT CASE WHEN event_type = 'duel_vote' THEN user_id END) as duel_users,
        ROUND(
          COUNT(DISTINCT CASE WHEN event_type = 'duel_vote' THEN user_id END) * 100.0 /
          NULLIF(COUNT(DISTINCT CASE WHEN event_type IN ('app_open', 'app_resume', 'feed_open', 'feed_swipe', 'answer_start', 'answer_complete') THEN user_id END), 0),
          2
        ) as participation_rate
      FROM client_events
      WHERE created_at BETWEEN ? AND ?
    `, [start, end]);

    const paywallStats = await db.raw(`
      SELECT 
        COUNT(DISTINCT CASE WHEN event_type = 'paywall_shown' THEN user_id END) as users_shown,
        COUNT(DISTINCT CASE WHEN event_type = 'paywall_clicked' THEN user_id END) as users_converted,
        ROUND(
          COUNT(DISTINCT CASE WHEN event_type = 'paywall_clicked' THEN user_id END) * 100.0 /
          NULLIF(COUNT(DISTINCT CASE WHEN event_type = 'paywall_shown' THEN user_id END), 0),
          2
        ) as conversion_rate
      FROM paywall_events
      WHERE created_at BETWEEN ? AND ?
    `, [start, end]);

    const completionSummary = completionRate.rows?.[0] || completionRate[0] || {};
    const duelSummary = duelStats.rows?.[0] || duelStats[0] || {};
    const paywallSummary = paywallStats.rows?.[0] || paywallStats[0] || {};
    const sessionSummary = sessionLength.rows?.[0] || sessionLength[0] || {};

    return {
      retention: retention.rows || retention,
      completionRate: completionSummary,
      avgSessionLength: numberValue(sessionSummary.avg_duration),
      duelParticipation: {
        active_users: numberValue(duelSummary.active_users),
        duel_users: numberValue(duelSummary.duel_users),
        participation_rate: numberValue(duelSummary.participation_rate),
      },
      paywallConversion: paywallSummary
    };
  },

  async getRealtimeStats(db) {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [activeUsers, todayStats, recentAnswers] = await Promise.all([
      db('client_events')
        .where('created_at', '>', oneHourAgo)
        .countDistinct('user_id as count')
        .first(),
      
      db('answers')
        .where('created_at', '>=', today)
        .select(
          db.raw('COUNT(*) as total_answers'),
          db.raw('COUNT(DISTINCT user_id) as unique_users'),
          db.raw('SUM(CASE WHEN answer_type = ? THEN 1 ELSE 0 END) as video_answers', ['video'])
        )
        .first(),
      
      db('answers')
        .where('created_at', '>', oneHourAgo)
        .count('id as count')
        .first()
    ]);

    return {
      activeUsersLastHour: parseInt(activeUsers?.count || 0),
      answersToday: parseInt(todayStats?.total_answers || 0),
      uniqueUsersToday: parseInt(todayStats?.unique_users || 0),
      videoAnswersToday: parseInt(todayStats?.video_answers || 0),
      answersLastHour: parseInt(recentAnswers?.count || 0)
    };
  },

  // Content Moderation
  async getPendingReports(db, filters = {}, pagination = { page: 1, limit: 50 }) {
    const { page, limit } = pagination;
    const offset = (page - 1) * limit;

    let query = db('moderation_reports')
      .leftJoin('users as reporter', 'moderation_reports.reporter_user_id', 'reporter.id')
      .leftJoin('answers', function joinAnswers() {
        this.on('moderation_reports.entity_type', '=', db.raw('?', ['answer']))
          .andOn('moderation_reports.entity_id', '=', 'answers.id');
      })
      .leftJoin('users as answer_owner', 'answers.user_id', 'answer_owner.id')
      .leftJoin('users as reported_user', function joinUsers() {
        this.on('moderation_reports.entity_type', '=', db.raw('?', ['user']))
          .andOn('moderation_reports.entity_id', '=', 'reported_user.id');
      })
      .leftJoin('questions', 'answers.question_id', 'questions.id')
      .where('moderation_reports.status', filters.status || 'pending')
      .select(
        'moderation_reports.*',
        'reporter.username as reporter_username',
        'answers.answer_type',
        'answers.text_content',
        'answers.video_url',
        'answers.is_hidden',
        'answer_owner.username as answer_username',
        'reported_user.username as reported_username',
        'questions.text as question_text'
      )
      .orderBy('moderation_reports.created_at', 'asc')
      .limit(limit)
      .offset(offset);

    if (filters.reason) {
      query = query.where('moderation_reports.reason', filters.reason);
    }

    const reports = (await query).map((row) => ({
      ...row,
      metadata: parseJsonMaybe(row.metadata, null),
    }));
    const total = await db('moderation_reports')
      .where('status', filters.status || 'pending')
      .count('id as count')
      .first();

    return {
      reports,
      pagination: {
        page,
        limit,
        total: parseInt(total.count),
        totalPages: Math.ceil(total.count / limit)
      }
    };
  },

  async reviewReport(db, reportId, { action, reviewedBy, notes }) {
    const report = await db('moderation_reports').where('id', reportId).first();
    if (!report) {
      throw new Error('report_not_found');
    }

    const finalStatus = ['none', 'dismiss_report', 'dismissed'].includes(String(action || ''))
      ? 'dismissed'
      : 'resolved';

    await db('moderation_reports')
      .where('id', reportId)
      .update({
        status: finalStatus,
        reviewed_by_user_id: reviewedBy,
        reviewed_at: new Date().toISOString(),
      });

    if (report.entity_type === 'answer' && report.entity_id) {
      if (action === 'hide_answer') {
        await db('answers').where({ id: report.entity_id }).update({ is_hidden: true });
      }

      if (action === 'soft_delete_answer' || action === 'content_removed') {
        await softDeleteAnswer(db, report.entity_id, reviewedBy, 'moderation_soft_delete');
      }

      if (action === 'restore_answer') {
        await restoreAnswer(db, report.entity_id);
      }
    }

    if (report.entity_type === 'user' && report.entity_id) {
      if (action === 'block_user' || action === 'user_banned') {
        await setUserBlocked(db, report.entity_id, true, 'moderation_block');
      }

      if (action === 'unblock_user') {
        await setUserBlocked(db, report.entity_id, false, null);
      }

      if (action === 'soft_delete_user') {
        await softDeleteUser(db, report.entity_id, reviewedBy, 'moderation_soft_delete');
      }

      if (action === 'restore_user') {
        await restoreUser(db, report.entity_id);
      }
    }

    await db('moderation_actions').insert({
      report_id: reportId,
      admin_user_id: reviewedBy,
      action: action || finalStatus,
      metadata: JSON.stringify({
        notes: notes || null,
      }),
    });

    return { success: true };
  },

  async getPaywallStats(db, dateRange = {}) {
    const startDate = dateRange.startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const endDate = dateRange.endDate || new Date();
    const rows = await db.raw(`
      SELECT
        DATE(created_at) as date,
        event_type,
        COUNT(*) as count,
        COUNT(DISTINCT user_id) as unique_users
      FROM paywall_events
      WHERE created_at BETWEEN ? AND ?
      GROUP BY DATE(created_at), event_type
      ORDER BY date DESC
    `, [startDate, endDate]);

    return rows.rows || rows;
  },

  // Support Tickets
  async getSupportTickets(db, filters = {}, pagination = { page: 1, limit: 50 }) {
    const { page, limit } = pagination;
    const offset = (page - 1) * limit;

    let query = db('support_tickets')
      .orderBy('created_at', 'desc')
      .limit(limit)
      .offset(offset);

    if (filters.status) {
      query = query.where('status', filters.status);
    }
    if (filters.category) {
      query = query.where('category', filters.category);
    }
    if (filters.priority) {
      query = query.where('priority', filters.priority);
    }

    const tickets = await query;
    
    const countQuery = db('support_tickets');
    if (filters.status) countQuery.where('status', filters.status);
    const total = await countQuery.count('id as count').first();

    return {
      tickets,
      pagination: {
        page,
        limit,
        total: parseInt(total.count),
        totalPages: Math.ceil(total.count / limit)
      }
    };
  },

  async updateTicket(db, ticketId, updates, adminId) {
    await db('support_tickets')
      .where('id', ticketId)
      .update({
        ...updates,
        assigned_to: updates.assignedTo || adminId,
        updated_at: new Date()
      });

    return { success: true };
  },

  // Refund Management
  async getRefundRequests(db, filters = {}, pagination = { page: 1, limit: 50 }) {
    const { page, limit } = pagination;
    const offset = (page - 1) * limit;

    let query = db('refund_requests')
      .join('users', 'refund_requests.user_id', 'users.id')
      .select(
        'refund_requests.*',
        'users.username',
        'users.email'
      )
      .orderBy('created_at', 'desc')
      .limit(limit)
      .offset(offset);

    if (filters.status) {
      query = query.where('refund_requests.status', filters.status);
    }

    const requests = await query;
    const total = await db('refund_requests')
      .where(filters.status ? { status: filters.status } : {})
      .count('id as count')
      .first();

    return {
      requests,
      pagination: {
        page,
        limit,
        total: parseInt(total.count),
        totalPages: Math.ceil(total.count / limit)
      }
    };
  },

  async processRefund(db, refundId, { decision, adminId, notes }) {
    const request = await db('refund_requests')
      .where('id', refundId)
      .first();

    if (!request) {
      throw new Error('refund_request_not_found');
    }

    if (!['approved', 'denied'].includes(String(decision || ''))) {
      throw new Error('invalid_refund_decision');
    }

    if (decision === 'denied') {
      await db('refund_requests')
        .where('id', refundId)
        .update({
          status: 'denied',
          reviewed_by: adminId,
          admin_notes: notes,
          processed_at: new Date(),
          updated_at: new Date()
        });

      return { success: true, status: 'denied' };
    }

    if (!hasStripeSecret()) {
      throw new Error('stripe_refunds_not_configured');
    }

    const reference = await resolveRefundReference(db, request);
    if (!reference?.paymentIntentId && !reference?.chargeId) {
      throw new Error('refund_payment_reference_missing');
    }

    const stripeRefund = await createRefund({
      paymentIntentId: reference.paymentIntentId,
      chargeId: reference.chargeId,
      amount: request.amount,
      currency: request.currency,
      metadata: {
        refund_request_id: refundId,
        user_id: request.user_id,
        admin_id: adminId,
      },
    });

    await db('payment_events')
      .insert({
        provider: 'stripe',
        provider_event_id: stripeRefund.id,
        event_type: 'refund.created',
        payload: JSON.stringify(stripeRefund),
        processed_at: new Date(),
      })
      .onConflict('provider_event_id')
      .ignore();

    const mergedNotes = [
      notes || null,
      `stripe_refund_id=${stripeRefund.id}`,
      reference.paymentIntentId ? `payment_intent=${reference.paymentIntentId}` : null,
      reference.chargeId ? `charge=${reference.chargeId}` : null,
    ]
      .filter(Boolean)
      .join('\n');

    await db('refund_requests')
      .where('id', refundId)
      .update({
        status: 'processed',
        reviewed_by: adminId,
        admin_notes: mergedNotes,
        processed_at: new Date(),
        updated_at: new Date()
      });

    return { success: true, status: 'processed', stripeRefundId: stripeRefund.id };
  },

  // Feature Flags
  async getFeatureFlags(db) {
    const rows = await db('feature_flags')
      .orderBy('created_at', 'desc');

    return rows.map((row) => ({
      ...row,
      target_countries: parseJsonMaybe(row.target_countries, []),
      target_user_segments: parseJsonMaybe(row.target_user_segments, []),
    }));
  },

  async createFeatureFlag(db, { key, description, status, rolloutPercentage, targetCountries, targetUserSegments, createdBy }) {
    const [id] = await db('feature_flags').insert({
      feature_key: key,
      description,
      status,
      rollout_percentage: rolloutPercentage,
      target_countries: JSON.stringify(targetCountries || []),
      target_user_segments: JSON.stringify(targetUserSegments || []),
      created_by: createdBy,
      created_at: new Date(),
      updated_at: new Date()
    }).returning('id');

    return { id, success: true };
  },

  async updateFeatureFlag(db, flagId, updates, adminId) {
    const updateData = {
      ...updates,
      updated_at: new Date()
    };

    if (updates.status === 'enabled') {
      updateData.enabled_at = new Date();
    }
    if (updates.status === 'disabled') {
      updateData.disabled_at = new Date();
    }

    await db('feature_flags')
      .where('id', flagId)
      .update(updateData);

    // Log action
    await db('admin_activity_log').insert({
      admin_id: adminId,
      action_type: 'feature_toggle',
      description: `Updated feature flag ${flagId}`,
      metadata: { flag_id: flagId, updates }
    });

    return { success: true };
  },

  // Country Rules
  async getCountryRules(db) {
    const rows = await db('country_content_rules')
      .orderBy('country_code');

    return rows.map((row) => ({
      ...row,
      blocked_keywords: parseJsonMaybe(row.blocked_keywords, []),
      allowed_content_types: parseJsonMaybe(row.allowed_content_types, ['video', 'audio', 'text']),
      custom_settings: parseJsonMaybe(row.custom_settings, {}),
    }));
  },

  async updateCountryRule(db, countryCode, rules, adminId) {
    const exists = await db('country_content_rules')
      .where('country_code', countryCode)
      .first();

    const data = {
      ...rules,
      blocked_keywords: JSON.stringify(rules.blockedKeywords || []),
      allowed_content_types: JSON.stringify(rules.allowedContentTypes || ['video', 'audio', 'text']),
      custom_settings: JSON.stringify(rules.customSettings || {}),
      updated_at: new Date()
    };

    if (exists) {
      await db('country_content_rules')
        .where('country_code', countryCode)
        .update(data);
    } else {
      await db('country_content_rules').insert({
        country_code: countryCode,
        ...data,
        created_at: new Date()
      });
    }

    return { success: true };
  }
};

module.exports = { adminService };
