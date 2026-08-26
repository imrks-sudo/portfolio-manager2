const PORT = process.env.PORT || 5000;
const API_KEY = process.env.API_KEY;
const fs = require("fs");
const path = require("path");
const CACHE_FILE = path.join(__dirname, "mf-cache.json");
const express = require("express");
const cors = require("cors");
const axios = require("axios");
const cron = require("node-cron");
const rateLimit = require("express-rate-limit");
const crypto = require("crypto");

// 🧠 In-memory events store
let EVENTS = [];
let MF_LIST = [];

// 🔐 Ephemeral Zerodha/Kite sessions. Access tokens are kept only in server memory
// and are never returned to the browser or persisted to disk.
const KITE_SESSIONS = new Map();
const KITE_SESSION_TTL = 12 * 60 * 60 * 1000;

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

    // 🔥 FALLBACK TO CACHE (CRITICAL)
    // 🔥 ONLY update if FULL dataset
    if (list.length > MF_LIST.length && list.length > 5000) {
      console.log("✅ AMFI refreshed:", list.length);
    } else {
      console.log("⚠️ Skipping update (partial data)");
    }

    MF_LIST = list;

    fs.writeFileSync(CACHE_FILE, JSON.stringify(list, null, 2));

    console.log(`✅ AMFI loaded: ${MF_LIST.length}`);
  } catch (err) {
    console.error("❌ AMFI fetch failed:", err.message);

    // 🔥 FINAL FALLBACK
    if (fs.existsSync(CACHE_FILE)) {
      console.log("⚠️ Loading MF from cache");

      const data = fs.readFileSync(CACHE_FILE, "utf-8");
      MF_LIST = JSON.parse(data);
    }
  }
};

const app = express();
app.set("trust proxy", 1); // if behind a proxy (e.g. Vercel)

// 🔐 Allowed origins (PRODUCTION + DEV)
const allowed = [
  "https://watchmyfolio.com",
  "https://www.watchmyfolio.com",
  "http://localhost:5173"
];

