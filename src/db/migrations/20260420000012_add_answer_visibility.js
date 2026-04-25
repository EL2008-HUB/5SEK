exports.up = async function up(knex) {
  await knex.schema.alterTable("answers", (table) => {
    table.boolean("is_hidden").notNullable().defaultTo(false);
    table.index(["is_hidden", "created_at"], "answers_hidden_created_idx");
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable("answers", (table) => {
    table.dropIndex(["is_hidden", "created_at"], "answers_hidden_created_idx");
    table.dropColumn("is_hidden");
  });
};
