const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const {
  ACCESS_TOKEN_TTL,
  createRefreshSession,
  findRefreshSession,
  revokeAllUserSessions,
  revokeRefreshSession,
  rotateRefreshSession,
} = require("../services/authSessionService");
const { softDeleteUser } = require("../services/safetyService");
const { revokeUserPushTokens } = require("../services/pushNotificationService");
const { incCounter } = require("../services/metricsService");

function getJwtSecret() {
  if (!process.env.JWT_SECRET) {
    throw new Error("JWT_SECRET environment variable is required");
  }

  return process.env.JWT_SECRET;
}

function signToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, country: user.country, role: user.role || "user" },
    getJwtSecret(),
    { expiresIn: ACCESS_TOKEN_TTL }
  );
}

function getRequestMeta(req) {
  const forwardedIp = req.headers["x-forwarded-for"]?.split(",")[0]?.trim();
  return {
    userAgent: req.headers["user-agent"] || null,
    ipAddress: forwardedIp || req.ip || req.connection?.remoteAddress || null,
  };
}

function isUserUnavailable(user) {
  return !user || Boolean(user.deleted_at) || Boolean(user.is_blocked);
}

function getUnavailableUserError(user) {
  if (user?.deleted_at) {
    return { status: 403, body: { error: "account_deleted" } };
  }

  if (user?.is_blocked) {
    return { status: 403, body: { error: "account_blocked" } };
  }

  return { status: 401, body: { error: "Invalid token" } };
}

async function loadAuthenticatedUser(req, userId) {
  if (!userId) return null;

  return req.db("users")
    .where({ id: userId })
    .select(
      "id",
      "username",
      "email",
      "country",
      "role",
      "age_group",
      "interests",
      "is_premium",
      "subscription_status",
      "premium_expires_at",
      "created_at",
      "is_blocked",
      "blocked_at",
      "blocked_reason",
      "deleted_at"
    )
    .first();
}

async function issueAuthSession(req, user) {
  const token = signToken(user);
  const { refreshToken } = await createRefreshSession(req.db, user.id, getRequestMeta(req));
  return {
    token,
    refresh_token: refreshToken,
  };
}

function shapeUser(user) {
  let interests = user.interests;
  if (interests && typeof interests === "string") {
    try { interests = JSON.parse(interests); } catch (_) {}
  }

  return {
    id: user.id,
    username: user.username,
    email: user.email,
    country: user.country,
    role: user.role,
    age_group: user.age_group,
    interests,
    is_premium: user.is_premium,
    subscription_status: user.subscription_status || (user.is_premium ? "active" : "free"),
    premium_expires_at: user.premium_expires_at || null,
    created_at: user.created_at,
  };
}

// Register (with country support)
exports.register = async (req, res) => {
  try {
    const { username, email, password, country, age_group, interests } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({ error: "All fields are required" });
    }

    // Check if user exists
    const existingUser = await req.db("users")
      .where({ email })
      .orWhere({ username })
      .first();

    if (existingUser) {
      return res.status(409).json({ error: "User already exists" });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Resolve country: explicit > auto-detected > GLOBAL
    const userCountry = country
      ? country.toUpperCase()
      : req.detectedCountry || "GLOBAL";

    // Build insert data
    const insertData = {
      username,
      email,
      password: hashedPassword,
      country: userCountry,
      role: "user",
    };
    if (age_group) insertData.age_group = age_group;
    if (interests) insertData.interests = JSON.stringify(interests);

    // Create user
    const [user] = await req.db("users")
      .insert(insertData)
      .returning(["id", "username", "email", "country", "age_group", "interests", "created_at", "role"]);

    if (user.interests && typeof user.interests === "string") {
      try { user.interests = JSON.parse(user.interests); } catch (_) {}
    }

    // Generate token
    const session = await issueAuthSession(req, user);

    res.status(201).json({ user: shapeUser(user), ...session });
  } catch (error) {
    console.error("Register error:", error);
    res.status(500).json({ error: "Registration failed" });
  }
};

// Login
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password required" });
    }

    const user = await req.db("users").where({ email }).first();

    if (!user) {
      incCounter("auth_failures_total", { reason: "user_not_found" });
      return res.status(401).json({ error: "Invalid credentials" });
    }

    if (user.deleted_at) {
      incCounter("auth_failures_total", { reason: "account_deleted" });
      return res.status(403).json({ error: "account_deleted" });
    }

    if (user.is_blocked) {
      incCounter("auth_failures_total", { reason: "account_blocked" });
      return res.status(403).json({ error: "account_blocked" });
    }

    const validPassword = await bcrypt.compare(password, user.password);

    if (!validPassword) {
      incCounter("auth_failures_total", { reason: "bad_password" });
      return res.status(401).json({ error: "Invalid credentials" });
    }

    if (user.interests && typeof user.interests === "string") {
      try { user.interests = JSON.parse(user.interests); } catch (_) {}
    }

    const session = await issueAuthSession(req, user);

    res.json({
      user: shapeUser(user),
      ...session,
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ error: "Login failed" });
  }
};

