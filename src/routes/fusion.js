/**
 * Fusion Loop Routes
 *
 * GET  /api/fusion/status     — Full loop status
 * POST /api/fusion/action     — Record loop action
 * GET  /api/fusion/prompt     — Next floating prompt
 * GET  /api/fusion/exit-hook  — Exit hook data
 * GET  /api/fusion/feed-config — Feed adaptation config
 */

const router = require('express').Router();
const fusionController = require('../controllers/fusionController');
const { authMiddleware, optionalAuthMiddleware } = require('../controllers/authController');

// Full status requires auth
router.get('/status', authMiddleware, fusionController.getStatus);

// Record action requires auth
router.post('/action', authMiddleware, fusionController.recordAction);

// Prompt works with optional auth (guest gets default prompt)
router.get('/prompt', optionalAuthMiddleware, fusionController.getPrompt);

// Exit hook works with optional auth
router.get('/exit-hook', optionalAuthMiddleware, fusionController.getExitHook);

// Feed config works with optional auth
router.get('/feed-config', optionalAuthMiddleware, fusionController.getFeedConfig);

module.exports = router;