// ✅ CORS CONFIG
app.use(cors({
  origin: function (origin, callback) {
    // allow requests with no origin (mobile apps, curl, Postman)
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
  windowMs: 60 * 1000, // 1 minute
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(limiter);

// 📦 BODY PARSER
app.use(express.json());

/*
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
*/

const { wrapper } = require("axios-cookiejar-support");
const tough = require("tough-cookie");

// ✅ Create cookie jar
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

  // 🔥 smarter matching (bi-directional + partial)
  const inputWords = cleanInput.split(" ").filter(w => w.length > 2);

  const matches = MF_LIST
    .filter((mf) => {
      const normName = normalize(mf.name);

      // 🔥 REQUIRE at least 2 meaningful word matches
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

  const finalMatches = matches.slice(0, 5);

  // 🔥 remove duplicates (same scheme family)
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

  // 🔥 FINAL DECISION

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

    // 🚨 SAFETY CHECK (prevent bad overwrite)
    if (list.length < 5000) {
      console.log("⚠️ Skipping MFAPI update (too small dataset)");
      return;
    }

    // 🔥 UPDATE ONLY IF BETTER THAN CURRENT
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

          // 🔥 NORMALIZE FUNCTION
          const normalize = (str) =>
            (str || "")
              .toLowerCase()
              .replace(/fund|plan|growth|direct|regular|idcw/gi, "")
              .replace(/[^a-z0-9 ]/g, "") // 👈 KEEP SPACE
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

          // 🔥 ADD THIS
          pe = Number(response.data?.metadata?.pe) || 0;

          shares =
            Number(response.data?.securityInfo?.issuedCap) || 0;

          marketCap = shares * price;

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
          successCount++;
        } catch (err) {
          console.log("Push failed:", err.message);
        }

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

// =========================
// 📊 NIFTY DATA (Yahoo)
// =========================

let cachedNifty = null;
let lastFetch = 0;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

app.get("/api/nifty", async (req, res) => {
  try {
    // 🔥 Serve from cache
    if (cachedNifty && Date.now() - lastFetch < CACHE_DURATION) {
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

    // 🔥 Optional: minimal clean response (faster FE)
    const result =
      data?.chart?.result?.[0]?.indicators?.quote?.[0]?.close || [];

    const niftyData = {
      raw: data,
      close: result,
    };

    // 🔥 cache
    cachedNifty = niftyData;
    lastFetch = Date.now();

    res.json(niftyData);

  } catch (err) {
    console.error("❌ NIFTY fetch failed:", err.message);

    // 🔥 fallback to stale cache (important UX)
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
        title: getCleanTitle(type),
        rawTitle,
        recordDate,
        date,
      };
    });

    // 🔥 STEP 2: keep only meaningful
    const meaningful = parsed.filter((e) => e.type !== "OTHER");

    // 🔥 STEP 3: deduplicate (symbol + type + date)
    const map = new Map();

    meaningful.forEach((e) => {
      const key = `${e.symbol}_${e.type}_${e.date}`;
      map.set(key, e);
    });

    const unique = Array.from(map.values());

    // 🔥 STEP 4: merge with previous events (prevents flicker)
    const existingMap = new Map();

    [...(EVENTS.active || []), ...(EVENTS.archive || [])].forEach((e) => {
      const key = `${e.symbol}_${e.type}_${e.date}`;
      existingMap.set(key, e);
    });

    // add new events
    unique.forEach((e) => {
      const key = `${e.symbol}_${e.type}_${e.date}`;
      existingMap.set(key, e);
    });

    const merged = Array.from(existingMap.values());

    // 🔥 STEP 5: classify with better lifecycle
    const active = [];
    const archive = [];

    // normalize today (remove time)
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    merged.forEach((e) => {
      if (!e.date) return;

      const eventDate = new Date(e.date);
      eventDate.setHours(0, 0, 0, 0);

      const diff =
        (eventDate - today) / (1000 * 60 * 60 * 24);

      // 🟢 UPCOMING + TODAY + RECENT (keep visible)
      if (diff >= -3 && diff <= 7) {
        active.push(e);
      }

      // 🟡 OLDER EVENTS (move to archive)
      else if (diff < -3 && diff >= -30) {
        archive.push(e);
      }
    });

    // 🔥 STEP 6: store (limit size)
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

let lastFetchTime = 0;

app.get("/api/events", async (req, res) => {
  try {
    if (Date.now() - lastFetchTime > 6 * 60 * 60 * 1000) {
      await fetchCorporateActions();
      lastFetchTime = Date.now();
    }

    res.json({
      success: true,
      active: EVENTS.active || [],
      archive: EVENTS.archive || [],
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch events" });
  }
});

// =====================================================
// 🟢 ZERODHA / KITE PERSONAL API
// =====================================================
// Kite APIs are NOT CORS-enabled and the api_secret must not be embedded in
// browser code. WatchMyFolio therefore performs the token exchange and the
// subsequent holdings calls on the backend. The secret is accepted only for
// the one-time exchange and is never persisted.

const createKiteSessionId = () => crypto.randomBytes(32).toString("hex");

const pruneKiteSessions = () => {
  const now = Date.now();
  for (const [id, session] of KITE_SESSIONS.entries()) {
    if (now - session.createdAt > KITE_SESSION_TTL) {
      KITE_SESSIONS.delete(id);
    }
  }
};

app.post("/api/kite/session", async (req, res) => {
  try {
    const { apiKey, apiSecret, requestToken } = req.body || {};

    if (!apiKey || !apiSecret || !requestToken) {
      return res.status(400).json({
        success: false,
        error: "apiKey, apiSecret and requestToken are required",
      });
    }

    // The request token is single-use and short-lived. Exchange it immediately.
    const checksum = crypto
      .createHash("sha256")
      .update(`${apiKey}${requestToken}${apiSecret}`)
      .digest("hex");

    const tokenRes = await axios.post(
      "https://api.kite.trade/session/token",
      new URLSearchParams({
        api_key: apiKey,
        request_token: requestToken,
        checksum,
      }).toString(),
      {
        headers: {
          "X-Kite-Version": "3",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        timeout: 10000,
      }
    );

    if (tokenRes.data?.status !== "success" || !tokenRes.data?.data?.access_token) {
      return res.status(401).json({
        success: false,
        error: tokenRes.data?.message || "Zerodha authentication failed",
      });
    }

    const kite = tokenRes.data.data;
    const sessionId = createKiteSessionId();

    KITE_SESSIONS.set(sessionId, {
      apiKey,
      accessToken: kite.access_token,
      userId: kite.user_id,
      userName: kite.user_name,
      createdAt: Date.now(),
    });

    // Do not send the api_secret or access_token back to the browser.
    pruneKiteSessions();

    return res.json({
      success: true,
      sessionId,
      user: {
        userId: kite.user_id,
        userName: kite.user_name,
        userShortname: kite.user_shortname,
      },
    });
  } catch (err) {
    const message =
      err.response?.data?.message ||
      err.response?.data?.error_type ||
      err.message ||
      "Zerodha authentication failed";

    console.error("❌ Kite session failed:", message);
    return res.status(401).json({ success: false, error: message });
  }
});

app.post("/api/kite/holdings", async (req, res) => {
  try {
    pruneKiteSessions();

    const { sessionId } = req.body || {};
    const session = KITE_SESSIONS.get(sessionId);

    if (!session) {
      return res.status(401).json({
        success: false,
        error: "Zerodha session expired. Please reconnect.",
      });
    }

    const headers = {
      "X-Kite-Version": "3",
      Authorization: `token ${session.apiKey}:${session.accessToken}`,
    };

    const [equityRes, mfRes] = await Promise.allSettled([
      axios.get("https://api.kite.trade/portfolio/holdings", {
        headers,
        timeout: 10000,
      }),
      axios.get("https://api.kite.trade/mf/holdings", {
        headers,
        timeout: 10000,
      }),
    ]);

    const equity =
      equityRes.status === "fulfilled" && equityRes.value.data?.status === "success"
        ? equityRes.value.data.data || []
        : [];

    const mutualFunds =
      mfRes.status === "fulfilled" && mfRes.value.data?.status === "success"
        ? mfRes.value.data.data || []
        : [];

    if (equityRes.status === "rejected" && mfRes.status === "rejected") {
      const kiteError =
        equityRes.reason?.response?.data?.message ||
        mfRes.reason?.response?.data?.message ||
        "Unable to fetch Zerodha holdings";
      return res.status(502).json({ success: false, error: kiteError });
    }

    const holdings = [
      ...equity.map((h) => ({
        symbol: h.tradingsymbol,
        quantity: Number(h.quantity) || 0,
        avgPrice: Number(h.average_price) || 0,
        currentPrice: Number(h.last_price) || 0,
        currentValue: (Number(h.quantity) || 0) * (Number(h.last_price) || 0),
        dailyChange: Number(h.day_change) || 0,
        dailyPct: Number(h.day_change_percentage) || 0,
        pnl: Number(h.pnl) || 0,
        sector: "-",
        source: "zerodha",
        assetType: "stock",
      })),
      ...mutualFunds.map((h) => ({
        symbol: h.fund,
        quantity: Number(h.quantity) || 0,
        avgPrice: Number(h.average_price) || 0,
        currentPrice: Number(h.last_price) || 0,
        currentValue: (Number(h.quantity) || 0) * (Number(h.last_price) || 0),
        pnl: Number(h.pnl) || 0,
        dailyChange: 0,
        dailyPct: 0,
        sector: "-",
        source: "zerodha",
        assetType: "mutual_fund",
        isin: h.tradingsymbol,
      })),
    ];

    return res.json({
      success: true,
      holdings,
      counts: {
        stocks: equity.length,
        mutualFunds: mutualFunds.length,
        total: holdings.length,
      },
    });
  } catch (err) {
    console.error("❌ Kite holdings failed:", err.message);
    return res.status(500).json({
      success: false,
      error: "Failed to fetch Zerodha holdings"
    });
  }
});

app.post("/api/kite/disconnect", (req, res) => {
  const { sessionId } = req.body || {};
  if (sessionId) KITE_SESSIONS.delete(sessionId);
  res.json({ success: true });
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

    // ✅ Init cookies
    try {
      await nse.get("/");
    } catch {}

    // 🚀 PARALLEL PROCESSING (faster)
    await Promise.all(
      rows.map(async (row) => {
        const original = (row.symbol || "").toUpperCase();
        const symbol = normalizeSymbol(original);

        const isMF =
          symbol.toLowerCase().includes("fund") ||
          symbol.toLowerCase().includes("plan");

        // =========================
        // 🔵 MUTUAL FUND
        // =========================
        if (isMF) {
          let result = matchMF(symbol);

          // 🔥 STEP 1: MFAPI fallback if no match from cache
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

          // 🔥 STEP 2: FINAL DECISION
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
        }

        // =========================
        // 🟢 STOCK / ETF / SGB
        // =========================
        else {
          let isValid = false;

          // 🔹 Step 1: Equity API
          try {
            const resEq = await nse.get(
              `/api/quote-equity?symbol=${encodeURIComponent(symbol)}`
            );

            if (resEq.data?.info) {
              isValid = true;
            }
          } catch {}

          // 🔹 Step 2: Fallback (ETF / SGB / others)
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

          // 🔹 Step 3: Final decision
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

// 🔥 LOAD MF DATA BEFORE SERVER STARTS
const initServer = async () => {
  try {
    console.log("⏳ Starting server...");

    // 🔥 Try loading cache
    if (fs.existsSync(CACHE_FILE)) {
      const data = fs.readFileSync(CACHE_FILE, "utf-8");
      MF_LIST = JSON.parse(data);
      console.log("⚡ Loaded MF cache:", MF_LIST.length);
    }

    // 🔥 If cache is too small → fetch BEFORE starting
    if (!MF_LIST.length || MF_LIST.length < 10000) {
      console.log("⏳ Cache too small, fetching MFAPI before start...");
      await fetchMFAPI();
    } else {
      // otherwise refresh in background
      fetchMFAPI();
    }

    // 🚀 Start server
    app.listen(PORT, () => {
      console.log("Server running on", PORT);
    });

  } catch (err) {
    console.error("❌ Server init failed:", err.message);
  }
};

// 🔥 START INIT
initServer();

// ⏰ keep cron (after init)
cron.schedule("0 6 * * *", fetchMFAPI);