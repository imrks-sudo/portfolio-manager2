const sqlite3 = require("sqlite3").verbose();

// Create / connect DB
const db = new sqlite3.Database("portfolio.db", (err) => {
  if (err) {
    console.error("❌ DB Connection Error:", err.message);
  } else {
    console.log("✅ Connected to SQLite DB");
  }
});

// Improve performance
db.exec("PRAGMA journal_mode = WAL;");

// Create tables
db.serialize(() => {
  // ✅ Holdings table
  db.run(
    `
    CREATE TABLE IF NOT EXISTS holdings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol TEXT UNIQUE,
      sector TEXT,
      quantity REAL,
      avgPrice REAL,
      prevClose REAL,
      pnl REAL,
      pnlPct REAL,
      lastUpdated TEXT   -- 🔥 NEW (for caching)
    )
  `,
    (err) => {
      if (err) {
        console.error("❌ Holdings table creation failed:", err.message);
      } else {
        console.log("✅ Holdings table ready");
      }
    }
  );

  // ✅ Add column safely if not exists (for existing DBs)
  db.run(
    `ALTER TABLE holdings ADD COLUMN lastUpdated TEXT`,
    () => {} // ignore error if already exists
  );

  // ✅ Portfolio history table (NEW)
  db.run(
    `
    CREATE TABLE IF NOT EXISTS portfolio_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT,
      totalValue REAL
    )
  `,
    (err) => {
      if (err) {
        console.error("❌ History table creation failed:", err.message);
      } else {
        console.log("✅ Portfolio history table ready");
      }
    }
  );
});

module.exports = db;