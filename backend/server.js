const fetch = require("node-fetch");
global.fetch = fetch;
const express = require("express");
const cors = require("cors");
const db = require("./db");
const axios = require("axios");
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
        const symbol = row.symbol.trim().toUpperCase() + ".NS";

        const quote = await yahooFinance.quote(symbol);

        const currentPrice =
          quote.regularMarketPrice ||
          row.prevClose ||
          row.avgPrice ||
          0;

        db.run(
          `UPDATE holdings SET prevClose = ? WHERE id = ?`,
          [currentPrice, row.id]
        );

        console.log("Updated:", row.symbol, currentPrice);

        // ✅ ADD THIS DELAY
        await new Promise((r) => setTimeout(r, 500));

      } catch (e) {
        console.log("Failed for:", row.symbol);
        console.log("Error:", e.message);
      }
    }
  });
};

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
 * 🔄 MANUAL PRICE UPDATE
 */
app.get("/prices/update", async (req, res) => {
  console.log("Manual price update...");

  try {
    const rows = await new Promise((resolve, reject) => {
      db.all("SELECT * FROM holdings", (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });

    const delay = (ms) => new Promise((r) => setTimeout(r, ms));
    const chunkSize = 2; // 🔥 small batches to avoid rate limit

  for (let row of rows) {
  try {
    let currentPrice = 0;

    if (isMutualFund(row.symbol)) {
      currentPrice = await getMFNAV(row.symbol);
    } else {
      currentPrice = await getNSEPrice(row.symbol);
    }

    console.log("Updating:", row.symbol, currentPrice);

    await new Promise((resolve, reject) => {
      db.run(
        `UPDATE holdings SET prevClose = ? WHERE id = ?`,
        [currentPrice, row.id],
        (err) => (err ? reject(err) : resolve())
      );
    });

    await new Promise((r) => setTimeout(r, 500));

  } catch (e) {
    console.log("❌ Failed:", row.symbol, e.message);
  }
}

    // ✅ ONLY ONE RESPONSE
    res.json({ success: true });

  } catch (err) {
    console.error("Update error:", err);
    res.status(500).json(err);
  }
});

async function getNSEPrice(symbol) {
  try {
    const url = `https://www.nseindia.com/api/quote-equity?symbol=${symbol}`;

    const response = await axios.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        Accept: "application/json",
        Referer: "https://www.nseindia.com/",
      },
    });

    return response.data?.priceInfo?.lastPrice || 0;
  } catch (err) {
    console.log("NSE failed for:", symbol);
    return 0;
  }
}

async function getMFNAV(symbol) {
  try {
    const url = "https://api.mfapi.in/mf/search?q=" + encodeURIComponent(symbol);
    const search = await axios.get(url);

    if (!search.data || search.data.length === 0) return 0;

    const schemeCode = search.data[0].schemeCode;

    const navRes = await axios.get(
      `https://api.mfapi.in/mf/${schemeCode}`
    );

    return Number(navRes.data?.data?.[0]?.nav) || 0;
  } catch (err) {
    console.log("MF NAV failed:", symbol);
    return 0;
  }
}

function isMutualFund(symbol) {
  const s = symbol.toLowerCase();
  return (
    s.includes("fund") ||
    s.includes("plan") ||
    s.includes("etf")
  );
}
/**
 * 🚀 START SERVER
 */
app.listen(5000, () => {
  console.log("Server running on http://localhost:5000");
});