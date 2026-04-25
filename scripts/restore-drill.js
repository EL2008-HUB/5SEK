const { bootstrapEnv } = require("../src/config/bootstrapEnv");
bootstrapEnv(require("path").join(__dirname, ".."));

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const backupDir = process.env.BACKUP_DIR || path.join(__dirname, "../backups");
const restoreUrl = process.env.RESTORE_DATABASE_URL;

if (!restoreUrl) {
  throw new Error("RESTORE_DATABASE_URL is required for restore drills");
}

const candidates = fs.existsSync(backupDir)
  ? fs.readdirSync(backupDir)
      .filter((entry) => entry.endsWith(".dump"))
      .map((entry) => path.join(backupDir, entry))
      .sort()
  : [];

const latestBackup = candidates[candidates.length - 1];
if (!latestBackup) {
  throw new Error("No backup file found for restore drill");
}

const child = spawn(
  "node",
  [path.join(__dirname, "restore-db.js"), latestBackup],
  {
    stdio: "inherit",
    shell: true,
    env: {
      ...process.env,
      RESTORE_DATABASE_URL: restoreUrl,
    },
  }
);

child.on("exit", (code) => {
  if (code !== 0) {
    process.exit(code || 1);
  }
  console.log(`Restore drill completed using ${latestBackup}`);
});
