exports.up = async function up(knex) {
  const hasDeletionRequestedAt = await knex.schema.hasColumn("users", "deletion_requested_at");
  const hasDeletionDeadlineAt = await knex.schema.hasColumn("users", "deletion_deadline_at");
  const hasDeleteReason = await knex.schema.hasColumn("users", "delete_reason");

  await knex.schema.alterTable("users", (table) => {
    if (!hasDeletionRequestedAt) {
      table.timestamp("deletion_requested_at").nullable();
    }

    if (!hasDeletionDeadlineAt) {
      table.timestamp("deletion_deadline_at").nullable();
    }

    if (!hasDeleteReason) {
      table.text("delete_reason").nullable();
    }
  });
};

exports.down = async function down(knex) {
  const hasDeletionRequestedAt = await knex.schema.hasColumn("users", "deletion_requested_at");
  const hasDeletionDeadlineAt = await knex.schema.hasColumn("users", "deletion_deadline_at");

  await knex.schema.alterTable("users", (table) => {
    if (hasDeletionDeadlineAt) {
      table.dropColumn("deletion_deadline_at");
    }

    if (hasDeletionRequestedAt) {
      table.dropColumn("deletion_requested_at");
    }
  });
};
