/**
 * Adds user consents storage for privacy and legal preferences.
 */

exports.up = async function(knex) {
  const exists = await knex.schema.hasTable('user_consents');
  if (exists) {
    return;
  }

  await knex.schema.createTable('user_consents', (table) => {
    table.increments('id').primary();
    table
      .integer('user_id')
      .notNullable()
      .references('id')
      .inTable('users')
      .onDelete('CASCADE')
      .unique();
    table.boolean('analytics_consent').notNullable().defaultTo(false);
    table.boolean('marketing_consent').notNullable().defaultTo(false);
    table.boolean('third_party_consent').notNullable().defaultTo(false);
    table.timestamp('consented_at').defaultTo(knex.fn.now());
    table.timestamps(true, true);
  });
};

exports.down = async function(knex) {
  const exists = await knex.schema.hasTable('user_consents');
  if (!exists) {
    return;
  }

  await knex.schema.dropTableIfExists('user_consents');
};
