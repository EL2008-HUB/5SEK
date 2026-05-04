function getRequestContext(req) {
  const forwardedIp = req.headers?.["x-forwarded-for"];
  return {
    ip_address:
      (typeof forwardedIp === "string" && forwardedIp.split(",")[0]?.trim()) ||
      req.ip ||
      req.connection?.remoteAddress ||
      null,
    user_agent: req.headers?.["user-agent"] || null,
  };
}

async function logAdminAction(req, {
  action,
  entityType = null,
  entityId = null,
  metadata = null,
} = {}) {
  if (!req?.db || !req?.userId || !action) {
    return null;
  }

  const context = getRequestContext(req);
  const [row] = await req.db("admin_audit_logs")
    .insert({
      admin_user_id: req.userId,
      action,
      entity_type: entityType,
      entity_id: entityId,
      metadata: metadata || null,
      ip_address: context.ip_address,
      user_agent: context.user_agent,
    })
    .returning("*");

  return row;
}

module.exports = {
  logAdminAction,
};
