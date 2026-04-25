const { bootstrapEnv } = require("../src/config/bootstrapEnv");
bootstrapEnv(require("path").join(__dirname, ".."));

const { spawn } = require("child_process");
const path = require("path");

const backupPath = process.argv[2];
const targetUrl = process.env.RESTORE_DATABASE_URL || process.env.DATABASE_URL;

if (!backupPath) {
  throw new Error("Usage: node scripts/restore-db.js <backup-file>");
}

if (!targetUrl) {
  throw new Error("RESTORE_DATABASE_URL or DATABASE_URL is required");
}

const resolvedBackup = path.resolve(process.cwd(), backupPath);

const child = spawn(
  "pg_restore",
  ["--clean", "--if-exists", "--no-owner", "--dbname", targetUrl, resolvedBackup],
  {
    stdio: "inherit",
    shell: true,
  }
);

child.on("exit", (code) => {
  process.exit(code || 0);
});
