const PORT = process.env.PORT || 5000;
const API_KEY = process.env.API_KEY;
const fs = require("fs");
const path = require("path");
const CACHE_FILE = path.join(__dirname, "mf-cache.json");

// ✅ FIX: Persist events to disk (survives server restarts + Render sleep)
const EVENTS_CACHE_FILE = path.join(__dirname, "events-cache.json");

const express = require("express");
const cors = require("cors");
const axios = require("axios");
const cron = require("node-cron");
const rateLimit = require("express-rate-limit");

// 🧠 In-memory events store
// ✅ FIX: Initialize as proper object (was `[]` which broke EVENTS.active/.archive reads)
let EVENTS = { active: [], archive: [] };
let MF_LIST = [];

// ✅ FIX: Load events from disk on startup so they survive restarts
const loadEventsCache = () => {
  try {
    if (fs.existsSync(EVENTS_CACHE_FILE)) {
      const raw = fs.readFileSync(EVENTS_CACHE_FILE, "utf-8");
      const parsed = JSON.parse(raw);
      // Validate shape before using
      if (parsed && Array.isArray(parsed.active) && Array.isArray(parsed.archive)) {
        EVENTS = {
  active: parsed.active || [],
  archive: parsed.archive || [],
};
        if (parsed.lastFetchTime) {
  lastFetchTime = parsed.lastFetchTime;
}
        console.log(
          `⚡ Loaded events cache: active=${EVENTS.active.length}, archive=${EVENTS.archive.length}`
        );
      }
    }
  } catch (err) {
    console.error("⚠️ Failed to load events cache:", err.message);
    EVENTS = { active: [], archive: [] };
  }
};

// ✅ FIX: Write events to disk after every update
const saveEventsCache = () => {
  try {
    fs.writeFileSync(
      EVENTS_CACHE_FILE,
      JSON.stringify(
        {
          ...EVENTS,
          lastFetchTime,
        },
        null,
        2
      )
    );
  } catch (err) {
    console.error(
      "⚠️ Failed to save events cache:",
      err.message
    );
  }
};

const normalizeSymbol = (symbol) =>
  (symbol || "")
    .toUpperCase()
    .replace(/-E$/, "")
    .replace(/-GB$/, "")
    .trim();

// 🔔 FETCH AMFI DATA
const fetchAMFI = async () => {
  try {
    console.log("📡 Fetching AMFI data...");

    const url = "https://www.amfiindia.com/spages/NAVAll.txt";

    let res;

    // 🔁 RETRY LOGIC (fixes partial download)
    for (let i = 0; i < 3; i++) {
      try {
        res = await axios.get(url, {
          headers: {
            "User-Agent": "Mozilla/5.0",
            Accept: "text/plain",
            Referer: "https://www.amfiindia.com/",
          },
          timeout: 15000,
        });

        // 🔥 sanity check (full file is large)
        if (res.data && res.data.length > 500000) {
          break;
        }

        console.log("⚠️ Incomplete AMFI response, retrying...");
      } catch (err) {
        console.log("⚠️ AMFI fetch retry:", i + 1);
      }
    }

    if (!res || !res.data) {
      throw new Error("AMFI fetch failed");
    }

    const lines = res.data.split("\n");

    console.log("📊 AMFI lines:", lines.length);

    const list = [];

    const cleanLine = (line) => line.replace(/^\uFEFF/, "");

    lines.forEach((line) => {
      const safeLine = cleanLine(line);

      if (!safeLine || safeLine.includes("Scheme Code")) return;

      const parts = safeLine.split(";");

      const code = parts[0]?.trim();
      const name = parts[3]?.trim();
      const nav = parseFloat(parts[4]);

      if (code && name && !isNaN(nav)) {
        list.push({
          code,
          name,
          nav,
        });
      }
    });

    console.log("✅ Parsed MF count:", list.length);

  if (list.length > MF_LIST.length && list.length > 5000) {
  console.log("✅ AMFI refreshed:", list.length);

  MF_LIST = list;

  fs.writeFileSync(
    CACHE_FILE,
    JSON.stringify(list, null, 2)
  );

  console.log(`✅ AMFI loaded: ${MF_LIST.length}`);
} else {
  console.log("⚠️ Skipping update (partial data)");
}

  } catch (err) {
    console.error("❌ AMFI fetch failed:", err.message);

    if (fs.existsSync(CACHE_FILE)) {
      console.log("⚠️ Loading MF from cache");

      const data = fs.readFileSync(CACHE_FILE, "utf-8");
      MF_LIST = JSON.parse(data);
    }
  }
};

