require("dotenv").config();

const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const express = require("express");
const helmet = require("helmet");
const session = require("express-session");
const SQLiteStore = require("connect-sqlite3")(session);
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcryptjs");
const Database = require("better-sqlite3");
const Razorpay = require("razorpay");

const app = express();
const port = Number(process.env.PORT) || 3000;
const isProduction = process.env.NODE_ENV === "production";
if (isProduction) app.set("trust proxy", 1);
const sessionSecret = process.env.SESSION_SECRET;
const frontendOrigins = (process.env.FRONTEND_URL || "")
  .split(",")
  .map((origin) => origin.trim().replace(/\/$/, ""))
  .filter(Boolean);
const dataDir = process.env.DATA_DIR || __dirname;
const razorpayKeyId = process.env.RAZORPAY_KEY_ID;
const razorpayKeySecret = process.env.RAZORPAY_KEY_SECRET;
const razorpay = razorpayKeyId && razorpayKeySecret
  ? new Razorpay({ key_id: razorpayKeyId, key_secret: razorpayKeySecret })
  : null;

if (!sessionSecret || sessionSecret.length < 32) {
  throw new Error("SESSION_SECRET must be set and at least 32 characters long.");
}

fs.mkdirSync(dataDir, { recursive: true });
const database = new Database(path.join(dataDir, "food-with-heath.sqlite"));
database.pragma("journal_mode = WAL");
database.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    items_json TEXT NOT NULL,
    total INTEGER NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
  CREATE TABLE IF NOT EXISTS password_reset_tokens (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
`);
const catalog = new Map([
  ["Green goddess bowl", 399],
  ["Garden crunch salad", 329],
  ["Sunday pomodoro", 449],
  ["Stacked house burger", 429],
  ["Salted caramel cloud", 229],
  ["Peach basil fizz", 169],
  ["Chole Bhature", 249],
  ["Paneer Tikka", 299],
  ["Masala Dosa", 229]
]);

app.use(helmet({ contentSecurityPolicy: false }));
app.use((req, res, next) => {
  const origin = req.headers.origin;
  const isVercelPreview = /^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(origin || "");
  if (origin && (frontendOrigins.includes(origin) || (!frontendOrigins.length && isVercelPreview))) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  }
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});
app.use(express.json({ limit: "20kb" }));
app.use(express.urlencoded({ extended: false }));
app.use(session({
  store: new SQLiteStore({ db: "sessions.sqlite", dir: dataDir }),
  name: "food_with_heath_session",
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: isProduction ? "none" : "lax",
    secure: isProduction,
    maxAge: 1000 * 60 * 60 * 24 * 7
  }
}));
app.use(express.static(__dirname));
app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "first.html"));
});
app.get("/api/health", (_req, res) => res.json({ status: "ok" }));

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true });
const paymentLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true });

function getSafeOrder(items) {
  if (!Array.isArray(items) || !items.length) return null;
  const safeItems = items.map((item) => ({
    name: String(item.name || "").slice(0, 100),
    quantity: Number(item.quantity)
  }));
  if (safeItems.some((item) => !catalog.has(item.name) || !Number.isInteger(item.quantity) || item.quantity < 1)) return null;
  safeItems.forEach((item) => { item.price = catalog.get(item.name); });
  return {
    items: safeItems,
    total: safeItems.reduce((sum, item) => sum + item.price * item.quantity, 0)
  };
}

function requireAuth(req, res, next) {
  if (!req.session.userId && !req.session.demoUser) return res.status(401).json({ error: "You must be logged in." });
  next();
}

function validateCredentials(username, email, password) {
  return typeof username === "string" && username.trim().length >= 2 &&
    typeof email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) &&
    typeof password === "string" && password.length >= 8;
}

function startUserSession(req, res, user, statusCode = 200) {
  req.session.regenerate((sessionError) => {
    if (sessionError) return res.status(500).json({ error: "Unable to start a secure session." });
    req.session.userId = user.id;
    req.session.save((saveError) => {
      if (saveError) return res.status(500).json({ error: "Unable to save the secure session." });
      res.status(statusCode).json({ username: user.username, email: user.email });
    });
  });
}

app.post("/api/auth/register", authLimiter, async (req, res) => {
  const { username, email, password } = req.body;
  if (!validateCredentials(username, email, password)) {
    return res.status(400).json({ error: "Username, valid email, and an 8-character password are required." });
  }
  try {
    const passwordHash = await bcrypt.hash(password, 12);
    const result = database.prepare(
      "INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)"
    ).run(username.trim(), email.trim().toLowerCase(), passwordHash);
    startUserSession(req, res, {
      id: result.lastInsertRowid,
      username: username.trim(),
      email: email.trim().toLowerCase()
    }, 201);
  } catch (error) {
    if (error.code === "SQLITE_CONSTRAINT_UNIQUE") {
      return res.status(409).json({ error: "Username or email is already registered." });
    }
    res.status(500).json({ error: "Unable to create account." });
  }
});

app.post("/api/auth/login", authLimiter, async (req, res) => {
  const { username, email, password } = req.body;
  if (typeof username !== "string" || typeof email !== "string" || typeof password !== "string") {
    return res.status(400).json({ error: "Username, email, and password are required." });
  }
  const user = database.prepare(
    "SELECT id, username, email, password_hash FROM users WHERE username = ? AND email = ?"
  ).get(username.trim(), email.trim().toLowerCase());
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ error: "Invalid username, email, or password." });
  }
  startUserSession(req, res, user);
});

app.post("/api/auth/forgot-password", authLimiter, (req, res) => {
  const email = typeof req.body.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const genericResponse = { message: "If an account uses that email, a password-reset link has been created." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: "Enter a valid email address." });
  }

  database.prepare("DELETE FROM password_reset_tokens WHERE expires_at <= ?").run(Date.now());
  const user = database.prepare("SELECT id FROM users WHERE email = ?").get(email);
  if (!user) return res.json(genericResponse);

  const token = crypto.randomBytes(32).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  database.prepare(
    "INSERT INTO password_reset_tokens (token_hash, user_id, expires_at) VALUES (?, ?, ?)"
  ).run(tokenHash, user.id, Date.now() + 15 * 60 * 1000);

  if (isProduction) return res.json(genericResponse);
  res.json({
    ...genericResponse,
    resetUrl: `${frontendOrigins[0] || `${req.protocol}://${req.get("host")}`}/forgot-password.html?token=${token}`
  });
});

app.post("/api/auth/reset-password", authLimiter, async (req, res) => {
  const token = typeof req.body.token === "string" ? req.body.token : "";
  const password = typeof req.body.password === "string" ? req.body.password : "";
  if (!/^[a-f0-9]{64}$/.test(token) || password.length < 8) {
    return res.status(400).json({ error: "A valid reset link and an 8-character password are required." });
  }

  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const resetToken = database.prepare(
    "SELECT user_id FROM password_reset_tokens WHERE token_hash = ? AND expires_at > ?"
  ).get(tokenHash, Date.now());
  if (!resetToken) return res.status(400).json({ error: "This reset link is invalid or has expired." });

  const passwordHash = await bcrypt.hash(password, 12);
  const updatePassword = database.transaction(() => {
    database.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(passwordHash, resetToken.user_id);
    database.prepare("DELETE FROM password_reset_tokens WHERE token_hash = ?").run(tokenHash);
  });
  updatePassword();
  res.json({ message: "Password changed successfully. You can now log in." });
});

app.post("/api/auth/demo-login", authLimiter, (req, res) => {
  const { username, email } = req.body;
  if (typeof username !== "string" || username.trim().length < 2 ||
      typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: "Username and valid email are required." });
  }
  req.session.regenerate((sessionError) => {
    if (sessionError) return res.status(500).json({ error: "Unable to start a secure session." });
    req.session.userId = null;
    req.session.demoUser = {
      username: username.trim(),
      email: email.trim().toLowerCase()
    };
    res.json(req.session.demoUser);
  });
});

app.post("/api/auth/logout", requireAuth, (req, res) => {
  req.session.destroy((error) => {
    if (error) return res.status(500).json({ error: "Unable to log out." });
    res.clearCookie("food_with_heath_session");
    res.status(204).end();
  });
});

app.get("/api/auth/me", (req, res) => {
  if (req.session.demoUser) return res.json(req.session.demoUser);
  if (!req.session.userId) return res.status(401).json({ error: "Not logged in." });
  const user = database.prepare("SELECT username, email FROM users WHERE id = ?").get(req.session.userId);
  if (!user) return res.status(401).json({ error: "Not logged in." });
  res.json(user);
});

app.post("/api/payments/razorpay/order", requireAuth, paymentLimiter, async (req, res) => {
  if (req.session.demoUser) {
    return res.status(403).json({ error: "Please create an account or log in with a password before checkout." });
  }
  if (!razorpay) return res.status(503).json({ error: "Razorpay is not configured on the server." });
  const safeOrder = getSafeOrder(req.body.items);
  if (!safeOrder) return res.status(400).json({ error: "Invalid order items." });
  try {
    const razorpayOrder = await razorpay.orders.create({
      amount: safeOrder.total * 100,
      currency: "INR",
      receipt: `food-${crypto.randomUUID().slice(0, 24)}`
    });
    res.status(201).json({
      keyId: razorpayKeyId,
      orderId: razorpayOrder.id,
      amount: razorpayOrder.amount,
      currency: razorpayOrder.currency,
      items: safeOrder.items,
      total: safeOrder.total
    });
  } catch (error) {
    console.error("Razorpay order creation failed:", error);
    res.status(502).json({ error: "Unable to start the Razorpay checkout." });
  }
});

app.post("/api/payments/razorpay/verify", requireAuth, paymentLimiter, (req, res) => {
  if (req.session.demoUser) {
    return res.status(403).json({ error: "Please create an account or log in with a password before checkout." });
  }
  const {
    items,
    razorpayOrderId,
    razorpayPaymentId,
    razorpaySignature
  } = req.body;
  const safeOrder = getSafeOrder(items);
  if (!safeOrder || typeof razorpayOrderId !== "string" || typeof razorpayPaymentId !== "string" || typeof razorpaySignature !== "string") {
    return res.status(400).json({ error: "Incomplete Razorpay payment details." });
  }
  const expectedSignature = crypto
    .createHmac("sha256", razorpayKeySecret || "")
    .update(`${razorpayOrderId}|${razorpayPaymentId}`)
    .digest("hex");
  const expectedBuffer = Buffer.from(expectedSignature);
  const signatureBuffer = Buffer.from(razorpaySignature);
  if (expectedBuffer.length !== signatureBuffer.length || !crypto.timingSafeEqual(expectedBuffer, signatureBuffer)) {
    return res.status(400).json({ error: "Razorpay payment verification failed." });
  }
  const orderId = crypto.randomUUID();
  database.prepare(
    "INSERT INTO orders (id, user_id, items_json, total, status) VALUES (?, ?, ?, ?, ?)"
  ).run(orderId, req.session.userId, JSON.stringify(safeOrder.items), safeOrder.total, `paid-razorpay:${razorpayPaymentId}`);
  res.status(201).json({ orderId, items: safeOrder.items, total: safeOrder.total, status: "paid" });
});

app.post("/api/orders", requireAuth, paymentLimiter, (req, res) => {
  if (req.session.demoUser) {
    return res.status(403).json({ error: "Please create an account or log in with a password before checkout." });
  }
  const { items, paymentToken } = req.body;
  if (!Array.isArray(items) || !items.length || typeof paymentToken !== "string" || !/^demo_[a-f0-9-]{36}$/.test(paymentToken)) {
    return res.status(400).json({ error: "A non-empty order and valid payment token are required." });
  }
  const safeOrder = getSafeOrder(items);
  if (!safeOrder) {
    return res.status(400).json({ error: "Invalid order items." });
  }
  const orderId = crypto.randomUUID();
  database.prepare(
    "INSERT INTO orders (id, user_id, items_json, total, status) VALUES (?, ?, ?, ?, ?)"
  ).run(orderId, req.session.userId, JSON.stringify(safeOrder.items), safeOrder.total, "paid-demo");
  res.status(201).json({ orderId, items: safeOrder.items, total: safeOrder.total, status: "paid-demo" });
});

app.listen(port, () => {
  console.log(`Food with Heath is running at http://localhost:${port}`);
});
