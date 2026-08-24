/**
 * Remix Chain Service
 *
 * Handles remix creation, chain traversal, and remix boost scoring.
 * Max chain depth = 5 to prevent spam chains.
 */

const MAX_CHAIN_DEPTH = 5;

/**
 * Create a remix answer linked to a parent answer.
 *
 * @param {object} db - Knex instance
 * @param {object} opts
 * @param {number} opts.parentAnswerId - The answer being remixed
 * @param {number} opts.userId - The user creating the remix
 * @param {object} opts.answerData - The full answer insert data (video_url, answer_type, etc.)
 * @returns {object} The created remix answer row
 */
async function createRemix(db, { parentAnswerId, userId, answerData }) {
  // 1. Validate parent exists
  const parent = await db("answers")
    .where({ id: parentAnswerId })
    .whereNull("deleted_at")
    .first();

  if (!parent) {
    throw Object.assign(new Error("Parent answer not found"), { code: "parent_not_found" });
  }

  // 2. Prevent self-remix
  if (Number(parent.user_id) === Number(userId)) {
    throw Object.assign(new Error("Cannot remix your own answer"), { code: "self_remix" });
  }

  // 3. Calculate depth (capped at MAX_CHAIN_DEPTH)
  const parentDepth = Number(parent.chain_depth) || 0;
  const depth = Math.min(parentDepth + 1, MAX_CHAIN_DEPTH);

  // 4. Insert remix answer
  const insertData = {
    ...answerData,
    user_id: userId,
    parent_answer_id: parentAnswerId,
    chain_depth: depth,
    is_remix: true,
  };

  const [remix] = await db("answers").insert(insertData).returning("*");

  return remix;
}

/**
 * Get the full remix chain for an answer (root → all descendants in order).
 *
 * @param {object} db - Knex instance
 * @param {number} answerId - Any answer in the chain
 * @returns {object} { root, chain, totalRemixes }
 */
async function getRemixChain(db, answerId) {
  // 1. Find the root by traversing up
  let current = await db("answers")
    .where({ id: answerId })
    .whereNull("deleted_at")
    .select("id", "parent_answer_id", "chain_depth", "user_id", "video_url",
      "answer_type", "text_content", "created_at", "likes", "views")
    .first();

  if (!current) return null;

  // Walk up to root
  const visited = new Set();
  while (current.parent_answer_id && !visited.has(current.id)) {
    visited.add(current.id);
    const parent = await db("answers")
      .where({ id: current.parent_answer_id })
      .whereNull("deleted_at")
      .select("id", "parent_answer_id", "chain_depth", "user_id", "video_url",
        "answer_type", "text_content", "created_at", "likes", "views")
      .first();

    if (!parent) break;
    current = parent;
  }

  const rootId = current.id;

  // 2. Get all answers in this chain (descendants of root)
  const chain = await db("answers")
    .leftJoin("users", "answers.user_id", "users.id")
    .leftJoin("questions", "answers.question_id", "questions.id")
    .where(function () {
      this.where("answers.id", rootId)
        .orWhere("answers.parent_answer_id", rootId);
    })
    .whereNull("answers.deleted_at")
    .select(
      "answers.id",
      "answers.parent_answer_id",
      "answers.chain_depth",
      "answers.user_id",
      "answers.video_url",
      "answers.answer_type",
      "answers.text_content",
      "answers.created_at",
      "answers.likes",
      "answers.views",
      "answers.is_remix",
      "users.username",
      "questions.text as question_text",
      "questions.id as question_id"
    )
    .orderBy("answers.chain_depth", "asc")
    .orderBy("answers.created_at", "asc")
    .limit(50);

  // For deeper chains, recursively collect all descendants
  const allIds = new Set(chain.map((r) => r.id));
  let frontier = chain.filter((r) => r.id !== rootId).map((r) => r.id);

  // BFS to find descendants of depth > 1
  while (frontier.length > 0) {
    const nextLevel = await db("answers")
      .leftJoin("users", "answers.user_id", "users.id")
      .leftJoin("questions", "answers.question_id", "questions.id")
      .whereIn("answers.parent_answer_id", frontier)
      .whereNull("answers.deleted_at")
      .select(
        "answers.id",
        "answers.parent_answer_id",
        "answers.chain_depth",
        "answers.user_id",
        "answers.video_url",
        "answers.answer_type",
        "answers.text_content",
        "answers.created_at",
        "answers.likes",
        "answers.views",
        "answers.is_remix",
        "users.username",
        "questions.text as question_text",
        "questions.id as question_id"
      )
      .orderBy("answers.chain_depth", "asc")
      .orderBy("answers.created_at", "asc")
      .limit(50);

    const newItems = nextLevel.filter((r) => !allIds.has(r.id));
    if (newItems.length === 0) break;

    newItems.forEach((r) => {
      allIds.add(r.id);
      chain.push(r);
    });

    frontier = newItems.map((r) => r.id);
  }

  // Sort final chain by depth then created_at
  chain.sort((a, b) => {
    if (a.chain_depth !== b.chain_depth) return a.chain_depth - b.chain_depth;
    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  });

  const root = chain.find((r) => r.id === rootId) || chain[0];

  return {
    root: {
      id: root.id,
      user_id: root.user_id,
      username: root.username,
      video_url: root.video_url,
      answer_type: root.answer_type,
      text_content: root.text_content,
      question_text: root.question_text,
      question_id: root.question_id,
      created_at: root.created_at,
      likes: root.likes || 0,
      views: root.views || 0,
      chain_depth: root.chain_depth || 0,
    },
    chain: chain.map((r) => ({
      id: r.id,
      parent_answer_id: r.parent_answer_id,
      depth: r.chain_depth || 0,
      user_id: r.user_id,
      username: r.username,
      video_url: r.video_url,
      answer_type: r.answer_type,
      text_content: r.text_content,
      question_text: r.question_text,
      created_at: r.created_at,
      likes: r.likes || 0,
      views: r.views || 0,
      is_remix: r.is_remix || false,
    })),
    totalRemixes: Math.max(0, chain.length - 1),
  };
}

