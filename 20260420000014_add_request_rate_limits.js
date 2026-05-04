exports.up = async function up(knex) {
  await knex.schema.createTable("request_rate_limits", (table) => {
    table.increments("id").primary();
    table.string("scope").notNullable();
    table.string("actor_key", 255).notNullable();
    table.timestamp("window_start").notNullable();
    table.integer("count").notNullable().defaultTo(1);
    table.timestamp("created_at").defaultTo(knex.fn.now());
    table.timestamp("updated_at").defaultTo(knex.fn.now());

    table.unique(["scope", "actor_key", "window_start"], {
      indexName: "request_rate_limits_scope_actor_window_uq",
    });
    table.index(["updated_at"], "request_rate_limits_updated_idx");
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists("request_rate_limits");
};
