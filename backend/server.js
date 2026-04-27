const PORT = process.env.PORT || 5000;
const API_KEY = process.env.API_KEY;

const express = require("express");
const cors = require("cors");
const axios = require("axios");
const cron = require("node-cron");

// 🧠 In-memory events store
let EVENTS = [];

const app = express();
app.set("trust proxy", 1); // if behind a proxy (e.g. Vercel)
app.use(cors({
  origin: function (origin, callback) {
    const allowed = [
      "https://myportfoliomanager.vercel.app",
      "http://localhost:5173"
    ];

    if (!origin || allowed.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type", "x-api-key"],
}));

const rateLimit = require("express-rate-limit");

const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 min
  max: 20, // max 20 requests/min
});

app.use(limiter);

app.use(express.json());

// 🔐 API KEY PROTECTION
app.use((req, res, next) => {
  const key = req.headers["x-api-key"];

  if (!API_KEY) {
    console.warn("⚠️ API_KEY not set in environment");
    return next(); // fallback (optional)
  }

  if (!key || key !== API_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  next();
});


const { wrapper } = require("axios-cookiejar-support");
const tough = require("tough-cookie");

// ✅ Create cookie jar
const jar = new tough.CookieJar();

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
        let change = 0;
        let pChange = 0;
        let high52 = 0;
        let low52 = 0;
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

          let response;

try {
  response = await nse.get(
    `/api/quote-equity?symbol=${encodeURIComponent(symbol)}`
  );
} catch (err) {
  console.log("⚠️ NSE retry for", symbol);

  // retry cookie + request
  await nse.get("/");
  response = await nse.get(
    `/api/quote-equity?symbol=${encodeURIComponent(symbol)}`
  );
}

price = Number(response.data?.priceInfo?.lastPrice) || 0;

const whl = response.data?.priceInfo?.weekHighLow || {};

high52 = Number(whl.max) || 0;
low52 = Number(whl.min) || 0;

change =
  Number(response.data?.priceInfo?.change) || 0;

pChange =
  Number(response.data?.priceInfo?.pChange) || 0;

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
  change: change || 0,
  pChange: pChange || 0,
  high52,
  low52,
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

// 🔔 FETCH CORPORATE EVENTS FROM NSE
const fetchCorporateActions = async () => {
  try {
    console.log("📡 Fetching NSE corporate announcements...");

    const nse = axios.create({
      baseURL: "https://www.nseindia.com",
      headers: {
        "User-Agent": "Mozilla/5.0",
        Accept: "application/json",
        Referer: "https://www.nseindia.com/",
      },
      timeout: 5000,
    });

    // ✅ IMPORTANT: init cookies
    try {
      await nse.get("/");
    } catch {
      console.log("⚠️ NSE cookie init failed (events)");
    }

    const res = await nse.get(
      "/api/corporate-announcements?index=equities"
    );

    const data = res.data || [];
    const now = new Date();

// 🔥 helper: clean title
const getCleanTitle = (type) => {
  switch (type) {
    case "DIVIDEND":
      return "Dividend declared";
    case "RESULT":
      return "Results announced";
    case "MEETING":
      return "Board meeting update";
    case "RECORD":
      return "Record date announced";
    case "MERGER":
      return "Merger update";
    case "DEMERGER":
      return "Demerger update";
    case "ACQUISITION":
      return "Acquisition update";
    default:
      return "Corporate update";
  }
};

// 🔥 helper: extract record date
const extractRecordDate = (text) => {
  const match = text.match(/(\d{1,2}-[A-Za-z]{3}-\d{4})/);
  return match ? match[1] : null;
};

// 🔥 STEP 1: Normalize + classify
const parsed = data.map((item) => {
  const rawTitle =
    item.attchmntText ||
    item.desc ||
    "";

  const symbol = item.symbol || "";
  const t = rawTitle.toLowerCase();

  let type = "OTHER";

  if (t.includes("dividend")) type = "DIVIDEND";
  else if (t.includes("result")) type = "RESULT";
  else if (t.includes("board meeting")) type = "MEETING";
  else if (t.includes("record date")) type = "RECORD";
  else if (t.includes("merger")) type = "MERGER";
  else if (t.includes("demerger")) type = "DEMERGER";
  else if (
    t.includes("acquisition") &&
    (
      t.includes("acquired") ||
      t.includes("acquisition of") ||
      t.includes("completion of acquisition")
    )
  ) {
    type = "ACQUISITION";
  }

  const date = item.sort_date
    ? item.sort_date.split(" ")[0]
    : null;

  const recordDate = extractRecordDate(rawTitle);

  return {
    symbol,
    type,
    title: getCleanTitle(type), // 🔥 cleaned
    rawTitle, // keep original if needed later
    recordDate, // 🔥 extracted
    date,
  };
});

// 🔥 STEP 2: keep only meaningful
const meaningful = parsed.filter((e) => e.type !== "OTHER");

// 🔥 STEP 3: better dedup (symbol + type + date)
const map = new Map();

meaningful.forEach((e) => {
  const key = `${e.symbol}_${e.type}_${e.date}`;
  map.set(key, e);
});

const unique = Array.from(map.values());

// 🔥 STEP 4: classify into buckets
const active = [];
const archive = [];

unique.forEach((e) => {
  if (!e.date) return;

  const diff =
    (now - new Date(e.date)) / (1000 * 60 * 60 * 24);

  if (diff >= 0 && diff <= 7) {
    active.push(e);
  } else if (diff > 7 && diff <= 30) {
    archive.push(e);
  }
});

// 🔥 STEP 5: store
EVENTS = {
  active: active.slice(0, 20),
  archive: archive.slice(0, 50),
};

    console.log(
      `✅ Events updated: active=${EVENTS.active.length}, archive=${EVENTS.archive.length}`
    );
  } catch (err) {
    console.error("❌ Events fetch failed:", err.message);
  }
};

// ⏰ Run at 9 AM
cron.schedule("0 9 * * *", fetchCorporateActions);

// ⏰ Run at 6 PM
cron.schedule("0 18 * * *", fetchCorporateActions);

// 🚀 Run once on server start
fetchCorporateActions();

app.get("/api/events", (req, res) => {
  res.json({
    success: true,
    active: EVENTS.active || [],
    archive: EVENTS.archive || [],
  });
});

/**
 * 🚀 START SERVER
 */


app.listen(PORT, () => {
  console.log("Server running on", PORT);
});