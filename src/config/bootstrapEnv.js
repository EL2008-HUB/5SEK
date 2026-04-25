const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");

let bootstrapped = false;

function readIfExists(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return;
  }

  dotenv.config({ path: filePath, override: false });
}

function applySecretFile(secretFilePath) {
  if (!secretFilePath || !fs.existsSync(secretFilePath)) {
    return;
  }

  const payload = JSON.parse(fs.readFileSync(secretFilePath, "utf8"));
  if (!payload || typeof payload !== "object") {
    return;
  }

  Object.entries(payload).forEach(([key, value]) => {
    if (process.env[key] === undefined && value !== undefined && value !== null) {
      process.env[key] = String(value);
    }
  });
}

function bootstrapEnv(baseDir = process.cwd()) {
  if (bootstrapped) {
    return process.env;
  }

  const appEnv = process.env.APP_ENV || process.env.NODE_ENV || "development";
  const cwd = path.resolve(baseDir);

  readIfExists(path.join(cwd, ".env"));
  readIfExists(path.join(cwd, `.env.${appEnv}`));
  readIfExists(path.join(cwd, ".env.local"));
  readIfExists(path.join(cwd, `.env.${appEnv}.local`));

  const secretsFile =
    process.env.SECRETS_FILE ||
    process.env.SECRET_MANAGER_FILE ||
    (process.env.SECRET_MANAGER_PROVIDER && process.env.SECRET_MANAGER_PATH) ||
    null;

  applySecretFile(secretsFile ? path.resolve(cwd, secretsFile) : null);

  if (!process.env.APP_ENV) {
    process.env.APP_ENV = appEnv;
  }

  if (!process.env.NODE_ENV) {
    process.env.NODE_ENV = appEnv === "production" ? "production" : appEnv === "staging" ? "production" : "development";
  }

  bootstrapped = true;
  return process.env;
}

module.exports = {
  bootstrapEnv,
};
