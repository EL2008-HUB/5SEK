const router = require('express').Router();
const { createComment, getComments, deleteComment } = require('../controllers/commentController');
const { authMiddleware, optionalAuthMiddleware } = require('../controllers/authController');

// POST /api/comments — create (auth required)
router.post('/', authMiddleware, createComment);

// GET /api/comments/:answerId — list (public)
router.get('/:answerId', optionalAuthMiddleware, getComments);

// DELETE /api/comments/:id — soft-delete (auth required)
router.delete('/:id', authMiddleware, deleteComment);

module.exports = router;
