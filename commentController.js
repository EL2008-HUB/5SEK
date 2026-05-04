/**
 * Comment Controller — CRUD for answer comments
 *
 * POST /api/comments         — Create comment
 * GET  /api/comments/:answerId — List comments for answer
 * DELETE /api/comments/:id    — Soft-delete own comment
 */

const { recordLoopAction, LOOP_ACTIONS, persistLoopState } = require('../services/fusionLoopService');

const MAX_COMMENT_LENGTH = 500;
const MAX_COMMENTS_PER_ANSWER = 100;

/**
 * POST /api/comments
 * Body: { answer_id, text, parent_id? }
 */
exports.createComment = async (req, res) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ error: 'auth_required' });
    }

    const { answer_id, text, parent_id } = req.body;

    if (!answer_id || !text || !text.trim()) {
      return res.status(400).json({ error: 'answer_id and text are required' });
    }

    const cleanText = text.trim();
    if (cleanText.length > MAX_COMMENT_LENGTH) {
      return res.status(400).json({
        error: 'comment_too_long',
        max_length: MAX_COMMENT_LENGTH,
      });
    }

    // Verify answer exists
    const answer = await req.db('answers').where('id', answer_id).first();
    if (!answer) {
      return res.status(404).json({ error: 'answer_not_found' });
    }

    // Check comment limit per answer
    const commentCount = await req.db('comments')
      .where('answer_id', answer_id)
      .where('is_deleted', false)
      .count('id as count')
      .first();

    if (commentCount && commentCount.count >= MAX_COMMENTS_PER_ANSWER) {
      return res.status(429).json({ error: 'too_many_comments' });
    }

    // If replying, verify parent exists
    if (parent_id) {
      const parent = await req.db('comments')
        .where('id', parent_id)
        .where('is_deleted', false)
        .first();
      if (!parent) {
        return res.status(404).json({ error: 'parent_comment_not_found' });
      }
    }

    // Insert comment
    const [comment] = await req.db('comments')
      .insert({
        answer_id,
        user_id: userId,
        text: cleanText,
        parent_id: parent_id || null,
      })
      .returning('*');

    // Get the inserted comment with fallback
    const insertedComment = comment || await req.db('comments')
      .where('answer_id', answer_id)
      .where('user_id', userId)
      .where('text', cleanText)
      .orderBy('id', 'desc')
      .first();

    // 🔥 Record fusion loop action
    let fusionResult = null;
    try {
      fusionResult = recordLoopAction(userId, LOOP_ACTIONS.COMMENT);
      persistLoopState(req.db, userId).catch(() => {});
    } catch (_) {}

    // Get user info
    let user = null;
    try {
      user = await req.db('users')
        .where('id', userId)
        .select('id', 'username', 'display_name')
        .first();
    } catch (_) {}

    res.status(201).json({
      comment: {
        id: insertedComment?.id || null,
        answer_id,
        user_id: userId,
        text: cleanText,
        parent_id: parent_id || null,
        likes: 0,
        created_at: insertedComment?.created_at || new Date().toISOString(),
        user: user ? {
          id: user.id,
          username: user.username,
          display_name: user.display_name,
        } : null,
      },
      fusion_loop: fusionResult,
    });
  } catch (error) {
    console.error('Create comment error:', error);
    res.status(500).json({ error: 'Failed to create comment' });
  }
};

/**
 * GET /api/comments/:answerId
 * Query: ?limit=20&offset=0
 */
exports.getComments = async (req, res) => {
  try {
    const { answerId } = req.params;
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);
    const offset = parseInt(req.query.offset) || 0;

    const comments = await req.db('comments')
      .where('comments.answer_id', answerId)
      .where('comments.is_deleted', false)
      .leftJoin('users', 'comments.user_id', 'users.id')
      .select(
        'comments.id',
        'comments.answer_id',
        'comments.user_id',
        'comments.text',
        'comments.parent_id',
        'comments.likes',
        'comments.created_at',
        'users.username',
        'users.display_name'
      )
      .orderBy('comments.created_at', 'asc')
      .limit(limit)
      .offset(offset);

    const total = await req.db('comments')
      .where('answer_id', answerId)
      .where('is_deleted', false)
      .count('id as count')
      .first();

    res.json({
      comments: comments.map((c) => ({
        id: c.id,
        answer_id: c.answer_id,
        user_id: c.user_id,
        text: c.text,
        parent_id: c.parent_id,
        likes: c.likes,
        created_at: c.created_at,
        user: {
          id: c.user_id,
          username: c.username,
          display_name: c.display_name,
        },
      })),
      total: total?.count || 0,
      has_more: offset + limit < (total?.count || 0),
    });
  } catch (error) {
    console.error('Get comments error:', error);
    res.status(500).json({ error: 'Failed to get comments' });
  }
};

/**
 * DELETE /api/comments/:id
 */
exports.deleteComment = async (req, res) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ error: 'auth_required' });
    }

    const { id } = req.params;

    const comment = await req.db('comments')
      .where('id', id)
      .where('is_deleted', false)
      .first();

    if (!comment) {
      return res.status(404).json({ error: 'comment_not_found' });
    }

    if (comment.user_id !== userId) {
      return res.status(403).json({ error: 'not_your_comment' });
    }

    await req.db('comments').where('id', id).update({ is_deleted: true });

    res.json({ success: true });
  } catch (error) {
    console.error('Delete comment error:', error);
    res.status(500).json({ error: 'Failed to delete comment' });
  }
};
