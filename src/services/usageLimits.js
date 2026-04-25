function toDateStr(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().split("T")[0];
  if (typeof value === "string") return value.split("T")[0];
  return null;
}

function getBonusAnswersToday(user = {}, today = new Date().toISOString().split("T")[0]) {
  return toDateStr(user.bonus_answers_date) === today ? user.bonus_answers_today || 0 : 0;
}

function getEffectiveAnswerLimit(user = {}, today = new Date().toISOString().split("T")[0]) {
  const isPremium = Boolean(user.is_premium);
  const bonusUsed = getBonusAnswersToday(user, today);
  const baseLimit = 5;

  return {
    baseLimit,
    bonusUsed,
    isPremium,
    limit: isPremium ? null : baseLimit + bonusUsed,
  };
}

module.exports = {
  getBonusAnswersToday,
  getEffectiveAnswerLimit,
  toDateStr,
};
