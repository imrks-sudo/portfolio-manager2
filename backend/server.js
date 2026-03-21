const express = require("express");
const cors = require("cors");
const db = require("./db");
const cron = require("node-cron");
const YahooFinance = require("yahoo-finance2").default;
const yahooFinance = new YahooFinance();

const app = express();
app.use(cors());
app.use(express.json());

/**
 * 🔄 PRICE UPDATE (cron)
 */
const updatePrices = () => {
  console.log("Running price update...");

  db.all("SELECT * FROM holdings", async (err, rows) => {
    if (err) return console.log(err);

    for (let row of rows) {
      try {
        const symbol = row.symbol.includes(".")
          ? row.symbol
          : row.symbol + ".NS";

        const quote = await yahooFinance.quote(symbol);

        const currentPrice =
          quote.regularMarketPrice ||
          row.prevClose ||
          row.avgPrice ||
          0;

        db.run(
          `UPDATE holdings SET prevClose = ? WHERE id = ?`,
          [currentPrice, row.id],
          function (err) {
            if (err) {
              console.log("DB update failed:", row.symbol);
            } else {
              console.log("Updated:", row.symbol, currentPrice);
            }
          }
        );
      } catch (e) {
        console.log("Failed for:", row.symbol);
      }
    }
  });
};

// 🕘 Market open
cron.schedule("15 9 * * 1-5", updatePrices);

// 🕞 Market close
cron.schedule("30 15 * * 1-5", updatePrices);

/**
 * ✅ GET PORTFOLIO (FIXED - NO 404)
 */
app.get("/portfolio", (req, res) => {
  db.all("SELECT * FROM holdings", [], (err, rows) => {
    if (err) return res.status(500).json(err);

    const result = rows.map((row) => {
      const currentPrice = row.prevClose || row.avgPrice || 0;
      const investment = row.quantity * row.avgPrice;
      const currentValue = row.quantity * currentPrice;
      const pnl = currentValue - investment;
      const pnlPct = investment ? ((pnl / investment) * 100).toFixed(2) : 0;

      return {
        ...row,
        currentPrice,
        investment,
        currentValue,
        pnl,
        pnlPct,
      };
    });

    res.json(result);
  });
});

/**
 * ✅ UPSERT (INSERT + UPDATE)
 */
app.post("/portfolio", (req, res) => {
  const { symbol, quantity, avgPrice, sector, prevClose, pnl, pnlPct } = req.body;

  console.log("UPSERT:", symbol);

  db.run(
    `INSERT INTO holdings (symbol, quantity, avgPrice, sector, prevClose, pnl, pnlPct)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(symbol) DO UPDATE SET
       quantity = ?,
       avgPrice = ?,
       sector = ?,
       prevClose = ?`,
    [
      symbol,
      Number(quantity),
      Number(avgPrice),
      sector,
      prevClose,
      pnl,
      pnlPct,

      Number(quantity),
      Number(avgPrice),
      sector,
      prevClose,
    ],
    function (err) {
      if (err) {
        console.error("DB ERROR:", err);
        return res.status(500).json(err);
      }
      res.json({ success: true });
    }
  );
});

app.post("/portfolio/replace", (req, res) => {
  const { holdings } = req.body;

  if (!holdings || holdings.length === 0) {
    return res.status(400).json({ error: "No data" });
  }

  const symbols = holdings.map((h) => h.symbol);

  // 🧹 Step 1: Delete missing
  const placeholders = symbols.map(() => "?").join(",");

  db.serialize(() => {
    db.run(
      `DELETE FROM holdings WHERE symbol NOT IN (${placeholders})`,
      symbols,
      (err) => {
        if (err) {
          console.error("Delete error:", err);
          return res.status(500).json(err);
        }
      }
    );

    // 🔁 Step 2: Upsert all
    const stmt = db.prepare(`
      INSERT INTO holdings (symbol, quantity, avgPrice, sector, prevClose)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(symbol) DO UPDATE SET
        quantity = ?,
        avgPrice = ?,
        sector = ?,
        prevClose = ?
    `);

    for (let h of holdings) {
      stmt.run([
        h.symbol,
        Number(h.quantity),
        Number(h.avgPrice),
        h.sector,
        h.prevClose,

        Number(h.quantity),
        Number(h.avgPrice),
        h.sector,
        h.prevClose,
      ]);
    }

    stmt.finalize((err) => {
      if (err) {
        console.error("Upsert error:", err);
        return res.status(500).json(err);
      }

      res.json({ success: true });
    });
  });
});

/**
 * ❌ DELETE
 */
app.delete("/portfolio/:id", (req, res) => {
  db.run("DELETE FROM holdings WHERE id = ?", [req.params.id], function (err) {
    if (err) return res.status(500).json(err);
    res.json({ deleted: this.changes });
  });
});

/**
 * ✏️ UPDATE (manual edit)
 */
app.put("/portfolio/:id", (req, res) => {
  const { quantity, avgPrice } = req.body;

  db.run(
    `UPDATE holdings 
     SET quantity = ?, avgPrice = ? 
     WHERE id = ?`,
    [Number(quantity), Number(avgPrice), req.params.id],
    function (err) {
      if (err) return res.status(500).json(err);
      res.json({ updated: this.changes });
    }
  );
});

/**
 * 🚀 START SERVER
 */
app.listen(5000, () => {
  console.log("Server running on http://localhost:5000");
});