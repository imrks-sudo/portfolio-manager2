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

// Create table
db.serialize(() => {
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
      pnlPct REAL
    )
  `,
    (err) => {
      if (err) {
        console.error("❌ Table creation failed:", err.message);
      } else {
        console.log("✅ Holdings table ready");
      }
    }
  );
});

module.exports = db;