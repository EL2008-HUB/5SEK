const { bootstrapEnv } = require("../src/config/bootstrapEnv");
bootstrapEnv(require("path").join(__dirname, ".."));

const path = require("path");
const { spawnSync } = require("child_process");

function run(command, args) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: true,
    env: process.env,
  });

  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

run("node", [path.join(__dirname, "backup-db.js")]);
run("npx", ["knex", "migrate:rollback"]);
