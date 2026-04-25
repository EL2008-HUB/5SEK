/**
 * KPI Service - Production analytics tracking
 */

const kpiService = {
  // Track user retention
  async trackRetention(db, userId, event) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Get user's first session
    const user = await db('users')
      .where('id', userId)
      .select('created_at', 'first_session_at')
      .first();

    if (!user) return;

    const firstSeen = new Date(user.first_session_at || user.created_at);
    firstSeen.setHours(0, 0, 0, 0);

    const daysDiff = Math.floor((today - firstSeen) / (1000 * 60 * 60 * 24));

    // Determine retention type
    let retentionType = null;
    if (daysDiff === 1) retentionType = 'd1';
    else if (daysDiff === 7) retentionType = 'd7';
    else if (daysDiff === 30) retentionType = 'd30';
    else if (daysDiff === 90) retentionType = 'd90';

    if (!retentionType) return;

    // Check if already recorded
    const existing = await db('user_retention')
      .where({ user_id: userId, retention_type: retentionType })
      .first();

    if (!existing) {
      await db('user_retention').insert({
        user_id: userId,
        first_seen_date: firstSeen,
        retention_date: today,
        retention_type: retentionType,
        returned: true,
        created_at: new Date()
      });
    }
  },

  // Track session start
  async startSession(db, userId, sessionId, country) {
    const existing = await db('session_analytics')
      .where('session_id', sessionId)
      .first();

    if (existing) {
      return existing;
    }

    await db('session_analytics').insert({
      user_id: userId,
      session_id: sessionId,
      started_at: new Date(),
      country: country || 'GLOBAL',
      screens_viewed: 0,
      answers_created: 0,
      feed_items_viewed: 0,
      duels_participated: 0,
      created_at: new Date()
    });

    return db('session_analytics')
      .where('session_id', sessionId)
      .first();
  },

  // Track session end
  async endSession(db, sessionId, metadata = {}) {
    const session = await db('session_analytics')
      .where('session_id', sessionId)
      .first();

    if (!session) return;

    const endedAt = new Date();
    const startedAt = new Date(session.started_at);
    const durationSeconds = Math.floor((endedAt - startedAt) / 1000);

    await db('session_analytics')
      .where('session_id', sessionId)
      .update({
        ended_at: endedAt,
        duration_seconds: durationSeconds,
        screens_viewed: metadata.screensViewed || session.screens_viewed,
        answers_created: metadata.answersCreated || session.answers_created,
        feed_items_viewed: metadata.feedItemsViewed || session.feed_items_viewed,
        duels_participated: metadata.duelsParticipated || session.duels_participated,
        features_used: JSON.stringify(metadata.featuresUsed || []),
        updated_at: new Date()
      });

    // Track retention if this is a return visit
    if (session.user_id) {
      await this.trackRetention(db, session.user_id, 'session_end');
    }
  },

  // Update session metrics
  async updateSessionMetrics(db, sessionId, updates) {
    const session = await db('session_analytics')
      .where('session_id', sessionId)
      .first();

    if (!session) return;

    const updateData = {};
    if (updates.screensViewed) {
      updateData.screens_viewed = session.screens_viewed + updates.screensViewed;
    }
    if (updates.feedItemsViewed) {
      updateData.feed_items_viewed = session.feed_items_viewed + updates.feedItemsViewed;
    }
    if (updates.duelsParticipated) {
      updateData.duels_participated = session.duels_participated + updates.duelsParticipated;
    }
    if (updates.answersCreated) {
      updateData.answers_created = session.answers_created + updates.answersCreated;
    }

    if (Object.keys(updateData).length > 0) {
      await db('session_analytics')
        .where('session_id', sessionId)
        .update(updateData);
    }
  },

  // Track answer funnel stage
  async trackAnswerFunnel(db, userId, questionId, stage, metadata = {}) {
    await db('answer_funnel').insert({
      user_id: userId,
      question_id: questionId,
      session_id: metadata.sessionId,
      stage,
      reached_at: new Date(),
      time_in_stage_seconds: metadata.timeInStage,
      abandoned_reason: metadata.abandonedReason,
      created_at: new Date()
    });
  },

  // Track paywall event
  async trackPaywallEvent(db, userId, eventType, context, metadata = {}) {
    await db('paywall_analytics').insert({
      user_id: userId,
      event_type: eventType,
      trigger_context: context,
      event_at: new Date(),
      metadata: JSON.stringify(metadata),
      created_at: new Date()
    });
  },

  // Track content view (for watch time)
  async trackContentView(db, userId, contentType, contentId, durationSeconds, completionPercentage) {
    // This would typically go to a time-series database or analytics pipeline
    // For now, we'll store in the database
    await db('content_views').insert({
      user_id: userId,
      content_type: contentType,
      content_id: contentId,
      duration_seconds: durationSeconds,
      completion_percentage: completionPercentage,
      viewed_at: new Date()
    });
  },

  // Get D1 retention for cohort
  async getD1Retention(db, date) {
    const result = await db.raw(`
      SELECT 
        COUNT(DISTINCT user_id) as total_users,
        SUM(CASE WHEN returned THEN 1 ELSE 0 END) as retained_users,
        ROUND(
          SUM(CASE WHEN returned THEN 1 ELSE 0 END) * 100.0 / 
          NULLIF(COUNT(DISTINCT user_id), 0),
          2
        ) as retention_rate
      FROM user_retention
      WHERE first_seen_date = ?
        AND retention_type = 'd1'
    `, [date]);

    return result.rows?.[0] || result[0];
  },

  // Get answer completion rate
  async getAnswerCompletionRate(db, dateRange) {
    const result = await db.raw(`
      WITH funnel AS (
        SELECT 
          user_id,
          question_id,
          MAX(CASE WHEN stage = 'started' THEN 1 ELSE 0 END) as started,
          MAX(CASE WHEN stage = 'published' THEN 1 ELSE 0 END) as published
        FROM answer_funnel
        WHERE reached_at BETWEEN ? AND ?
        GROUP BY user_id, question_id
      )
      SELECT 
        COUNT(*) as total_started,
        SUM(published) as total_published,
        ROUND(SUM(published) * 100.0 / NULLIF(COUNT(*), 0), 2) as completion_rate
      FROM funnel
    `, [dateRange.start, dateRange.end]);

    return result.rows?.[0] || result[0];
  },

  // Get average session length
  async getAverageSessionLength(db, dateRange) {
    const result = await db('session_analytics')
      .whereBetween('started_at', [dateRange.start, dateRange.end])
      .whereNotNull('duration_seconds')
      .avg('duration_seconds as avg_duration')
      .first();

    return {
      avgDurationSeconds: Math.round(result?.avg_duration || 0),
      avgDurationMinutes: Math.round((result?.avg_duration || 0) / 60 * 100) / 100
    };
  },

  // Get duel participation rate
  async getDuelParticipationRate(db, dateRange) {
    const result = await db('session_analytics')
      .whereBetween('started_at', [dateRange.start, dateRange.end])
      .select(
        db.raw('COUNT(*) as total_sessions'),
        db.raw('SUM(CASE WHEN duels_participated > 0 THEN 1 ELSE 0 END) as sessions_with_duels'),
        db.raw('ROUND(SUM(CASE WHEN duels_participated > 0 THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 2) as participation_rate')
      )
      .first();

    return result;
  },

  // Get paywall conversion
  async getPaywallConversion(db, dateRange) {
    const result = await db.raw(`
      SELECT 
        COUNT(DISTINCT CASE WHEN event_type = 'shown' THEN user_id END) as users_shown,
        COUNT(DISTINCT CASE WHEN event_type = 'converted' THEN user_id END) as users_converted,
        ROUND(
          COUNT(DISTINCT CASE WHEN event_type = 'converted' THEN user_id END) * 100.0 / 
          NULLIF(COUNT(DISTINCT CASE WHEN event_type = 'shown' THEN user_id END), 0),
          2
        ) as conversion_rate,
        COUNT(CASE WHEN event_type = 'shown' THEN 1 END) as total_shows,
        COUNT(CASE WHEN event_type = 'clicked' THEN 1 END) as total_clicks,
        COUNT(CASE WHEN event_type = 'closed' THEN 1 END) as total_closes,
        COUNT(CASE WHEN event_type = 'converted' THEN 1 END) as total_conversions
      FROM paywall_analytics
      WHERE event_at BETWEEN ? AND ?
    `, [dateRange.start, dateRange.end]);

    return result.rows?.[0] || result[0];
  },

  // Calculate all KPIs
  async calculateAllKPIs(db, dateRange) {
    const [
      retention,
      completionRate,
      sessionLength,
      duelParticipation,
      paywallConversion
    ] = await Promise.all([
      this.getD1Retention(db, dateRange.start),
      this.getAnswerCompletionRate(db, dateRange),
      this.getAverageSessionLength(db, dateRange),
      this.getDuelParticipationRate(db, dateRange),
      this.getPaywallConversion(db, dateRange)
    ]);

    return {
      d1Retention: {
        percentage: parseFloat(retention?.retention_rate || 0),
        target: 40,
        status: parseFloat(retention?.retention_rate || 0) >= 40 ? 'good' : 'warning'
      },
      answerCompletionRate: {
        percentage: parseFloat(completionRate?.completion_rate || 0),
        target: 60,
        status: parseFloat(completionRate?.completion_rate || 0) >= 60 ? 'good' : 'warning'
      },
      avgSessionLength: {
        minutes: sessionLength.avgDurationMinutes,
        target: 3,
        status: sessionLength.avgDurationMinutes >= 3 ? 'good' : 'warning'
      },
      duelParticipation: {
        percentage: parseFloat(duelParticipation?.participation_rate || 0),
        target: 30,
        status: parseFloat(duelParticipation?.participation_rate || 0) >= 30 ? 'good' : 'warning'
      },
      paywallConversion: {
        percentage: parseFloat(paywallConversion?.conversion_rate || 0),
        target: 5,
        status: parseFloat(paywallConversion?.conversion_rate || 0) >= 5 ? 'good' : 'warning'
      },
      raw: {
        retention,
        completionRate,
        sessionLength,
        duelParticipation,
        paywallConversion
      }
    };
  }
};

module.exports = { kpiService };
