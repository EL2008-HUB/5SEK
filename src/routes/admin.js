/**
 * Admin Routes - Protected admin endpoints
 */

const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../controllers/authController');
const { adminService } = require('../services/adminService');

function parseJsonArray(value) {
  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  }

  return [];
}

router.use(authMiddleware);

// Middleware to check admin access
function requireAdmin(permissions = []) {
  return async (req, res, next) => {
    if (!req.userId) {
      return res.status(401).json({ error: 'unauthorized' });
    }

    const user = await req.db('users')
      .where('id', req.userId)
      .select('role', 'is_admin', 'admin_permissions')
      .first();

    if (!user || !user.is_admin) {
      return res.status(403).json({ error: 'forbidden' });
    }

    if (user.role !== 'super_admin' && permissions.length > 0) {
      const userPerms = parseJsonArray(user.admin_permissions);
      const hasPermission = permissions.some(p => userPerms.includes(p));
      if (!hasPermission) {
        return res.status(403).json({ error: 'insufficient_permissions' });
      }
    }

    req.adminUser = user;
    next();
  };
}

// Dashboard & Stats
router.get('/dashboard', requireAdmin(), async (req, res) => {
  try {
    const [realtimeStats, kpis] = await Promise.all([
      adminService.getRealtimeStats(req.db),
      adminService.getKPIs(req.db)
    ]);

    res.json({
      realtime: realtimeStats,
      kpis,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Admin dashboard error:', error);
    res.status(500).json({ error: 'failed_to_load_dashboard' });
  }
});

router.get('/stats/realtime', requireAdmin(), async (req, res) => {
  try {
    const stats = await adminService.getRealtimeStats(req.db);
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: 'failed_to_get_stats' });
  }
});

router.get('/stats/kpis', requireAdmin(['analytics']), async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const kpis = await adminService.getKPIs(req.db, { startDate, endDate });
    res.json(kpis);
  } catch (error) {
    res.status(500).json({ error: 'failed_to_get_kpis' });
  }
});

// User Management
router.get('/users', requireAdmin(['users']), async (req, res) => {
  try {
    const { page = 1, limit = 50, role, country, search, isPremium } = req.query;
    
    const result = await adminService.getUsers(req.db, 
      { role, country, search, isPremium: isPremium !== undefined ? isPremium === 'true' : undefined },
      { page: parseInt(page), limit: parseInt(limit) }
    );
    
    res.json(result);
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ error: 'failed_to_get_users' });
  }
});

router.get('/users/:id', requireAdmin(['users']), async (req, res) => {
  try {
    const user = await adminService.getUserDetails(req.db, req.params.id);
    if (!user) {
      return res.status(404).json({ error: 'user_not_found' });
    }
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: 'failed_to_get_user' });
  }
});

router.patch('/users/:id/role', requireAdmin(), async (req, res) => {
  try {
    const { role, adminPermissions } = req.body;
    
    // Only super_admin can create other admins
    if ((role === 'admin' || role === 'super_admin') && req.adminUser.role !== 'super_admin') {
      return res.status(403).json({ error: 'only_super_admin_can_assign_admin_roles' });
    }

    await adminService.updateUserRole(req.db, req.params.id, {
      role,
      adminPermissions,
      adminId: req.userId
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Update role error:', error);
    res.status(500).json({ error: 'failed_to_update_role' });
  }
});

// Daily Questions Management
router.get('/daily-questions', requireAdmin(['content']), async (req, res) => {
  try {
    const { status, country, fromDate, toDate } = req.query;
    const questions = await adminService.getScheduledQuestions(req.db, {
      status, country, fromDate, toDate
    });
    res.json({ questions });
  } catch (error) {
    res.status(500).json({ error: 'failed_to_get_questions' });
  }
});

router.post('/daily-questions', requireAdmin(['content']), async (req, res) => {
  try {
    const { questionId, scheduledFor, country, priority } = req.body;
    
    const result = await adminService.scheduleDailyQuestion(req.db, {
      questionId,
      scheduledFor,
      country,
      priority,
      adminId: req.userId
    });

    res.json(result);
  } catch (error) {
    console.error('Schedule question error:', error);
    res.status(400).json({ error: error.message || 'failed_to_schedule' });
  }
});

router.patch('/daily-questions/:id', requireAdmin(['content']), async (req, res) => {
  try {
    await adminService.updateScheduledQuestion(req.db, req.params.id, req.body, req.userId);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'failed_to_update' });
  }
});

// Hot/Trending Questions
router.get('/trending', requireAdmin(['analytics']), async (req, res) => {
  try {
    const { country, limit } = req.query;
    const trending = await adminService.getTrendingQuestions(req.db, { 
      country: country || 'GLOBAL', 
      limit: parseInt(limit) || 20 
    });
    res.json({ trending });
  } catch (error) {
    res.status(500).json({ error: 'failed_to_get_trending' });
  }
});

