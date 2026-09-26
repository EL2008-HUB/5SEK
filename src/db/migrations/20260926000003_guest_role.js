/**
 * Allow role = 'guest' so visitors can use the app without registering.
 * Guests are real user rows and can be upgraded in place (same id).
 */
exports.up = async function up(knex) {
  await knex.raw(`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check`);
  await knex.raw(`
    ALTER TABLE users
    ADD CONSTRAINT users_role_check
    CHECK (role IN ('guest', 'user', 'moderator', 'admin', 'super_admin'))
  `);
  await knex.raw(`CREATE INDEX IF NOT EXISTS idx_users_role_guest ON users (created_at) WHERE role = 'guest'`);
};

exports.down = async function down(knex) {
  await knex.raw(`DROP INDEX IF EXISTS idx_users_role_guest`);
  await knex("users").where({ role: "guest" }).update({ role: "user" });
  await knex.raw(`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check`);
  await knex.raw(`
    ALTER TABLE users
    ADD CONSTRAINT users_role_check
    CHECK (role IN ('user', 'moderator', 'admin', 'super_admin'))
  `);
};