/**
 * Get remix count for an answer (how many people remixed it).
 *
 * @param {object} db - Knex instance
 * @param {number} answerId
 * @returns {number}
 */
async function getRemixCount(db, answerId) {
  const result = await db("answers")
    .where("parent_answer_id", answerId)
    .whereNull("deleted_at")
    .count("id as count")
    .first();

  return parseInt(result?.count, 10) || 0;
}

/**
 * Apply remix boost to feed score.
 * Answers in active chains get boosted to encourage participation.
 *
 * @param {number} score - Current feed score
 * @param {number} chainDepth - Depth of the answer in the chain
 * @param {boolean} isRemix - Whether this answer is a remix
 * @returns {number} Boosted score
 */
function applyRemixBoost(score, chainDepth = 0, isRemix = false) {
  if (!isRemix && chainDepth === 0) return score;

  // Deeper chains → more viral → higher boost
  if (chainDepth >= 3) return score * 1.4;
  if (chainDepth >= 2) return score * 1.3;
  if (chainDepth === 1) return score * 1.15;
  return score;
}

/**
 * Check if a user can remix a specific answer.
 *
 * @param {object} db - Knex instance
 * @param {number} parentAnswerId
 * @param {number} userId
 * @returns {{ canRemix: boolean, reason?: string }}
 */
async function canRemix(db, parentAnswerId, userId) {
  const parent = await db("answers")
    .where({ id: parentAnswerId })
    .whereNull("deleted_at")
    .first();

  if (!parent) {
    return { canRemix: false, reason: "parent_not_found" };
  }

  if (Number(parent.user_id) === Number(userId)) {
    return { canRemix: false, reason: "self_remix" };
  }

  // Check if already remixed by this user
  const existing = await db("answers")
    .where({ parent_answer_id: parentAnswerId, user_id: userId })
    .whereNull("deleted_at")
    .first();

  if (existing) {
    return { canRemix: false, reason: "already_remixed" };
  }

  // Check depth limit
  const depth = Number(parent.chain_depth) || 0;
  if (depth >= MAX_CHAIN_DEPTH) {
    return { canRemix: false, reason: "max_depth_reached" };
  }

  return { canRemix: true };
}

module.exports = {
  MAX_CHAIN_DEPTH,
  createRemix,
  getRemixChain,
  getRemixCount,
  applyRemixBoost,
  canRemix,
};
