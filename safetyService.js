const { revokeAllUserSessions } = require("./authSessionService");

function applyActiveUserFilter(query, alias = "users") {
  return query
    .whereNull(`${alias}.deleted_at`)
    .where(`${alias}.is_blocked`, false);
}

function applyActiveQuestionFilter(query, alias = "questions") {
  return query.whereNull(`${alias}.deleted_at`);
}

function applyActiveAnswerFilter(query, alias = "answers") {
  return query
    .whereNull(`${alias}.deleted_at`)
    .where(`${alias}.is_hidden`, false);
}

async function getBlockedUserIds(db, userId) {
  if (!userId) return [];

  const rows = await db("user_blocks")
    .where("blocker_user_id", userId)
    .orWhere("blocked_user_id", userId)
    .select("blocker_user_id", "blocked_user_id");

  const blocked = new Set();
  rows.forEach((row) => {
    if (Number(row.blocker_user_id) === Number(userId)) {
      blocked.add(Number(row.blocked_user_id));
    } else {
      blocked.add(Number(row.blocker_user_id));
    }
  });

  return [...blocked];
}

async function createUserBlock(db, blockerUserId, blockedUserId) {
  if (!blockerUserId || !blockedUserId || Number(blockerUserId) === Number(blockedUserId)) {
    const error = new Error("invalid_block_target");
    error.statusCode = 400;
    throw error;
  }

  await db("user_blocks")
    .insert({
      blocker_user_id: blockerUserId,
      blocked_user_id: blockedUserId,
    })
    .onConflict(["blocker_user_id", "blocked_user_id"])
    .ignore();
}

async function removeUserBlock(db, blockerUserId, blockedUserId) {
  await db("user_blocks")
    .where({
      blocker_user_id: blockerUserId,
      blocked_user_id: blockedUserId,
    })
    .del();
}

async function listUserBlocks(db, blockerUserId) {
  return db("user_blocks as ub")
    .join("users as u", "ub.blocked_user_id", "u.id")
    .where("ub.blocker_user_id", blockerUserId)
    .whereNull("u.deleted_at")
    .select("u.id", "u.username", "u.country", "ub.created_at")
    .orderBy("ub.created_at", "desc");
}

async function softDeleteAnswer(db, answerId, actorUserId, reason = "soft_deleted") {
  const [answer] = await db("answers")
    .where({ id: answerId })
    .update({
      deleted_at: new Date().toISOString(),
      deleted_by_user_id: actorUserId || null,
      moderation_reason: reason,
      is_hidden: true,
    })
    .returning("*");

  return answer || null;
}

async function restoreAnswer(db, answerId) {
  const [answer] = await db("answers")
    .where({ id: answerId })
    .update({
      deleted_at: null,
      deleted_by_user_id: null,
      is_hidden: false,
    })
    .returning("*");

  return answer || null;
}

async function softDeleteQuestion(db, questionId, actorUserId, reason = "soft_deleted") {
  const [question] = await db("questions")
    .where({ id: questionId })
    .update({
      deleted_at: new Date().toISOString(),
      deleted_by_user_id: actorUserId || null,
      delete_reason: reason,
      is_daily: false,
      active_date: null,
    })
    .returning("*");

  return question || null;
}

async function restoreQuestion(db, questionId) {
  const [question] = await db("questions")
    .where({ id: questionId })
    .update({
      deleted_at: null,
      deleted_by_user_id: null,
      delete_reason: null,
    })
    .returning("*");

  return question || null;
}

async function softDeleteUser(db, userId, actorUserId, reason = "soft_deleted") {
  const [user] = await db("users")
    .where({ id: userId })
    .update({
      deleted_at: new Date().toISOString(),
      deleted_by_user_id: actorUserId || null,
      delete_reason: reason,
      is_blocked: true,
      blocked_at: new Date().toISOString(),
      blocked_reason: reason,
    })
    .returning("*");

  if (user) {
    await revokeAllUserSessions(db, userId);
  }

  return user || null;
}

async function restoreUser(db, userId) {
  const [user] = await db("users")
    .where({ id: userId })
    .update({
      deleted_at: null,
      deleted_by_user_id: null,
      delete_reason: null,
      is_blocked: false,
      blocked_at: null,
      blocked_reason: null,
    })
    .returning("*");

  return user || null;
}

async function setUserBlocked(db, userId, blocked, reason = null) {
  const [user] = await db("users")
    .where({ id: userId })
    .update({
      is_blocked: Boolean(blocked),
      blocked_at: blocked ? new Date().toISOString() : null,
      blocked_reason: blocked ? reason : null,
    })
    .returning("*");

  if (user && blocked) {
    await revokeAllUserSessions(db, userId);
  }

  return user || null;
}

module.exports = {
  applyActiveAnswerFilter,
  applyActiveQuestionFilter,
  applyActiveUserFilter,
  createUserBlock,
  getBlockedUserIds,
  listUserBlocks,
  removeUserBlock,
  restoreAnswer,
  restoreQuestion,
  restoreUser,
  setUserBlocked,
  softDeleteAnswer,
  softDeleteQuestion,
  softDeleteUser,
};
