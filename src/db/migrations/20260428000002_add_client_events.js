/**
 * Production Event Pipeline — client_events table
 * 
 * Captures all user behavior signals:
 * view, watch, complete, skip, like, share, record_start, record_post
 */
exports.up = async function (knex) {
  const hasTable = await knex.schema.hasTable("client_events");
  if (!hasTable) {
    await knex.schema.createTable("client_events", (table) => {
    table.increments("id").primary();
    table.integer("user_id").unsigned().nullable();
    table.string("session_id", 50).nullable();
    table.string("event_type", 30).notNullable();
    table.string("entity_type", 20).nullable();    // answer, question, duel
    table.integer("entity_id").nullable();
    table.float("watch_time").nullable();
    table.float("duration").nullable();
    table.json("metadata").nullable();
    table.timestamp("created_at").defaultTo(knex.fn.now());

    // Indexes for analytics queries
    table.index(["user_id", "event_type"]);
    table.index(["entity_type", "entity_id"]);
    table.index(["event_type", "created_at"]);
    table.index("session_id");
    });
  }
};

exports.down = function (knex) {
  return knex.schema.dropTableIfExists("client_events");
};
