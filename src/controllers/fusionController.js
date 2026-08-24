/**
 * Fusion Controller — API endpoints for the Fusion Loop System
 *
 * Endpoints:
 *   GET  /api/fusion/status    — Full loop status (score, streak, prompts)
 *   POST /api/fusion/action    — Record a loop action (answer/remix/comment/drop)
 *   GET  /api/fusion/prompt    — Get the next floating prompt
 *   GET  /api/fusion/exit-hook — Get exit hook data
 *   GET  /api/fusion/feed-config — Get feed adaptation config
 */

const {
  recordLoopAction,
  getFullStatus,
  getExitHook,
  getFeedAdaptation,
  getTimePressure,
  loadLoopState,
  persistLoopState,
  getLoopState,
  getNextPrompt,
  LOOP_ACTIONS,
} = require('../services/fusionLoopService');

/**
 * GET /api/fusion/status
 * Returns the complete fusion loop status for the authenticated user.
 */
exports.getStatus = async (req, res) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ error: 'auth_required' });
    }

    // Try loading from DB if not in cache
    const cached = getLoopState(userId);
    if (!cached.lastActiveDate) {
      await loadLoopState(req.db, userId);
    }

    const status = getFullStatus(userId);
    res.json(status);
  } catch (error) {
    console.error('Fusion status error:', error);
    res.status(500).json({ error: 'Failed to get fusion status' });
  }
};

/**
 * POST /api/fusion/action
 * Record a loop action and return the result.
 *
 * Body: { action: 'answer' | 'remix' | 'comment' | 'drop' }
 */
exports.recordAction = async (req, res) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ error: 'auth_required' });
    }

    const { action } = req.body;
    const validActions = Object.values(LOOP_ACTIONS);

    if (!action || !validActions.includes(action)) {
      return res.status(400).json({
        error: 'invalid_action',
        valid_actions: validActions,
      });
    }

    // Ensure state is loaded
    const cached = getLoopState(userId);
    if (!cached.lastActiveDate) {
      await loadLoopState(req.db, userId);
    }

    const result = recordLoopAction(userId, action);

    // Persist async (fire-and-forget)
    persistLoopState(req.db, userId).catch(() => {});

    res.json(result);
  } catch (error) {
    console.error('Fusion action error:', error);
    res.status(500).json({ error: 'Failed to record action' });
  }
};

/**
 * GET /api/fusion/prompt
 * Returns the next floating prompt for the user.
 */
exports.getPrompt = async (req, res) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.json({
        type: 'answer',
        text: '👀 What would YOU say?',
        cta: 'Answer now',
        urgency: 'high',
      });
    }

    // Load state if needed
    const cached = getLoopState(userId);
    if (!cached.lastActiveDate) {
      await loadLoopState(req.db, userId);
    }

    const prompt = getNextPrompt(userId);

    // Add time pressure
    const timePressure = getTimePressure(prompt.type === 'drop' ? 'drop' : 'answer');

    res.json({
      ...prompt,
      timePressure,
    });
  } catch (error) {
    console.error('Fusion prompt error:', error);
    res.status(500).json({ error: 'Failed to get prompt' });
  }
};

/**
 * GET /api/fusion/exit-hook
 * Returns exit hook data (streak warning, next drop, loop progress).
 */
exports.getExitHook = async (req, res) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.json({
        nextDropMessage: '⏳ Next drop in 2h',
      });
    }

    const hook = getExitHook(userId);
    res.json(hook);
  } catch (error) {
    console.error('Fusion exit hook error:', error);
    res.status(500).json({ error: 'Failed to get exit hook' });
  }
};

/**
 * GET /api/fusion/feed-config
 * Returns feed adaptation config based on user's missing loop actions.
 */
exports.getFeedConfig = async (req, res) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.json({
        injectHighRemixContent: false,
        injectControversialContent: false,
        injectEasyQuestions: true,
        loopScore: 0,
        missingActions: ['answer', 'remix', 'comment', 'drop'],
      });
    }

    const config = getFeedAdaptation(userId);
    res.json(config);
  } catch (error) {
    console.error('Fusion feed config error:', error);
    res.status(500).json({ error: 'Failed to get feed config' });
  }
};
