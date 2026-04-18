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
 * ✅ GET PORTFOLIO
 */
app.get("/portfolio", (req, res) => {
  db.all("SELECT * FROM holdings", [], (err, rows) => {
    if (err) return res.status(500).json(err);

    const result = rows.map((row) => {
      const quantity = Number(row.quantity) || 0;
      const avgPrice = Number(row.avgPrice) || 0;
      const currentPrice = Number(row.prevClose) || avgPrice;

      const investment = quantity * avgPrice;
      const currentValue = quantity * currentPrice;
      const pnl = currentValue - investment;
      const pnlPct = investment ? (pnl / investment) * 100 : 0;

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
 * ✅ UPSERT
 */
app.post("/portfolio", (req, res) => {
  const { symbol, quantity, avgPrice, sector, prevClose } = req.body;

  const safePrevClose = Number(prevClose) || Number(avgPrice) || 0;

  db.run(
    `INSERT INTO holdings (symbol, quantity, avgPrice, sector, prevClose)
     VALUES (?, ?, ?, ?, ?)
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
      safePrevClose,

      Number(quantity),
      Number(avgPrice),
      sector,
      safePrevClose,
    ],
    function (err) {
      if (err) return res.status(500).json(err);
      res.json({ success: true });
    }
  );
});

/**
 * 🔁 BULK UPSERT
 */
app.post("/portfolio/replace", (req, res) => {
  const { holdings } = req.body;

  if (!holdings || holdings.length === 0) {
    return res.status(400).json({ error: "No data" });
  }

  db.serialize(() => {
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
      const safePrevClose = Number(h.prevClose) || Number(h.avgPrice) || 0;

      stmt.run([
        h.symbol,
        Number(h.quantity),
        Number(h.avgPrice),
        h.sector,
        safePrevClose,

        Number(h.quantity),
        Number(h.avgPrice),
        h.sector,
        safePrevClose,
      ]);
    }

    stmt.finalize((err) => {
      if (err) return res.status(500).json(err);
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
 * ✏️ UPDATE
 */
app.put("/portfolio/:id", (req, res) => {
  const { quantity, avgPrice } = req.body;

  db.run(
    `UPDATE holdings SET quantity = ?, avgPrice = ? WHERE id = ?`,
    [Number(quantity), Number(avgPrice), req.params.id],
    function (err) {
      if (err) return res.status(500).json(err);
      res.json({ updated: this.changes });
    }
  );
});

/**
 * 🔄 PRICE UPDATE (IMPROVED)
 */
app.get("/prices/update", async (req, res) => {
  console.log("Manual price update...");

  db.all("SELECT * FROM holdings", async (err, rows) => {
    if (err) return res.status(500).json(err);

    try {
      let successCount = 0;

      // ✅ NSE instance (FIX: cookie handling)
      const nse = axios.create({
        baseURL: "https://www.nseindia.com",
        headers: {
          "User-Agent": "Mozilla/5.0",
          Accept: "application/json",
          Referer: "https://www.nseindia.com/",
        },
        timeout: 5000,
      });

      // ✅ Initialize NSE cookies (CRITICAL FIX)
      try {
        await nse.get("/");
      } catch (e) {
        console.log("⚠️ NSE cookie init failed");
      }

      for (const row of rows) {
        try {
          let symbol = row.symbol;
          let price = 0;

          const s = symbol.toLowerCase();

          console.log("📡 Fetching:", symbol);

          // 🟢 MUTUAL FUND (UNCHANGED LOGIC)
          if (s.includes("fund") || s.includes("plan")) {
            const search = await axios.get(
              "https://api.mfapi.in/mf/search?q=" +
                encodeURIComponent(symbol)
            );

            if (!search.data?.length) {
              console.log("⚠️ MF not found:", symbol);
              continue;
            }

            const schemeCode = search.data[0].schemeCode;

            const navRes = await axios.get(
              `https://api.mfapi.in/mf/${schemeCode}`
            );

            price = Number(navRes.data?.data?.[0]?.nav) || 0;
          } else {
            // ✅ ETF fix (UNCHANGED)
            if (symbol.endsWith("-E")) symbol = symbol.replace("-E", "");

            // ✅ SGB fix (UNCHANGED)
            if (symbol.endsWith("-GB")) symbol = symbol.replace("-GB", "");

            // ✅ NSE call (FIXED: using instance)
            const response = await nse.get(
              `/api/quote-equity?symbol=${symbol}`
            );

            price = Number(response.data?.priceInfo?.lastPrice) || 0;
          }

          if (!price) {
            console.log("⚠️ No price for:", symbol);
            continue;
          }

          console.log("✅ Price:", symbol, price);

          db.run(
            `UPDATE holdings SET prevClose=?, lastUpdated=datetime('now') WHERE id=?`,
            [price, row.id]
          );

          successCount++;

          // ✅ Delay (prevents NSE blocking)
          await new Promise((r) => setTimeout(r, 300));

        } catch (err) {
          console.log(`❌ Failed: ${row.symbol}`, err.message);
        }
      }

      // ✅ Save history (UNCHANGED)
      db.all("SELECT * FROM holdings", [], (err, updatedRows) => {
        if (!err) {
          const totalValue = updatedRows.reduce((sum, r) => {
            const price = Number(r.prevClose) || Number(r.avgPrice) || 0;
            return sum + Number(r.quantity) * price;
          }, 0);

          db.run(
            `INSERT INTO portfolio_history (date, totalValue) VALUES (?, ?)`,
            [new Date().toISOString().split("T")[0], totalValue]
          );
        }
      });

      res.json({
        success: true,
        updated: successCount,
      });

    } catch (err) {
      console.error("Update error:", err);
      res.status(500).json(err);
    }
  });
});

