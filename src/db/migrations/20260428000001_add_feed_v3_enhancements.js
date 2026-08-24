/**
 * Feed Engine v3 Enhancements
 *
 * 1. Add recent_skips to feed_sessions (for session-aware skip detection)
 * 2. Add index on feed_seen_state for faster lookups
 * 3. Add feed_cache_versions table for cross-process cache coordination
 */
exports.up = function (knex) {
  return knex.schema
    .alterTable("feed_sessions", (table) => {
      // Track recent skips in the current session for skip-loop detection
      table.integer("recent_skips").defaultTo(0);
      // Track consecutive skips (resets on completion/like)
      table.integer("consecutive_skips").defaultTo(0);
    })
    .then(() => {
      // Add composite index for faster seen-state lookups
      return knex.schema.raw(`
        CREATE INDEX IF NOT EXISTS idx_feed_seen_state_user_recent
        ON feed_seen_state (user_id, seen_at DESC)
      `);
    })
    .then(() => {
      // Feed cache version table (for multi-process coordination)
      return knex.schema.createTable("feed_cache_versions", (table) => {
        table.string("country", 10).primary();
        table.integer("version").defaultTo(1);
        table.timestamp("updated_at").defaultTo(knex.fn.now());
      });
    })
    .then(() => {
      // Seed initial versions for active countries
      const countries = ["AL", "US", "DE", "XK", "UK", "TR", "IT", "GLOBAL"];
      return knex("feed_cache_versions")
        .insert(countries.map((c) => ({ country: c, version: 1 })))
        .onConflict("country")
        .ignore();
    });
};

exports.down = function (knex) {
  return knex.schema
    .dropTableIfExists("feed_cache_versions")
    .then(() =>
      knex.schema.raw("DROP INDEX IF EXISTS idx_feed_seen_state_user_recent")
    )
    .then(() =>
      knex.schema.alterTable("feed_sessions", (table) => {
        table.dropColumn("consecutive_skips");
        table.dropColumn("recent_skips");
      })
    );
};