const app = express();
app.set("trust proxy", 1);

// 🔐 Allowed origins (PRODUCTION + DEV)
const allowed = [
  "https://watchmyfolio.com",
  "https://www.watchmyfolio.com",
  "http://localhost:5173"
];

// ✅ CORS CONFIG
app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);

    if (allowed.includes(origin)) {
      callback(null, true);
    } else {
      console.error("❌ CORS blocked:", origin);
      callback(new Error("Not allowed by CORS"));
    }
  },
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type", "x-api-key"],
  credentials: false
}));

// 🚦 RATE LIMITING
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(limiter);

// 📦 BODY PARSER
app.use(express.json());

const { wrapper } = require("axios-cookiejar-support");
const tough = require("tough-cookie");

const jar = new tough.CookieJar();

// 🔧 NORMALIZE
const matchMF = (input) => {
  if (!MF_LIST.length) {
    console.error("❌ MF_LIST empty");
    return { type: "invalid" };
  }

  const normalize = (str) =>
    (str || "")
      .toLowerCase()
      .replace(/fund|plan|growth|direct|regular|idcw/gi, "")
      .replace(/[^a-z0-9]/g, "")
      .trim();

  const cleanInput = normalize(input);

  const inputWords = cleanInput.split(" ").filter(w => w.length > 2);

  const matches = MF_LIST
    .filter((mf) => {
      const normName = normalize(mf.name);

      const matchCount = inputWords.filter(w =>
        normName.includes(w)
      ).length;

      return matchCount >= Math.min(2, inputWords.length);
    })
    .map((mf) => {
      const normName = normalize(mf.name);
      const nameLower = mf.name.toLowerCase();

      let score = 0;

      const matchCount = inputWords.filter(w =>
        normName.includes(w)
      ).length;

      score += matchCount * 5;

      if (normName.includes(cleanInput)) score += 10;
      if (normName.startsWith(cleanInput)) score += 5;

      if (nameLower.includes("direct")) score += 2;
      if (nameLower.includes("growth")) score += 1;
      if (nameLower.includes("regular")) score -= 1;

      return { ...mf, score };
    })
    .sort((a, b) => b.score - a.score);

  const seen = new Set();
  const uniqueMatches = [];

  for (const m of matches) {
    const key = normalize(m.name)
      .replace(/direct|growth|regular|idcw/g, "");

    if (!seen.has(key)) {
      seen.add(key);
      uniqueMatches.push(m);
    }
  }

  if (uniqueMatches.length === 1) {
    return { type: "valid", match: uniqueMatches[0] };
  }

  if (uniqueMatches.length > 1) {
    return {
      type: "suggest",
      matches: uniqueMatches.slice(0, 5),
    };
  }

  return { type: "invalid" };
};

const fetchMFAPI = async () => {
  try {
    console.log("📡 Fetching MF list from MFAPI...");

    const res = await axios.get("https://api.mfapi.in/mf", {
      timeout: 15000,
    });

    if (!Array.isArray(res.data) || res.data.length === 0) {
      throw new Error("Invalid MFAPI response");
    }

    const list = res.data.map((mf) => ({
      code: mf.schemeCode,
      name: mf.schemeName,
      nav: null,
    }));

    if (list.length < 5000) {
      console.log("⚠️ Skipping MFAPI update (too small dataset)");
      return;
    }

    if (list.length > MF_LIST.length) {
      MF_LIST = list;

      fs.writeFileSync(
        CACHE_FILE,
        JSON.stringify(list, null, 2)
      );

      console.log("💾 MF cache updated from MFAPI");
    } else {
      console.log("⚠️ Skipping update (no improvement)");
    }

  } catch (err) {
    console.error("❌ MFAPI fetch failed:", err.message);
  }
};