/**
 * 📊 HISTORY API
 */
app.get("/portfolio/history", (req, res) => {
  db.all(
    "SELECT date, totalValue FROM portfolio_history ORDER BY date",
    [],
    (err, rows) => {
      if (err) return res.status(500).json(err);
      res.json(rows);
    }
  );
});

const { wrapper } = require("axios-cookiejar-support");
const tough = require("tough-cookie");

// ✅ Create cookie jar
const jar = new tough.CookieJar();

// ✅ Wrap axios
const client = wrapper(
  axios.create({
    jar,
    withCredentials: true,
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
      Accept: "application/json, text/plain, */*",
      Referer: "https://www.nseindia.com/",
      "Accept-Language": "en-US,en;q=0.9",
      Connection: "keep-alive",
    },
  })
);

app.post("/update-prices", async (req, res) => {
  try {
    const { symbols } = req.body;

    if (!symbols || !Array.isArray(symbols)) {
      return res.status(400).json({ error: "Invalid symbols" });
    }

    const results = [];
    let successCount = 0;

    // ✅ NSE instance (same as working GET)
    const nse = axios.create({
      baseURL: "https://www.nseindia.com",
      headers: {
        "User-Agent": "Mozilla/5.0",
        Accept: "application/json",
        Referer: "https://www.nseindia.com/",
      },
      timeout: 5000,
    });

    // ✅ Init cookies (CRITICAL)
    try {
      await nse.get("/");
    } catch {
      console.log("⚠️ NSE cookie init failed");
    }

    for (const symbolRaw of symbols) {
      try {
        let symbol = symbolRaw;
        let price = 0;

        const s = symbol.toLowerCase();

        console.log(
  `%c━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
  "color: #374151"
);

        // =========================
        // 🟣 MUTUAL FUND (SAME AS YOUR WORKING CODE)
        // =========================
        if (s.includes("fund") || s.includes("plan")) {

          const search = await axios.get(
  "https://api.mfapi.in/mf/search?q=" +
    encodeURIComponent(symbol)
);

if (!search.data?.length) {
  console.log(`❌ MF not found: ${symbol}`);
  continue;
}

// 🔥 NORMALIZE FUNCTION
const normalize = (str) =>
  str
    .toLowerCase()
    .replace(/direct|growth|regular|plan|fund|-/g, "")
    .replace(/\s+/g, "")
    .trim();

// 🔥 FIND BEST MATCH
const target = normalize(symbol);

let bestMatch = search.data.find((s) =>
  normalize(s.schemeName).includes(target)
);

// fallback → partial match
if (!bestMatch) {
  bestMatch = search.data.find((s) =>
    target.includes(normalize(s.schemeName))
  );
}

// fallback → first
if (!bestMatch) {
  bestMatch = search.data[0];
}

const schemeCode = bestMatch.schemeCode;

          const navRes = await axios.get(
            `https://api.mfapi.in/mf/${schemeCode}`
          );

          const nav = navRes.data?.data?.[0]?.nav;

          price = Number(nav) || 0;

          console.log(
  `%c${symbol} → ₹${price}`,
  "color: #a855f7; font-weight: bold;"
);

          if (!price) {
            console.log(
              `%c⚠️ No NAV for: ${symbol}`,
              "color: #f59e0b; font-weight: bold;"
            );
            continue;
          }
        }

        // =========================
        // 🟢 STOCK / ETF / SGB
        // =========================
        else {
          if (symbol.endsWith("-E")) symbol = symbol.replace("-E", "");
          if (symbol.endsWith("-GB")) symbol = symbol.replace("-GB", "");

          const response = await nse.get(
            `/api/quote-equity?symbol=${encodeURIComponent(symbol)}`
          );

          price = Number(response.data?.priceInfo?.lastPrice) || 0;

          console.log(
  `%c${symbol} → ₹${price}`,
  "color: #22c55e; font-weight: bold;"
);

          if (!price) {
            console.log(
              `%c⚠️ No price for: ${symbol}`,
              "color: #f59e0b; font-weight: bold;"
            );
            continue;
          }
        }

        // ✅ PUSH RESULT (instead of DB update)
        results.push({
          symbol: symbolRaw,
          currentPrice: price,
        });

        successCount++;

        // ✅ Delay (same as your working code)
        await new Promise((r) => setTimeout(r, 300));

      } catch (err) {
        console.log(
          `%c❌ Failed: ${symbolRaw}`,
          "color: #ef4444; font-weight: bold;",
          err.message
        );
      }
    }

    res.json({
      success: true,
      updated: successCount,
      data: results,
    });

  } catch (err) {
    console.error("Update error:", err);
    res.status(500).json({ error: "Price update failed" });
  }
});

/**
 * 🚀 START SERVER
 */
app.listen(5000, () => {
  console.log("Server running on http://localhost:5000");
});