router.post('/trending/recalculate', requireAdmin(['analytics']), async (req, res) => {
  try {
    const { country } = req.body;
    const result = await adminService.calculateTrendingQuestions(req.db, country || 'GLOBAL');
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'failed_to_recalculate' });
  }
});

// Paywall Stats
router.get('/paywall/stats', requireAdmin(['analytics']), async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    const stats = await adminService.getPaywallStats(req.db, { startDate, endDate });
    res.json({ stats });
  } catch (error) {
    res.status(500).json({ error: 'failed_to_get_stats' });
  }
});

// Content Moderation
router.get('/reports', requireAdmin(['moderate']), async (req, res) => {
  try {
    const { status = 'pending', reason, page = 1, limit = 50 } = req.query;
    
    const result = await adminService.getPendingReports(req.db, 
      { status, reason },
      { page: parseInt(page), limit: parseInt(limit) }
    );
    
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'failed_to_get_reports' });
  }
});

router.post('/reports/:id/review', requireAdmin(['moderate']), async (req, res) => {
  try {
    const { action, notes } = req.body;
    
    await adminService.reviewReport(req.db, req.params.id, {
      action,
      reviewedBy: req.userId,
      notes
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Review report error:', error);
    res.status(500).json({ error: 'failed_to_review' });
  }
});

// Support Tickets
router.get('/tickets', requireAdmin(), async (req, res) => {
  try {
    const { status, category, priority, page = 1, limit = 50 } = req.query;
    
    const result = await adminService.getSupportTickets(req.db,
      { status, category, priority },
      { page: parseInt(page), limit: parseInt(limit) }
    );
    
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'failed_to_get_tickets' });
  }
});

router.patch('/tickets/:id', requireAdmin(), async (req, res) => {
  try {
    await adminService.updateTicket(req.db, req.params.id, req.body, req.userId);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'failed_to_update_ticket' });
  }
});

// Refund Management
router.get('/refunds', requireAdmin(), async (req, res) => {
  try {
    const { status, page = 1, limit = 50 } = req.query;
    
    const result = await adminService.getRefundRequests(req.db,
      { status },
      { page: parseInt(page), limit: parseInt(limit) }
    );
    
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'failed_to_get_refunds' });
  }
});

router.post('/refunds/:id/process', requireAdmin(), async (req, res) => {
  try {
    const { decision, notes } = req.body;
    
    await adminService.processRefund(req.db, req.params.id, {
      decision,
      adminId: req.userId,
      notes
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Process refund error:', error);
    if (error.message === 'refund_request_not_found') {
      return res.status(404).json({ error: 'refund_request_not_found' });
    }
    if (error.message === 'invalid_refund_decision' || error.message === 'refund_payment_reference_missing') {
      return res.status(400).json({ error: error.message });
    }
    if (error.message === 'stripe_refunds_not_configured') {
      return res.status(503).json({ error: 'stripe_refunds_not_configured' });
    }
    res.status(500).json({ error: 'failed_to_process' });
  }
});

// Feature Flags
router.get('/feature-flags', requireAdmin(), async (req, res) => {
  try {
    const flags = await adminService.getFeatureFlags(req.db);
    res.json({ flags });
  } catch (error) {
    res.status(500).json({ error: 'failed_to_get_flags' });
  }
});

router.post('/feature-flags', requireAdmin(), async (req, res) => {
  try {
    const { key, description, status, rolloutPercentage, targetCountries, targetUserSegments } = req.body;
    
    const result = await adminService.createFeatureFlag(req.db, {
      key,
      description,
      status,
      rolloutPercentage,
      targetCountries,
      targetUserSegments,
      createdBy: req.userId
    });

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'failed_to_create_flag' });
  }
});

router.patch('/feature-flags/:id', requireAdmin(), async (req, res) => {
  try {
    await adminService.updateFeatureFlag(req.db, req.params.id, req.body, req.userId);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'failed_to_update_flag' });
  }
});

// Country Rules
router.get('/country-rules', requireAdmin(), async (req, res) => {
  try {
    const rules = await adminService.getCountryRules(req.db);
    res.json({ rules });
  } catch (error) {
    res.status(500).json({ error: 'failed_to_get_rules' });
  }
});

router.put('/country-rules/:countryCode', requireAdmin(), async (req, res) => {
  try {
    await adminService.updateCountryRule(req.db, req.params.countryCode, req.body, req.userId);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'failed_to_update_rule' });
  }
});

// Admin Activity Log
router.get('/activity-log', requireAdmin(), async (req, res) => {
  try {
    const { adminId, actionType, page = 1, limit = 50 } = req.query;
    
    let query = req.db('admin_activity_log')
      .orderBy('created_at', 'desc')
      .limit(parseInt(limit))
      .offset((parseInt(page) - 1) * parseInt(limit));

    if (adminId) {
      query = query.where('admin_id', adminId);
    }
    if (actionType) {
      query = query.where('action_type', actionType);
    }

    const logs = await query;
    res.json({ logs });
  } catch (error) {
    res.status(500).json({ error: 'failed_to_get_logs' });
  }
});

module.exports = router;
