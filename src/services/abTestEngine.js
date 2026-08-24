/**
 * A/B Testing Engine — Feed Experimentation
 *
 * Assigns users to buckets, serves different feed weight configs,
 * and tracks KPI outcomes per variant.
 *
 * HOW:
 *   1. User hits feed → getBucket(userId) → "control" or "variant_X"
 *   2. Feed pipeline reads weights from experiment config
 *   3. KPI events tagged with bucket
 *   4. GET /api/experiments/results → compare variants
 */

// ─────────────────────────────────────────────
// EXPERIMENT DEFINITIONS
// ─────────────────────────────────────────────

const experiments = new Map();

// Default experiment: feed weight tuning
experiments.set("feed_weights_v1", {
  id: "feed_weights_v1",
  active: true,
  startedAt: Date.now(),
  variants: {
    control: {
      weights: { personalization: 0.35, trending: 0.25, breakout: 0.15, exploration: 0.15, random: 0.10 },
      description: "Current production weights",
    },
    more_exploration: {
      weights: { personalization: 0.30, trending: 0.20, breakout: 0.10, exploration: 0.25, random: 0.15 },
      description: "More discovery, less personalization",
    },
    more_trending: {
      weights: { personalization: 0.30, trending: 0.35, breakout: 0.15, exploration: 0.10, random: 0.10 },
      description: "Heavy trending focus",
    },
  },
  // Traffic split (must sum to 1.0)
  trafficSplit: { control: 0.50, more_exploration: 0.25, more_trending: 0.25 },
});

// ─────────────────────────────────────────────
// BUCKET ASSIGNMENT (deterministic by userId)
// ─────────────────────────────────────────────

const bucketCache = new Map(); // userId → { experimentId → variantName }

function getBucket(userId, experimentId = "feed_weights_v1") {
  if (!userId) return "control";

  const cacheKey = `${userId}:${experimentId}`;
  if (bucketCache.has(cacheKey)) return bucketCache.get(cacheKey);

  const experiment = experiments.get(experimentId);
  if (!experiment || !experiment.active) return "control";

  // Deterministic hash: same user always gets same bucket
  const hash = simpleHash(`${userId}:${experimentId}`) % 100;
  let cumulative = 0;
  let assignedVariant = "control";

  for (const [variant, split] of Object.entries(experiment.trafficSplit)) {
    cumulative += split * 100;
    if (hash < cumulative) {
      assignedVariant = variant;
      break;
    }
  }

  bucketCache.set(cacheKey, assignedVariant);
  return assignedVariant;
}

function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash);
}

// ─────────────────────────────────────────────
// GET EXPERIMENT WEIGHTS FOR USER
// ─────────────────────────────────────────────

function getExperimentWeights(userId, experimentId = "feed_weights_v1") {
  const variant = getBucket(userId, experimentId);
  const experiment = experiments.get(experimentId);

  if (!experiment) {
    return { personalization: 0.35, trending: 0.25, breakout: 0.15, exploration: 0.15, random: 0.10 };
  }

  const config = experiment.variants[variant];
  return config ? config.weights : experiment.variants.control.weights;
}

// ─────────────────────────────────────────────
// KPI TRACKING PER VARIANT
// ─────────────────────────────────────────────

// variantId → { sessions, totalSessionLength, totalScrollDepth, ... }
const variantMetrics = new Map();

function trackVariantKPI(userId, kpiData) {
  const variant = getBucket(userId);
  if (!variantMetrics.has(variant)) {
    variantMetrics.set(variant, {
      sessions: 0,
      totalSessionLength: 0,
      totalScrollDepth: 0,
      totalEngagements: 0,
      totalViews: 0,
    });
  }

  const m = variantMetrics.get(variant);
  if (kpiData.sessionLength) { m.sessions++; m.totalSessionLength += kpiData.sessionLength; }
  if (kpiData.scrollDepth) { m.totalScrollDepth += kpiData.scrollDepth; m.sessions = Math.max(m.sessions, 1); }
  if (kpiData.engagement) m.totalEngagements++;
  if (kpiData.view) m.totalViews++;
}

// ─────────────────────────────────────────────
// RESULTS
// ─────────────────────────────────────────────

function getExperimentResults(experimentId = "feed_weights_v1") {
  const experiment = experiments.get(experimentId);
  if (!experiment) return null;

  const results = {};
  for (const variant of Object.keys(experiment.variants)) {
    const m = variantMetrics.get(variant) || { sessions: 0, totalSessionLength: 0, totalScrollDepth: 0, totalEngagements: 0, totalViews: 0 };

    results[variant] = {
      sessions: m.sessions,
      avgSessionLength: m.sessions > 0 ? Math.round(m.totalSessionLength / m.sessions) : 0,
      avgScrollDepth: m.sessions > 0 ? Math.round((m.totalScrollDepth / m.sessions) * 1000) / 1000 : 0,
      engagementRate: m.totalViews > 0 ? Math.round((m.totalEngagements / m.totalViews) * 1000) / 1000 : 0,
      description: experiment.variants[variant].description,
    };
  }

  return {
    experimentId,
    active: experiment.active,
    startedAt: new Date(experiment.startedAt).toISOString(),
    runningHours: Math.round((Date.now() - experiment.startedAt) / (1000 * 60 * 60) * 10) / 10,
    results,
  };
}

// ─────────────────────────────────────────────
// ADMIN: Create/update experiments
// ─────────────────────────────────────────────

function createExperiment(config) {
  experiments.set(config.id, { ...config, active: true, startedAt: Date.now() });
}

function stopExperiment(experimentId) {
  const exp = experiments.get(experimentId);
  if (exp) exp.active = false;
}

function listExperiments() {
  return [...experiments.entries()].map(([id, exp]) => ({
    id,
    active: exp.active,
    variants: Object.keys(exp.variants),
    trafficSplit: exp.trafficSplit,
  }));
}

module.exports = {
  getBucket,
  getExperimentWeights,
  trackVariantKPI,
  getExperimentResults,
  createExperiment,
  stopExperiment,
  listExperiments,
};
