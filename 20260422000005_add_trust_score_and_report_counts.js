exports.up = async function up(knex) {
  await knex.schema.alterTable("users", (table) => {
    table.integer("trust_score").notNullable().defaultTo(100);
  });

  await knex.schema.alterTable("answers", (table) => {
    table.integer("report_count").notNullable().defaultTo(0);
    table.timestamp("last_reported_at").nullable();
    table.index(["is_hidden", "report_count", "created_at"], "answers_hidden_report_created_idx");
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable("answers", (table) => {
    table.dropIndex(["is_hidden", "report_count", "created_at"], "answers_hidden_report_created_idx");
    table.dropColumn("last_reported_at");
    table.dropColumn("report_count");
  });

  await knex.schema.alterTable("users", (table) => {
    table.dropColumn("trust_score");
  });
};
