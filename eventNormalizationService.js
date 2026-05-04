/**
 * Event Normalization Service (K17)
 *
 * Wrapper over behaviorStateEngine.normalizeEvent() with:
 *   - DB persistence to client_events (with event_id deduplication)
 *   - Unknown event type logging (log + discard, no error propagation)
 *
 * SLA: <100ms per batch
 */

const { normalizeEvent, EVENT_TAXONOMY } = require('./behaviorStateEngine');
const { processGrowthEvent } = require('./growthSignalsService');
const behaviorProfileService = require('./behaviorProfileService');

// Simple logger — uses console.warn/error so it works without external deps
const logger = {
  warn: (msg, data) => console.warn(`[eventNormalizationService] WARN: ${msg}`, data || ''),
  error: (msg, data) => console.error(`[eventNormalizationService] ERROR: ${msg}`, data || ''),
};

/**
 * Normalize a raw event using the EVENT_TAXONOMY.
 *
 * Returns a normalized event object if the event_type is known,
 * or null if the event_type is unknown (unknown events are discarded).
 *
 * @param {Object} rawEvent - Raw event from client
 * @param {string} rawEvent.event_type - The event type string
 * @param {string|number} [rawEvent.user_id] - User identifier
 * @param {string} [rawEvent.event_id] - Optional client-generated UUID for dedup
 * @param {string} [rawEvent.session_id] - Session identifier
 * @param {*} [rawEvent.metadata] - Additional event metadata
 * @returns {{ user_id, event_type, category, weight, raw_payload, normalized_at, event_id, session_id } | null}
 */
function normalizeEventWithTaxonomy(rawEvent) {
  if (!rawEvent || typeof rawEvent !== 'object') return null;

  // Use hasOwnProperty to avoid prototype pollution (e.g. "toString", "constructor")
  const taxonomy = Object.prototype.hasOwnProperty.call(EVENT_TAXONOMY, rawEvent.event_type)
    ? EVENT_TAXONOMY[rawEvent.event_type]
    : null;

  if (!taxonomy) {
    // 1.3: Log unknown event type as warning, discard — do NOT propagate error
    logger.warn('unknown_event_type', {
      event_type: rawEvent.event_type,
      user_id: rawEvent.user_id,
    });
    return null;
  }

  return {
    event_id: rawEvent.event_id || null,
    user_id: rawEvent.user_id || null,
    event_type: rawEvent.event_type,
    category: taxonomy.category,
    weight: taxonomy.weight,
    raw_payload: { ...rawEvent },
    normalized_at: new Date().toISOString(),
    session_id: rawEvent.session_id || null,
  };
}

/**
 * Process a batch of raw events and persist them to the client_events table.
 *
 * Uses INSERT ... ON CONFLICT DO NOTHING on event_id for deduplication.
 * Unknown event types are logged and skipped (not persisted, no error thrown).
 *
 * @param {import('knex').Knex} db - Knex database instance
 * @param {string|number} userId - The user ID
 * @param {Array<Object>} events - Array of raw event objects
 * @returns {Promise<{ processed: number, unknown: number, normalized: Array }>}
 */
async function processAndPersistEvents(db, userId, events) {
  if (!events || events.length === 0) {
    return { processed: 0, unknown: 0, normalized: [] };
  }

  const normalized = [];
  let unknownCount = 0;

  for (const rawEvent of events) {
    // Attach userId if not already present on the event
    const eventWithUser = { ...rawEvent, user_id: rawEvent.user_id || userId };
    const result = normalizeEventWithTaxonomy(eventWithUser);

    if (result === null) {
      unknownCount++;
      continue;
    }

    normalized.push(result);
  }

  // Persist normalized events to DB
  if (normalized.length > 0 && db) {
    try {
      const rows = normalized.map((evt) => ({
        event_id: evt.event_id || null,
        user_id: evt.user_id,
        event_type: evt.event_type,
        metadata: evt.raw_payload ? JSON.stringify(evt.raw_payload) : null,
        session_id: evt.session_id || null,
        created_at: evt.normalized_at,
      }));

      // Insert with deduplication: ON CONFLICT on event_id DO NOTHING
      // We use raw knex insert + onConflict for portability
      await db('client_events')
        .insert(rows)
        .onConflict('event_id')
        .ignore();
    } catch (err) {
      logger.error('Failed to persist events to client_events', {
        userId,
        count: normalized.length,
        error: err.message,
      });
      // Non-critical — don't propagate DB errors to caller
    }

    // Fire-and-forget: process growth signals for each normalized event
    for (const evt of normalized) {
      processGrowthEvent(db, userId, evt).catch(() => {
        // Swallow errors — growth signal processing is non-blocking
      });
    }

    // Fire-and-forget: persist behavior profile update (K19)
    // Non-blocking — does not affect the response SLA
    behaviorProfileService.upsertBehaviorProfile(db, userId, {
      lastEventAt: new Date().toISOString(),
      eventCount: normalized.length,
    }).catch(() => {
      // Swallow errors — behavior profile persistence is non-critical
    });
  }

  return {
    processed: normalized.length,
    unknown: unknownCount,
    normalized,
  };
}

module.exports = {
  normalizeEventWithTaxonomy,
  processAndPersistEvents,
};
