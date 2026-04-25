const fs = require("fs");
const path = require("path");

const counters = new Map();
const latencyBuckets = new Map();
const LATENCY_BUCKETS = [50, 100, 250, 500, 1000, 2500, 5000];

function labelsKey(labels = {}) {
  return Object.entries(labels)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join(",");
}

function incCounter(name, labels = {}, value = 1) {
  const key = `${name}|${labelsKey(labels)}`;
  counters.set(key, (counters.get(key) || 0) + value);
}

function observeLatency(route, method, statusCode, durationMs) {
  const keyBase = labelsKey({ route, method, status_code: statusCode });
  LATENCY_BUCKETS.forEach((bucket) => {
    if (durationMs <= bucket) {
      const key = `api_request_duration_ms_bucket|${keyBase},le=${bucket}`;
      latencyBuckets.set(key, (latencyBuckets.get(key) || 0) + 1);
    }
  });
  const infKey = `api_request_duration_ms_bucket|${keyBase},le=+Inf`;
  latencyBuckets.set(infKey, (latencyBuckets.get(infKey) || 0) + 1);
  incCounter("api_request_duration_ms_sum", { route, method, status_code: statusCode }, durationMs);
  incCounter("api_request_duration_ms_count", { route, method, status_code: statusCode }, 1);
}

function recordHttpRequest(req, res, durationMs) {
  const route = req.route?.path || req.baseUrl || req.path || "unknown";
  const method = req.method;
  const statusCode = String(res.statusCode);
  incCounter("api_requests_total", { route, method, status_code: statusCode });
  observeLatency(route, method, statusCode, durationMs);

  if (res.statusCode >= 500) {
    incCounter("api_server_errors_total", { route, method });
  }
}

function renderMetricLines(sourceMap, metricName) {
  const lines = [];
  sourceMap.forEach((value, compoundKey) => {
    const [name, serializedLabels] = compoundKey.split("|");
    if (metricName && name !== metricName) return;
    const labels = serializedLabels
      ? `{${serializedLabels
          .split(",")
          .filter(Boolean)
          .map((entry) => {
            const [key, rawValue] = entry.split("=");
            return `${key}="${String(rawValue).replace(/"/g, '\\"')}"`;
          })
          .join(",")}}`
      : "";
    lines.push(`${name}${labels} ${value}`);
  });
  return lines;
}

function getDirectorySizeBytes(targetPath) {
  if (!targetPath || !fs.existsSync(targetPath)) return 0;
  const stats = fs.statSync(targetPath);
  if (stats.isFile()) return stats.size;

  return fs.readdirSync(targetPath).reduce((total, entry) => {
    return total + getDirectorySizeBytes(path.join(targetPath, entry));
  }, 0);
}

function getLatestFileAgeSeconds(targetPath) {
  if (!targetPath || !fs.existsSync(targetPath)) return -1;

  let latestMtimeMs = 0;
  const stack = [targetPath];
  while (stack.length > 0) {
    const current = stack.pop();
    const stats = fs.statSync(current);

    if (stats.isDirectory()) {
      fs.readdirSync(current).forEach((entry) => {
        stack.push(path.join(current, entry));
      });
      continue;
    }

    latestMtimeMs = Math.max(latestMtimeMs, stats.mtimeMs);
  }

  if (!latestMtimeMs) return -1;
  return Math.max(0, Math.floor((Date.now() - latestMtimeMs) / 1000));
}

function countFiles(targetPath) {
  if (!targetPath || !fs.existsSync(targetPath)) return 0;
  const stats = fs.statSync(targetPath);
  if (stats.isFile()) return 1;

  return fs.readdirSync(targetPath).reduce((total, entry) => {
    return total + countFiles(path.join(targetPath, entry));
  }, 0);
}

async function collectOperationalMetrics(db) {
  const uploadsDir = path.join(__dirname, "../../uploads");
  const backupDir = process.env.BACKUP_DIR || path.join(__dirname, "../../backups");
  const uploadsBytes = getDirectorySizeBytes(uploadsDir);
  const backupsBytes = getDirectorySizeBytes(backupDir);
  const backupFreshnessSeconds = getLatestFileAgeSeconds(backupDir);
  const backupCount = countFiles(backupDir);

  const dbSizeResult = await db.raw("select pg_database_size(current_database())::bigint as size_bytes");
  const dbSize = Number(dbSizeResult.rows?.[0]?.size_bytes || 0);

  return {
    uploadsBytes,
    backupsBytes,
    backupFreshnessSeconds,
    backupCount,
    dbSize,
  };
}

async function renderPrometheusMetrics(db) {
  const lines = [
    "# HELP api_requests_total Total API requests",
    "# TYPE api_requests_total counter",
    ...renderMetricLines(counters, "api_requests_total"),
    "# HELP api_server_errors_total Total 5xx API responses",
    "# TYPE api_server_errors_total counter",
    ...renderMetricLines(counters, "api_server_errors_total"),
    "# HELP auth_failures_total Total authentication failures",
    "# TYPE auth_failures_total counter",
    ...renderMetricLines(counters, "auth_failures_total"),
    "# HELP upload_failures_total Total upload failures",
    "# TYPE upload_failures_total counter",
    ...renderMetricLines(counters, "upload_failures_total"),
    "# HELP db_errors_total Total database related errors",
    "# TYPE db_errors_total counter",
    ...renderMetricLines(counters, "db_errors_total"),
    "# HELP api_request_duration_ms_bucket API request duration histogram buckets",
    "# TYPE api_request_duration_ms_bucket histogram",
    ...renderMetricLines(latencyBuckets),
    ...renderMetricLines(counters, "api_request_duration_ms_sum"),
    ...renderMetricLines(counters, "api_request_duration_ms_count"),
  ];

  if (db) {
    const operational = await collectOperationalMetrics(db);
    lines.push("# HELP storage_uploads_bytes Local uploads directory size");
    lines.push("# TYPE storage_uploads_bytes gauge");
    lines.push(`storage_uploads_bytes ${operational.uploadsBytes}`);
    lines.push("# HELP storage_backups_bytes Database backup directory size");
    lines.push("# TYPE storage_backups_bytes gauge");
    lines.push(`storage_backups_bytes ${operational.backupsBytes}`);
    lines.push("# HELP backup_freshness_seconds Age in seconds of the newest backup file");
    lines.push("# TYPE backup_freshness_seconds gauge");
    lines.push(`backup_freshness_seconds ${operational.backupFreshnessSeconds}`);
    lines.push("# HELP backup_files_total Total number of backup files present");
    lines.push("# TYPE backup_files_total gauge");
    lines.push(`backup_files_total ${operational.backupCount}`);
    lines.push("# HELP postgres_database_size_bytes Current database size");
    lines.push("# TYPE postgres_database_size_bytes gauge");
    lines.push(`postgres_database_size_bytes ${operational.dbSize}`);
  }

  return `${lines.join("\n")}\n`;
}

module.exports = {
  incCounter,
  recordHttpRequest,
  renderPrometheusMetrics,
};
