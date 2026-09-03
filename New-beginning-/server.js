require("dotenv").config();

const path = require("path");
const crypto = require("crypto");
const express = require("express");
const helmet = require("helmet");
const session = require("express-session");
const SQLiteStore = require("connect-sqlite3")(session);
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcryptjs");
const Database = require("better-sqlite3");

const app = express();
const port = Number(process.env.PORT) || 3000;
const isProduction = process.env.NODE_ENV === "production";
const sessionSecret = process.env.SESSION_SECRET;

if (!sessionSecret || sessionSecret.length < 32) {
  throw new Error("SESSION_SECRET must be set and at least 32 characters long.");
}

const database = new Database(path.join(__dirname, "food-with-heath.sqlite"));
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
`);
const catalog = new Map([
  ["Green goddess bowl", 399],
  ["Garden crunch salad", 329],
  ["Sunday pomodoro", 449],
  ["Stacked house burger", 429],
  ["Salted caramel cloud", 229],
  ["Peach basil fizz", 169]
]);

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "20kb" }));
app.use(express.urlencoded({ extended: false }));
app.use(session({
  store: new SQLiteStore({ db: "sessions.sqlite", dir: __dirname }),
  name: "food_with_heath_session",
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: isProduction,
    maxAge: 1000 * 60 * 60 * 24 * 7
  }
}));
app.use(express.static(__dirname));
app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "first.html"));
});

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true });
const paymentLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true });

function requireAuth(req, res, next) {
  if (!req.session.userId && !req.session.demoUser) return res.status(401).json({ error: "You must be logged in." });
  next();
}

function validateCredentials(username, email, password) {
  return typeof username === "string" && username.trim().length >= 2 &&
    typeof email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) &&
    typeof password === "string" && password.length >= 8;
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
    req.session.regenerate((sessionError) => {
      if (sessionError) return res.status(500).json({ error: "Unable to start a secure session." });
      req.session.userId = result.lastInsertRowid;
      res.status(201).json({ username: username.trim(), email: email.trim().toLowerCase() });
    });
  } catch (error) {
    if (error.code === "SQLITE_CONSTRAINT_UNIQUE") {
      return res.status(409).json({ error: "Username or email is already registered." });
    }
    res.status(500).json({ error: "Unable to create account." });
  }
});

app.post("/api/auth/login", authLimiter, async (req, res) => {
  const { username, email, password } = req.body;
  const user = database.prepare(
    "SELECT id, username, email, password_hash FROM users WHERE username = ? AND email = ?"
  ).get(username?.trim(), email?.trim().toLowerCase());
  if (!user || !(await bcrypt.compare(password || "", user.password_hash))) {
    return res.status(401).json({ error: "Invalid username, email, or password." });
  }
  req.session.regenerate((sessionError) => {
    if (sessionError) return res.status(500).json({ error: "Unable to start a secure session." });
    req.session.userId = user.id;
    res.json({ username: user.username, email: user.email });
  });
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

app.post("/api/orders", requireAuth, paymentLimiter, (req, res) => {
  const { items, paymentToken } = req.body;
  if (!Array.isArray(items) || !items.length || typeof paymentToken !== "string" || !/^demo_[a-f0-9-]{36}$/.test(paymentToken)) {
    return res.status(400).json({ error: "A non-empty order and valid payment token are required." });
  }
  const safeItems = items.map((item) => ({
    name: String(item.name || "").slice(0, 100),
    quantity: Number(item.quantity)
  }));
  if (safeItems.some((item) => !catalog.has(item.name) || !Number.isInteger(item.quantity) || item.quantity < 1)) {
    return res.status(400).json({ error: "Invalid order items." });
  }
  safeItems.forEach((item) => { item.price = catalog.get(item.name); });
  const total = safeItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const orderId = crypto.randomUUID();
  database.prepare(
    "INSERT INTO orders (id, user_id, items_json, total, status) VALUES (?, ?, ?, ?, ?)"
  ).run(orderId, req.session.userId, JSON.stringify(safeItems), total, "paid-demo");
  res.status(201).json({ orderId, items: safeItems, total, status: "paid-demo" });
});

app.listen(port, () => {
  console.log(`Food with Heath is running at http://localhost:${port}`);
});
