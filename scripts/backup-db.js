const { bootstrapEnv } = require("../src/config/bootstrapEnv");
bootstrapEnv(require("path").join(__dirname, ".."));

const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const backupDir = process.env.BACKUP_DIR || path.join(__dirname, "../backups");
const retentionDays = Number(process.env.BACKUP_RETENTION_DAYS || 14);
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const outputPath = path.join(backupDir, `5sek-${timestamp}.dump`);

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required for backups");
}

fs.mkdirSync(backupDir, { recursive: true });

function applyRetentionPolicy() {
  if (!retentionDays || retentionDays < 1) {
    return;
  }

  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  fs.readdirSync(backupDir).forEach((entry) => {
    const fullPath = path.join(backupDir, entry);
    const stats = fs.statSync(fullPath);
    if (stats.isFile() && stats.mtimeMs < cutoff) {
      fs.unlinkSync(fullPath);
    }
  });
}

const child = spawn("pg_dump", ["--format=custom", "--file", outputPath, process.env.DATABASE_URL], {
  stdio: "inherit",
  shell: true,
});

child.on("exit", (code) => {
  if (code !== 0) {
    process.exit(code || 1);
  }

  applyRetentionPolicy();
  console.log(`Backup written to ${outputPath}`);
});
