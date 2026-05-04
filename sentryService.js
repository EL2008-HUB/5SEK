'use strict';

let Sentry = null;
let initialized = false;

/**
 * Initialize Sentry with the SENTRY_DSN environment variable.
 * No-op if SENTRY_DSN is not configured.
 */
function initSentry() {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    return;
  }

  try {
    Sentry = require('@sentry/node');
    Sentry.init({
      dsn,
      environment: process.env.APP_ENV || process.env.NODE_ENV || 'production',
      // Capture 100% of transactions in production; tune as needed
      tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE || '0.1'),
    });
    initialized = true;
    console.log('Sentry initialized');
  } catch (err) {
    // Graceful degradation: if @sentry/node is unavailable, continue without it
    console.warn('Sentry initialization failed (continuing without error tracking):', err.message);
    Sentry = null;
    initialized = false;
  }
}

/**
 * Capture an exception with optional context.
 * No-op if Sentry is not initialized.
 *
 * @param {Error} error
 * @param {Object} [context] - Additional key/value pairs attached as extra data
 */
function captureException(error, context) {
  if (!initialized || !Sentry) {
    return;
  }

  try {
    Sentry.withScope((scope) => {
      if (context && typeof context === 'object') {
        scope.setExtras(context);
      }
      Sentry.captureException(error);
    });
  } catch (_) {
    // Never let Sentry itself crash the process
  }
}

/**
 * Capture a message with an optional severity level and context.
 * No-op if Sentry is not initialized.
 *
 * @param {string} message
 * @param {'info'|'warning'|'error'|'fatal'} [level='info']
 * @param {Object} [context]
 */
function captureMessage(message, level, context) {
  if (!initialized || !Sentry) {
    return;
  }

  const validLevels = ['info', 'warning', 'error', 'fatal'];
  const sentryLevel = validLevels.includes(level) ? level : 'info';

  try {
    Sentry.withScope((scope) => {
      scope.setLevel(sentryLevel);
      if (context && typeof context === 'object') {
        scope.setExtras(context);
      }
      Sentry.captureMessage(message);
    });
  } catch (_) {
    // Never let Sentry itself crash the process
  }
}

module.exports = {
  initSentry,
  captureException,
  captureMessage,
};