// Get current user
exports.me = async (req, res) => {
  try {
    const user = await req.db("users")
      .where({ id: req.userId })
      .select(
        "id",
        "username",
        "email",
        "country",
        "age_group",
        "interests",
        "created_at",
        "role",
        "is_premium",
        "subscription_status",
        "premium_expires_at",
        "is_blocked",
        "deleted_at"
      )
      .first();

    if (isUserUnavailable(user)) {
      const unavailable = getUnavailableUserError(user);
      return res.status(unavailable.status).json(unavailable.body);
    }

    // Parse interests from JSON string
    if (user.interests && typeof user.interests === "string") {
      try { user.interests = JSON.parse(user.interests); } catch (_) {}
    }

    res.json(shapeUser(user));
  } catch (error) {
    console.error("Me error:", error);
    res.status(500).json({ error: "Failed to get user" });
  }
};

// Update user country
exports.updateCountry = async (req, res) => {
  try {
    const { country } = req.body;

    if (!country) {
      return res.status(400).json({ error: "Country code is required" });
    }

    const [user] = await req.db("users")
      .where({ id: req.userId })
      .update({ country: country.toUpperCase() })
      .returning(["id", "username", "email", "country", "role", "age_group", "interests", "is_premium"]);

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json({ ok: true, user: shapeUser(user) });
  } catch (error) {
    console.error("Update country error:", error);
    res.status(500).json({ error: "Failed to update country" });
  }
};

// Update user profile (age_group, interests, country)
exports.updateProfile = async (req, res) => {
  try {
    const { age_group, interests, country } = req.body;
    const updates = {};

    if (age_group !== undefined) updates.age_group = age_group;
    if (interests !== undefined) updates.interests = JSON.stringify(interests);
    if (country !== undefined) updates.country = country.toUpperCase();

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: "No fields to update" });
    }

    const [user] = await req.db("users")
      .where({ id: req.userId })
      .update(updates)
      .returning(["id", "username", "email", "country", "age_group", "interests", "role", "is_premium"]);

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Parse interests
    if (user.interests && typeof user.interests === "string") {
      try { user.interests = JSON.parse(user.interests); } catch (_) {}
    }

    res.json({ ok: true, user: shapeUser(user) });
  } catch (error) {
    console.error("Update profile error:", error);
    res.status(500).json({ error: "Failed to update profile" });
  }
};

exports.refresh = async (req, res) => {
  try {
    const refreshToken = req.body?.refresh_token;
    if (!refreshToken) {
      return res.status(400).json({ error: "refresh_token required" });
    }

    const existingSession = await findRefreshSession(req.db, refreshToken);
    if (!existingSession) {
      incCounter("auth_failures_total", { reason: "invalid_refresh_token" });
      return res.status(401).json({ error: "invalid_refresh_token" });
    }

    const user = await req.db("users")
      .where({ id: existingSession.user_id })
      .first();

    if (isUserUnavailable(user)) {
      const unavailable = getUnavailableUserError(user);
      return res.status(unavailable.status).json(unavailable.body);
    }

    if (user.interests && typeof user.interests === "string") {
      try { user.interests = JSON.parse(user.interests); } catch (_) {}
    }

    const rotated = await rotateRefreshSession(req.db, existingSession, getRequestMeta(req));
    const token = signToken(user);

    res.json({
      user: shapeUser(user),
      token,
      refresh_token: rotated.refreshToken,
    });
  } catch (error) {
    console.error("Refresh error:", error);
    res.status(500).json({ error: "Failed to refresh session" });
  }
};

exports.logout = async (req, res) => {
  try {
    await revokeRefreshSession(req.db, req.body?.refresh_token);
    res.json({ ok: true });
  } catch (error) {
    console.error("Logout error:", error);
    res.status(500).json({ error: "Failed to logout" });
  }
};

exports.logoutAll = async (req, res) => {
  try {
    await revokeAllUserSessions(req.db, req.userId);
    res.json({ ok: true });
  } catch (error) {
    console.error("Logout all error:", error);
    res.status(500).json({ error: "Failed to logout all sessions" });
  }
};

exports.deleteMe = async (req, res) => {
  try {
    const user = await softDeleteUser(req.db, req.userId, req.userId, "self_delete");
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    await revokeAllUserSessions(req.db, req.userId);
    await revokeUserPushTokens(req.db, req.userId);

    res.json({ ok: true });
  } catch (error) {
    console.error("Delete me error:", error);
    res.status(500).json({ error: "Failed to delete account" });
  }
};

// Auth middleware
exports.authMiddleware = (req, res, next) => {
  return authenticateRequest(req, res, next, { optional: false });
};

exports.optionalAuthMiddleware = (req, res, next) => {
  return authenticateRequest(req, res, next, { optional: true });
};

async function authenticateRequest(req, res, next, { optional }) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    if (optional) {
      return next();
    }
    incCounter("auth_failures_total", { reason: "missing_bearer" });
    return res.status(401).json({ error: "No token provided" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, getJwtSecret());
    const user = await loadAuthenticatedUser(req, decoded.id);
    if (isUserUnavailable(user)) {
      if (optional) {
        return next();
      }
      const unavailable = getUnavailableUserError(user);
      return res.status(unavailable.status).json(unavailable.body);
    }

    req.authUser = user;
    req.userId = user.id;
    req.username = user.username;
    req.userCountry = user.country;
    req.userRole = user.role || "user";
    return next();
  } catch (error) {
    if (optional) {
      return next();
    }
    incCounter("auth_failures_total", { reason: "invalid_access_token" });
    return res.status(401).json({ error: "Invalid token" });
  }
}

exports.requireAdmin = (req, res, next) => {
  if (!req.authUser || req.authUser.role !== "admin") {
    return res.status(403).json({ error: "admin_required" });
  }

  next();
};
