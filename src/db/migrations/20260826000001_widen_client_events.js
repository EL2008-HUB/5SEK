/**
 * Widen client_events created by 20260420000013.
 *
 * 20260428000002 was `if (!hasTable) { create wide }` so it no-op'd on this
 * database (table already existed) while knex still marked it applied.
 * 20260428000003 only added event_id + position.
 *
 * This follow-up adds the remaining columns the event pipeline inserts and
 * KPI queries need, plus the indexes 00002 originally intended.
 */

const WIDE_COLUMNS = [
  { name: "session_id", add: (table) => table.string("session_id", 50).nullable() },
  { name: "entity_type", add: (table) => table.string("entity_type", 20).nullable() },
  { name: "entity_id", add: (table) => table.integer("entity_id").nullable() },
  { name: "watch_time", add: (table) => table.float("watch_time").nullable() },
  { name: "duration", add: (table) => table.float("duration").nullable() },
];

const WIDE_INDEXES = [
  {
    name: "client_events_user_id_event_type_index",
    sql: "CREATE INDEX IF NOT EXISTS client_events_user_id_event_type_index ON client_events (user_id, event_type)",
  },
  {
    name: "client_events_entity_type_entity_id_index",
    sql: "CREATE INDEX IF NOT EXISTS client_events_entity_type_entity_id_index ON client_events (entity_type, entity_id)",
  },
  {
    name: "client_events_event_type_created_at_index",
    sql: "CREATE INDEX IF NOT EXISTS client_events_event_type_created_at_index ON client_events (event_type, created_at)",
  },
  {
    name: "client_events_session_id_index",
    sql: "CREATE INDEX IF NOT EXISTS client_events_session_id_index ON client_events (session_id)",
  },
];

async function addMissingWideColumns(knex) {
  for (const column of WIDE_COLUMNS) {
    const exists = await knex.schema.hasColumn("client_events", column.name);
    if (!exists) {
      await knex.schema.alterTable("client_events", (table) => {
        column.add(table);
      });
    }
  }
}

async function addMissingWideIndexes(knex) {
  for (const index of WIDE_INDEXES) {
    await knex.raw(index.sql);
  }
}

exports.up = async function up(knex) {
  const hasTable = await knex.schema.hasTable("client_events");
  if (!hasTable) return;

  await addMissingWideColumns(knex);
  await addMissingWideIndexes(knex);
};

exports.down = async function down(knex) {
  const hasTable = await knex.schema.hasTable("client_events");
  if (!hasTable) return;

  for (const index of WIDE_INDEXES) {
    await knex.raw(`DROP INDEX IF EXISTS ${index.name}`);
  }

  for (const column of WIDE_COLUMNS) {
    const exists = await knex.schema.hasColumn("client_events", column.name);
    if (exists) {
      await knex.schema.alterTable("client_events", (table) => {
        table.dropColumn(column.name);
      });
    }
  }
};