app.post("/update-prices", async (req, res) => {
  try {
    const { symbols } = req.body;

    if (!symbols || !Array.isArray(symbols)) {
      return res.status(400).json({ error: "Invalid symbols" });
    }

    const results = [];
    let successCount = 0;

    const nse = axios.create({
      baseURL: "https://www.nseindia.com",
      headers: {
        "User-Agent": "Mozilla/5.0",
        Accept: "application/json",
        Referer: "https://www.nseindia.com/",
      },
      timeout: 5000,
    });

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

        let change = 0;
        let pChange = 0;
        let high52 = 0;
        let low52 = 0;
        let pe = 0;
        let marketCap = 0;

        if (s.includes("fund") || s.includes("plan")) {

          const search = await axios.get(
            "https://api.mfapi.in/mf/search?q=" +
              encodeURIComponent(symbol)
          );

          if (!search.data?.length) {
            console.log(`❌ MF not found: ${symbol}`);
            continue;
          }

          const normalize = (str) =>
            (str || "")
              .toLowerCase()
              .replace(/fund|plan|growth|direct|regular|idcw/gi, "")
              .replace(/[^a-z0-9 ]/g, "")
              .trim();

          const target = normalize(symbol);

          let bestMatch = search.data.find((s) =>
            normalize(s.schemeName).includes(target)
          );

          if (!bestMatch) {
            bestMatch = search.data.find((s) =>
              target.includes(normalize(s.schemeName))
            );
          }

          if (!bestMatch) {
            bestMatch = search.data[0];
          }

          const schemeCode = bestMatch.schemeCode;

          const navRes = await axios.get(
            `https://api.mfapi.in/mf/${schemeCode}`
          );

          const nav = navRes.data?.data?.[0]?.nav;

          price = Number(nav) || 0;

          if (!price) {
            console.log(`⚠️ No NAV for: ${symbol}`);
            continue;
          }
        } else {
          if (symbol.endsWith("-E")) symbol = symbol.replace("-E", "");
          if (symbol.endsWith("-GB")) symbol = symbol.replace("-GB", "");

          let response;

          try {
            response = await nse.get(
              `/api/quote-equity?symbol=${encodeURIComponent(symbol)}`
            );
          } catch (err) {
            console.log("⚠️ NSE retry for", symbol);

            await nse.get("/");
            response = await nse.get(
              `/api/quote-equity?symbol=${encodeURIComponent(symbol)}`
            );
          }

          price = Number(response.data?.priceInfo?.lastPrice) || 0;

          const whl = response.data?.priceInfo?.weekHighLow || {};

          high52 = Number(whl.max) || 0;
          low52 = Number(whl.min) || 0;

          change = Number(response.data?.priceInfo?.change) || 0;
          pChange = Number(response.data?.priceInfo?.pChange) || 0;
          pe = Number(response.data?.metadata?.pe) || 0;

          const shares = Number(response.data?.securityInfo?.issuedCap) || 0;
          marketCap = shares * price;

          if (!price) {
            console.log(`⚠️ No price for: ${symbol}`);
            continue;
          }
        }

        try {
          results.push({
            symbol: symbolRaw,
            currentPrice: price,
            change: change || 0,
            pChange: pChange || 0,
            high52,
            low52,
            pe,
            marketCap
          });

        console.log(
  `✅ ${symbolRaw}: ₹${price}`
);
          
        } catch (err) {
          console.log("Push failed:", err.message);
        }

        successCount++;

        await new Promise((r) => setTimeout(r, 300));

      } catch (err) {
        console.log(`❌ Failed: ${symbolRaw}`, err.message);
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

// =========================
// 📊 NIFTY DATA (Yahoo)
// =========================

let cachedNifty = null;
let lastNiftyFetch = 0;
const CACHE_DURATION = 5 * 60 * 1000;

app.get("/api/nifty", async (req, res) => {
  try {
    if (cachedNifty && Date.now() - lastNiftyFetch < CACHE_DURATION) {
      return res.json(cachedNifty);
    }

    const response = await axios.get(
      "https://query1.finance.yahoo.com/v8/finance/chart/%5ENSEI?range=5d&interval=1d",
      {
        headers: {
          "User-Agent": "Mozilla/5.0",
          Accept: "application/json",
        },
        timeout: 5000,
      }
    );

    const data = response.data;

    const result =
      data?.chart?.result?.[0]?.indicators?.quote?.[0]?.close || [];

    const niftyData = {
      raw: data,
      close: result,
    };

    cachedNifty = niftyData;
    lastNiftyFetch = Date.now();

    res.json(niftyData);

  } catch (err) {
    console.error("❌ NIFTY fetch failed:", err.message);

    if (cachedNifty) {
      return res.json(cachedNifty);
    }

    res.status(500).json({ error: "Failed to fetch NIFTY" });
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

    try {
      await nse.get("/");
    } catch {
      console.log("⚠️ NSE cookie init failed (events)");
    }

    const res = await nse.get(
      "/api/corporate-announcements?index=equities"
    );

    const data = res.data || [];

    const getCleanTitle = (type) => {
      switch (type) {
        case "DIVIDEND":   return "Dividend declared";
        case "RESULT":     return "Results announced";
        case "MEETING":    return "Board meeting update";
        case "RECORD":     return "Record date announced";
        case "MERGER":     return "Merger update";
        case "DEMERGER":   return "Demerger update";
        case "ACQUISITION":return "Acquisition update";
        default:           return "Corporate update";
      }
    };

    const extractRecordDate = (text) => {
      const match = text.match(/(\d{1,2}-[A-Za-z]{3}-\d{4})/);
      return match ? match[1] : null;
    };

    // STEP 1: Normalize + classify fresh NSE data
    const parsed = data.map((item) => {
      const rawTitle = item.attchmntText || item.desc || "";
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

      return { symbol, type, title: getCleanTitle(type), rawTitle, recordDate, date };
    });

    // STEP 2: Keep only meaningful
    const meaningful = parsed.filter((e) => e.type !== "OTHER");

    // STEP 3: Deduplicate fresh batch (symbol + type + date)
    const freshMap = new Map();
    meaningful.forEach((e) => {
      const key = `${e.symbol}_${e.type}_${e.date}`;
      freshMap.set(key, e);
    });

    // ✅ FIX STEP 4: Merge with PERSISTED events (not just in-memory)
    // Load from disk to get events that survived across restarts
    // EVENTS is already loaded from disk at startup, so we merge with it directly
    const existingMap = new Map();

    // Seed existing map from current in-memory EVENTS (already disk-backed)
    [...(EVENTS.active || []), ...(EVENTS.archive || [])].forEach((e) => {
      const key = `${e.symbol}_${e.type}_${e.date}`;
      existingMap.set(key, e);
    });

    // Add/overwrite with fresh NSE data (fresh wins)
    freshMap.forEach((e, key) => {
      existingMap.set(key, e);
    });

    const merged = Array.from(existingMap.values());

    // STEP 5: Classify into active / archive based on date
    const active = [];
    const archive = [];

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    merged.forEach((e) => {
      if (!e.date) return;

      const eventDate = new Date(e.date);
      eventDate.setHours(0, 0, 0, 0);

      const diff = (eventDate - today) / (1000 * 60 * 60 * 24);

      // Active: past 3 days to next 7 days
      if (diff >= -3 && diff <= 7) {
        active.push(e);
      }
      // Archive: older than 3 days, within 30 days
      else if (diff < -3 && diff >= -30) {
        archive.push(e);
      }
      // Older than 30 days: drop (expired)
    });

    active.sort(
  (a, b) => new Date(b.date) - new Date(a.date)
);

archive.sort(
  (a, b) => new Date(b.date) - new Date(a.date)
);

    // STEP 6: Store (limit size) and persist to disk
    EVENTS = {
      active: active.slice(0, 20),
      archive: archive.slice(0, 50),
    };

    lastFetchTime = Date.now();

    // ✅ FIX: Write to disk so events survive restarts
    saveEventsCache();

    console.log(
      `✅ Events updated: active=${EVENTS.active.length}, archive=${EVENTS.archive.length}`
    );

  } catch (err) {
    console.error("❌ Events fetch failed:", err.message);
    // ✅ FIX: On failure, keep existing EVENTS intact (don't wipe them)
    // Nothing to do here — EVENTS is unchanged, disk cache is still valid
  }
};

// ⏰ Run at 9 AM
cron.schedule("0 9 * * *", fetchCorporateActions);

// ⏰ Run at 6 PM
cron.schedule("0 18 * * *", fetchCorporateActions);

// ✅ FIX: Track lastFetchTime persistently via events cache timestamp
// We use a simple approach: store it in the events cache file
let lastFetchTime = 0;

app.get("/api/events", async (req, res) => {

  try {
    const SIX_HOURS = 6 * 60 * 60 * 1000;
    const now = Date.now();

    // ✅ SELF-HEAL:
    // Render free tier can wipe filesystem on restart.
    // If cache is empty, bootstrap immediately.
    if (
      !EVENTS.active.length &&
      !EVENTS.archive.length
    ) {
      console.log(
        "⚠️ Empty events cache detected → bootstrapping"
      );

      await fetchCorporateActions();

    }

    // ✅ Refresh only if stale
    else if (now - lastFetchTime > SIX_HOURS) {

      console.log(
        "🔄 Events stale → refreshing"
      );

      await fetchCorporateActions();

    }

    res.json({
      success: true,
      active: EVENTS.active || [],
      archive: EVENTS.archive || [],
    });

  } catch (err) {

    console.error(
      "❌ /api/events failed:",
      err.message
    );

    res.status(500).json({
      error: "Failed to fetch events"
    });
  }
});

app.post("/api/validate-upload", async (req, res) => {
  try {
    const rows = req.body.rows || [];

    const valid = [];
    const suggestions = [];
    const invalid = [];

    const nse = axios.create({
      baseURL: "https://www.nseindia.com",
      headers: {
        "User-Agent": "Mozilla/5.0",
        Accept: "application/json",
        Referer: "https://www.nseindia.com/",
      },
      timeout: 5000,
    });

    if (!MF_LIST.length) {
      console.error("⚠️ MF_LIST empty");

      return res.json({
        success: true,
        valid: [],
        suggestions: [],
        invalid: rows.map((r) => ({
          input: r.symbol,
          type: "MF",
        })),
      });
    }

    try {
      await nse.get("/");
    } catch {}

    await Promise.all(
      rows.map(async (row) => {
        const original = (row.symbol || "").toUpperCase();
        const symbol = normalizeSymbol(original);

        const isMF =
          symbol.toLowerCase().includes("fund") ||
          symbol.toLowerCase().includes("plan");

        if (isMF) {
          let result = matchMF(symbol);

          if (result.type === "invalid") {
            try {
              const search = await axios.get(
                "https://api.mfapi.in/mf/search?q=" +
                  encodeURIComponent(symbol)
              );

              if (search.data?.length) {
                result = {
                  type: "suggest",
                  matches: search.data.slice(0, 5).map((m) => ({
                    name: m.schemeName,
                    code: m.schemeCode,
                  })),
                };
              }
            } catch (err) {
              console.log("⚠️ MFAPI fallback failed:", err.message);
            }
          }

          if (result.type === "valid") {
            valid.push({
              input: original,
              type: "MF",
              final: result.match.name,
              code: result.match.code,
              nav: result.match.nav,
            });
          } else if (result.type === "suggest") {
            suggestions.push({
              input: original,
              type: "MF",
              suggested: result.matches.map((m) => m.name),
            });
          } else {
            invalid.push({
              input: original,
              type: "MF",
            });
          }
        } else {
          let isValid = false;

          try {
            const resEq = await nse.get(
              `/api/quote-equity?symbol=${encodeURIComponent(symbol)}`
            );

            if (resEq.data?.info) {
              isValid = true;
            }
          } catch {}

          if (!isValid) {
            try {
              const resSearch = await nse.get(
                `/api/search/autocomplete?q=${encodeURIComponent(symbol)}`
              );

              const results = resSearch.data?.symbols || [];

              const match = results.find(
                (r) =>
                  r.symbol?.toUpperCase() === symbol ||
                  r.identifier?.toUpperCase() === symbol
              );

              if (match) {
                isValid = true;
              }
            } catch {}
          }

          if (isValid) {
            valid.push({
              input: original,
              type: "STOCK",
              final: symbol,
            });
          } else {
            invalid.push({
              input: original,
              type: "STOCK",
            });
          }
        }
      })
    );

    res.json({
      success: true,
      valid,
      suggestions,
      invalid,
    });

  } catch (err) {
    console.error("❌ Validation failed", err.message);
    res.status(500).json({ error: "Validation failed" });
  }
});

// 🔥 LOAD MF DATA + EVENTS CACHE BEFORE SERVER STARTS
const initServer = async () => {
  try {
    console.log("⏳ Starting server...");

    // ✅ FIX: Load persisted events first so archive/active survive restarts
    loadEventsCache();

    // Load MF cache
    if (fs.existsSync(CACHE_FILE)) {
      const data = fs.readFileSync(CACHE_FILE, "utf-8");
      MF_LIST = JSON.parse(data);
      console.log("⚡ Loaded MF cache:", MF_LIST.length);
    }

    if (!MF_LIST.length || MF_LIST.length < 10000) {
      console.log("⏳ Cache too small, fetching MFAPI before start...");
      await fetchMFAPI();
    } else {
      fetchMFAPI();
    }

    // ✅ FIX: Run fetchCorporateActions on startup to refresh events,
    // but EVENTS is already seeded from disk so merge works correctly
        // ✅ Bootstrap events if cache empty
    if (
      !EVENTS.active.length &&
      !EVENTS.archive.length
    ) {
      console.log(
        "⚠️ Events cache empty → bootstrapping events"
      );

      try {
        await fetchCorporateActions();

      } catch (err) {
        console.error(
          "❌ Initial events bootstrap failed:",
          err.message
        );
      }
    }

    app.listen(PORT, () => {
      console.log(`🚀 Server running on ${PORT}`);
    });

  } catch (err) {

    console.error(
      "❌ Server init failed:",
      err.message
    );

    process.exit(1);
  }
};

initServer();

// ⏰ keep cron (after init)
cron.schedule("0 6 * * *", fetchMFAPI);