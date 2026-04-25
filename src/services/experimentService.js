function pickVariant(userId, experimentKey, variants) {
  const seed = `${experimentKey}:${userId}`;
  let hash = 0;

  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  }

  return variants[hash % variants.length];
}

const EXPERIMENTS = {
  feed_ranker_v2: ["control", "retention_boost"],
  paywall_v2: ["control", "price_anchor"],
  duels_v1: ["off", "on"],
};

async function ensureAssignment(db, userId, experimentKey) {
  const configuredVariants = EXPERIMENTS[experimentKey];
  if (!configuredVariants) return null;

  const existing = await db("experiment_assignments")
    .where({ user_id: userId, experiment_key: experimentKey })
    .first();

  if (existing) return existing.variant;

  const variant = pickVariant(userId, experimentKey, configuredVariants);
  await db("experiment_assignments").insert({
    user_id: userId,
    experiment_key: experimentKey,
    variant,
  });

  return variant;
}

async function getAssignments(db, userId) {
  const keys = Object.keys(EXPERIMENTS);
  const entries = await Promise.all(
    keys.map(async (key) => [key, await ensureAssignment(db, userId, key)])
  );

  return Object.fromEntries(entries);
}

module.exports = {
  EXPERIMENTS,
  getAssignments,
};
