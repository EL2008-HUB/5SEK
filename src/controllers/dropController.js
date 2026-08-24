/**
 * Drop Controller — Live Question Drops API endpoints
 *
 * GET  /api/drops/active    — Get currently active drop
 * GET  /api/drops/next      — Get next upcoming drop (for countdown)
 * POST /api/drops/:id/join  — Join an active drop
 * POST /api/drops/:id/leave — Leave a drop (optional)
 * POST /api/drops/schedule  — Admin: schedule a new drop
 * GET  /api/drops/:id/stats — Admin: get drop stats
 */

const {
  getActiveDrop,
  getNextDrop,
  joinDrop,
  leaveDrop,
  scheduleDrop,
  getDropStats,
  getDropReplay,
} = require("../services/dropService");

function resolveCountry(req) {
  if (req.query?.country) return req.query.country.toUpperCase();
  if (req.body?.country) return req.body.country.toUpperCase();
  if (req.detectedCountry) return req.detectedCountry;
  return "GLOBAL";
}

/**
 * GET /api/drops/active
 */
exports.getActive = async (req, res) => {
  try {
    const country = resolveCountry(req);
    const activeDrop = await getActiveDrop(req.db, country);

    if (!activeDrop) {
      // Check for next upcoming drop
      const nextDrop = await getNextDrop(req.db, country);

      return res.json({
        has_active_drop: false,
        active_drop: null,
        next_drop: nextDrop,
      });
    }

    res.json({
      has_active_drop: true,
      active_drop: activeDrop,
      next_drop: null,
    });
  } catch (error) {
    console.error("Get active drop error:", error);
    res.status(500).json({ error: "Failed to get active drop" });
  }
};

/**
 * GET /api/drops/next
 */
exports.getNext = async (req, res) => {
  try {
    const country = resolveCountry(req);
    const nextDrop = await getNextDrop(req.db, country);

    if (!nextDrop) {
      return res.json({ has_next: false, next_drop: null });
    }

    res.json({
      has_next: true,
      next_drop: nextDrop,
    });
  } catch (error) {
    console.error("Get next drop error:", error);
    res.status(500).json({ error: "Failed to get next drop" });
  }
};

/**
 * POST /api/drops/:id/join
 */
exports.join = async (req, res) => {
  try {
    const questionId = Number(req.params.id);
    const userId = req.userId;

    if (!questionId || !userId) {
      return res.status(400).json({ error: "Invalid request" });
    }

    const result = await joinDrop(req.db, questionId, userId);

    res.json({
      ...result,
      message: "You're in! Answer now 🔥",
    });
  } catch (error) {
    if (error.code === "drop_not_active") {
      return res.status(400).json({ error: "This drop is not active" });
    }
    console.error("Join drop error:", error);
    res.status(500).json({ error: "Failed to join drop" });
  }
};

/**
 * POST /api/drops/:id/leave
 */
exports.leave = async (req, res) => {
  try {
    const questionId = Number(req.params.id);
    const userId = req.userId;

    if (!questionId || !userId) {
      return res.status(400).json({ error: "Invalid request" });
    }

    await leaveDrop(req.db, questionId, userId);

    res.json({ ok: true });
  } catch (error) {
    console.error("Leave drop error:", error);
    res.status(500).json({ error: "Failed to leave drop" });
  }
};

/**
 * POST /api/drops/schedule — Admin only
 * Body: { question_id, drop_time }
 */
exports.schedule = async (req, res) => {
  try {
    const { question_id, drop_time } = req.body;

    if (!question_id || !drop_time) {
      return res.status(400).json({ error: "question_id and drop_time are required" });
    }

    const dropDate = new Date(drop_time);
    if (isNaN(dropDate.getTime())) {
      return res.status(400).json({ error: "Invalid drop_time format" });
    }

    if (dropDate.getTime() <= Date.now()) {
      return res.status(400).json({ error: "drop_time must be in the future" });
    }

    const result = await scheduleDrop(req.db, question_id, drop_time);

    res.status(201).json({
      scheduled: true,
      question_id: result.id,
      drop_time: result.scheduled_drop_time,
      message: "Drop scheduled successfully ⏱",
    });
  } catch (error) {
    if (error.code === "question_not_found") {
      return res.status(404).json({ error: "Question not found" });
    }
    console.error("Schedule drop error:", error);
    res.status(500).json({ error: "Failed to schedule drop" });
  }
};

/**
 * GET /api/drops/:id/stats — Admin only
 */
exports.getStats = async (req, res) => {
  try {
    const questionId = Number(req.params.id);
    if (!questionId) {
      return res.status(400).json({ error: "Invalid question ID" });
    }

    const stats = await getDropStats(req.db, questionId);

    res.json(stats);
  } catch (error) {
    console.error("Get drop stats error:", error);
    res.status(500).json({ error: "Failed to get drop stats" });
  }
};

/**
 * GET /api/drops/:id/replay — See answers from a completed drop
 * 🔥 UPGRADE 2: "See how others answered" → drives feed loop
 */
exports.getReplay = async (req, res) => {
  try {
    const questionId = Number(req.params.id);
    if (!questionId) {
      return res.status(400).json({ error: "Invalid question ID" });
    }

    const replay = await getDropReplay(req.db, questionId);
    if (!replay) {
      return res.status(404).json({ error: "Drop not found" });
    }

    res.json(replay);
  } catch (error) {
    console.error("Get drop replay error:", error);
    res.status(500).json({ error: "Failed to get drop replay" });
  }
};
