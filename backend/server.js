const PORT = process.env.PORT || 5000;
const API_KEY = process.env.API_KEY;
const fs = require("fs");
const path = require("path");
const CACHE_FILE = path.join(__dirname, "mf-cache.json");

// ✅ FIX: Persist events to disk (survives server restarts + Render sleep)
const EVENTS_CACHE_FILE = path.join(__dirname, "events-cache.json");
const PRICE_CACHE_FILE = path.join(__dirname, "prices-cache.json");
const PRICE_CACHE_VERSION = 2;

const express = require("express");
const cors = require("cors");
const axios = require("axios");
const yahooFinance = require("yahoo-finance2").default;
const cron = require("node-cron");
const rateLimit = require("express-rate-limit");
const createAiChatRouter = require("./routes/aiChat");

// 🧠 In-memory events store
// ✅ FIX: Initialize as proper object (was `[]` which broke EVENTS.active/.archive reads)
let EVENTS = { active: [], archive: [] };
let MF_LIST = [];
let PRICE_CACHE = {};
let priceRefreshRunning = false;

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

const toFiniteNumber = (value) => {
  const raw =
    value && typeof value === "object" && "raw" in value ? value.raw : value;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
};

const round2 = (value) => Number(toFiniteNumber(value).toFixed(2));

const toYahooSymbol = (symbol) => {

  const clean =
    normalizeSymbol(symbol);

  if (!clean) return "";

  // ✅ Already mapped
  if (clean.includes(".")) {
    return clean;
  }

  // ✅ SGB support
  if (clean.startsWith("SGB")) {
    return `${clean}.NS`;
  }

  return `${clean}.NS`;
};

const validateYahooSymbol = async (symbolRaw) => {

  const symbol =
    normalizeSymbol(symbolRaw);

  try {

    const yahooSymbol =
      toYahooSymbol(symbol);

    const response =
      await axios.get(
        `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
          yahooSymbol
        )}?range=1d&interval=1d`,
        {
          headers: {
            "User-Agent": "Mozilla/5.0",
            Accept: "application/json",
          },
          timeout: 5000,
        }
      );

    const result =
      response.data?.chart?.result?.[0];

    const meta =
      result?.meta || {};

    const price =
      Number(meta.regularMarketPrice || 0);

    return (
      !!result &&
      (
        price > 0 ||
        meta.symbol
      )
    );

  } catch (err) {

    return false;
  }
};

const isPriceCacheFresh = (item) => {
  const fetchedAt = Date.parse(item?.fetchedAt || "");
  return (
    item?.cacheVersion === PRICE_CACHE_VERSION &&
    fetchedAt > 0 &&
    Date.now() - fetchedAt < 5 * 60 * 1000
  );
};

const loadPriceCache = () => {
  try {
    if (!fs.existsSync(PRICE_CACHE_FILE)) return;

    const parsed = JSON.parse(fs.readFileSync(PRICE_CACHE_FILE, "utf-8"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      PRICE_CACHE = parsed;
      console.log(`Loaded price cache: ${Object.keys(PRICE_CACHE).length}`);
    }
  } catch (err) {
    console.error("Failed to load price cache:", err.message);
    PRICE_CACHE = {};
  }
};

const savePriceCache = () => {
  try {
    fs.writeFileSync(PRICE_CACHE_FILE, JSON.stringify(PRICE_CACHE, null, 2));
  } catch (err) {
    console.error("Failed to save price cache:", err.message);
  }
};

const getCachedPrice = (symbol) => PRICE_CACHE[normalizeSymbol(symbol)] || null;

const cachePrice = (quote, { persist = true } = {}) => {
  const symbol = normalizeSymbol(quote.symbol);
  if (!symbol || !quote.currentPrice) return quote;

  const cached = {
    ...quote,
    symbol,
    cacheVersion: PRICE_CACHE_VERSION,
    fetchedAt: quote.fetchedAt || new Date().toISOString(),
  };

  PRICE_CACHE[symbol] = cached;
  if (persist) savePriceCache();
  return cached;
};

const fetchYahooChartQuote = async (symbolRaw) => {
  const symbol = normalizeSymbol(symbolRaw);

  const response = await axios.get(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
      toYahooSymbol(symbol)
    )}?range=1y&interval=1d`,
    {
      headers: {
        "User-Agent": "Mozilla/5.0",
        Accept: "application/json",
      },
      timeout: 10000,
    }
  );

  const result = response.data?.chart?.result?.[0];
  const meta = result?.meta || {};
  const quote = result?.indicators?.quote?.[0] || {};
  const closes = (quote.close || []).map(toFiniteNumber).filter(Boolean);
  const highs = (quote.high || []).map(toFiniteNumber).filter(Boolean);
  const lows = (quote.low || []).map(toFiniteNumber).filter(Boolean);
  const price = toFiniteNumber(meta.regularMarketPrice) || closes.at(-1);
  const previousClose =
    closes.at(-2) ||
    toFiniteNumber(meta.previousClose) ||
    toFiniteNumber(meta.chartPreviousClose);

  if (!price) {
    throw new Error(`Yahoo price unavailable for ${symbol}`);
  }

  const change = previousClose ? price - previousClose : 0;

  return {
    symbol,
    currentPrice: round2(price),
    change: round2(change),
    pChange: previousClose ? round2((change / previousClose) * 100) : 0,
    high52:
      round2(toFiniteNumber(meta.fiftyTwoWeekHigh)) ||
      round2(Math.max(...highs, 0)),
    low52:
      round2(toFiniteNumber(meta.fiftyTwoWeekLow)) ||
      round2(Math.min(...lows.filter(Boolean))),
    pe: 0,
    marketCap: 0,
    source: "Yahoo chart",
    stale: false,
    fetchedAt: new Date().toISOString(),
  };
};

const fetchYahooQuote = async (symbolRaw) => {
  const symbol = normalizeSymbol(symbolRaw);
  let quote;

  try {
    quote = await yahooFinance.quote(toYahooSymbol(symbol));
  } catch (err) {
    console.log(`[prices] Yahoo quote failed for ${symbol}: ${err.message}`);
    return fetchYahooChartQuote(symbol);
  }

  const price =
    toFiniteNumber(quote?.regularMarketPrice) ||
    toFiniteNumber(quote?.postMarketPrice) ||
    toFiniteNumber(quote?.preMarketPrice);

  if (!price) {
    return fetchYahooChartQuote(symbol);
  }

  const previousClose = toFiniteNumber(quote?.regularMarketPreviousClose);
  const change =
    toFiniteNumber(quote?.regularMarketChange) ||
    (previousClose ? price - previousClose : 0);
  const pChange =
    toFiniteNumber(quote?.regularMarketChangePercent) ||
    (previousClose ? (change / previousClose) * 100 : 0);

  return {
    symbol,
    currentPrice: round2(price),
    change: round2(change),
    pChange: round2(pChange),
    high52: round2(quote?.fiftyTwoWeekHigh),
    low52: round2(quote?.fiftyTwoWeekLow),
    pe: round2(quote?.trailingPE || quote?.forwardPE),
    marketCap: toFiniteNumber(quote?.marketCap),
    source: "Yahoo",
    stale: false,
    fetchedAt: new Date().toISOString(),
  };
};

const parseNseQuote = (symbolRaw, response) => {
  const symbol = normalizeSymbol(symbolRaw);
  const price = toFiniteNumber(response.data?.priceInfo?.lastPrice);
  const whl = response.data?.priceInfo?.weekHighLow || {};
  const shares = toFiniteNumber(response.data?.securityInfo?.issuedCap);

  if (!price) {
    throw new Error(`No live NSE price returned for ${symbol}`);
  }

  return {
    symbol,
    currentPrice: round2(price),
    change: round2(response.data?.priceInfo?.change),
    pChange: round2(response.data?.priceInfo?.pChange),
    high52: round2(whl.max),
    low52: round2(whl.min),
    pe: round2(response.data?.metadata?.pe),
    marketCap: shares * price,
    source: "NSE",
    stale: false,
    fetchedAt: new Date().toISOString(),
  };
};

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

app.use(
  createAiChatRouter({
    getEvents: () => EVENTS,
  })
);

const { wrapper } = require("axios-cookiejar-support");
const tough = require("tough-cookie");

const jar = new tough.CookieJar();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const NSE_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  Referer: "https://www.nseindia.com/",
  Origin: "https://www.nseindia.com",
};

const NSE_HTML_HEADERS = {
  ...NSE_HEADERS,
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
};

const createNseClient = () =>
  wrapper(
    axios.create({
      baseURL: "https://www.nseindia.com",
      jar,
      withCredentials: true,
      headers: NSE_HEADERS,
      timeout: 10000,
    })
  );

const isNseBlocked = (err) => {
  const status = err?.response?.status;
  return status === 401 || status === 403 || status === 429;
};

const getNseErrorMessage = (err) => {
  const status = err?.response?.status;
  return status ? `NSE returned ${status}` : err.message;
};

const primeNseSession = async (nse, symbol = "") => {
  await nse.get("/", {
    headers: NSE_HTML_HEADERS,
  });

  await sleep(400);

  const quotePath = symbol
    ? `/get-quotes/equity?symbol=${encodeURIComponent(symbol)}`
    : "/market-data/live-equity-market";

  await nse.get(quotePath, {
    headers: {
      ...NSE_HTML_HEADERS,
      Referer: "https://www.nseindia.com/",
    },
  });
};

const requestNseQuote = async (nse, symbol) =>
  nse.get("/api/quote-equity", {
    params: { symbol },
    headers: {
      ...NSE_HEADERS,
      Referer: `https://www.nseindia.com/get-quotes/equity?symbol=${encodeURIComponent(
        symbol
      )}`,
    },
  });

const fetchNseQuote = async (nse, symbol) => {
  try {
    return await requestNseQuote(nse, symbol);
  } catch (err) {
    if (!isNseBlocked(err)) {
      throw err;
    }

    console.log(`[prices] NSE blocked ${symbol}, re-priming session once`);
    await primeNseSession(nse, symbol);
    await sleep(900);
    return requestNseQuote(nse, symbol);
  }
};

const fetchStockPrice = async (
  symbolRaw,
  { skipNse = false } = {}
) => {

  const symbol =
    normalizeSymbol(symbolRaw);

  const cached =
    getCachedPrice(symbol);

  // ✅ FIRST: Fresh cache
  if (isPriceCacheFresh(cached)) {

    return {
      ...cached,
      symbol,
      source: `${cached.source || "cache"} cache`,
      stale: false,
    };
  }

  // ✅ SECOND: Yahoo (PRIMARY)
  try {

    const yahooQuote =
      await fetchYahooQuote(symbol);

    return cachePrice(yahooQuote);

  } catch (err) {

    console.log(
      `[prices] Yahoo failed for ${symbol}: ${err.message}`
    );
  }

  // ✅ THIRD: stale cache fallback
  if (cached?.currentPrice) {

    return {
      ...cached,
      symbol,
      source: `${cached.source || "price"} stale cache`,
      stale: true,
    };
  }

  // ✅ LAST RESORT: NSE
  if (!skipNse) {

    try {

      const nse =
        createNseClient();

      await primeNseSession(
        nse,
        symbol
      );

      await sleep(700);

      const response =
        await fetchNseQuote(
          nse,
          symbol
        );

      return cachePrice(
        parseNseQuote(
          symbol,
          response
        )
      );

    } catch (err) {

      console.log(
        `[prices] NSE failed for ${symbol}: ${getNseErrorMessage(err)}`
      );
    }
  }

  // ✅ FINAL: SGB special fallback
  if (
    symbol.startsWith("SGB") &&
    cached?.currentPrice
  ) {

    return {
      ...cached,
      symbol,
      stale: true,
      source: "SGB cache",
    };
  }

  throw new Error(
    `No price source available for ${symbol}`
  );
};


const refreshCachedPrices = async () => {
  if (priceRefreshRunning) return;

  const symbols = Object.keys(PRICE_CACHE);
  if (!symbols.length) return;

  priceRefreshRunning = true;

  try {
    let refreshed = 0;

    for (const symbol of symbols) {
      try {
        cachePrice(await fetchYahooQuote(symbol), { persist: false });
        refreshed++;
        await sleep(300);
      } catch (err) {
        console.log(`[prices] cache refresh failed for ${symbol}: ${err.message}`);
      }
    }

    savePriceCache();
    console.log(`[prices] cache refreshed: ${refreshed}/${symbols.length}`);
  } finally {
    priceRefreshRunning = false;
  }
};

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

const inputWords = (input || "")
  .toLowerCase()
  .replace(
    /fund|plan|growth|direct|regular|idcw/gi,
    ""
  )
  .split(/[^a-z0-9]+/)
  .filter((w) => w.length > 2);

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

    console.log(`[prices] update requested for ${symbols.length} symbols`);

    const results = [];
    const failedSymbols = [];
    let successCount = 0;
    let nseBlocked = false;

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
        let source = "";
        let stale = false;
        let fetchedAt = null;

        if (s.includes("fund") || s.includes("plan")) {

          const search = await axios.get(
            "https://api.mfapi.in/mf/search?q=" +
              encodeURIComponent(symbol)
          );

          if (!search.data?.length) {
            console.log(`❌ MF not found: ${symbol}`);
            failedSymbols.push({
              symbol: symbolRaw,
              reason: "MF not found",
            });
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
          source = "MFAPI";
          fetchedAt = new Date().toISOString();

          if (!price) {
            console.log(`⚠️ No NAV for: ${symbol}`);
            failedSymbols.push({
              symbol: symbolRaw,
              reason: "No NAV returned",
            });
            continue;
          }
        } else {
          if (symbol.endsWith("-E")) symbol = symbol.replace("-E", "");
          if (symbol.endsWith("-GB")) symbol = symbol.replace("-GB", "");

          try {
            const quote =
  await fetchStockPrice(
    symbol,
    {
      skipNse: nseBlocked,
    }
  );

            price = Number(quote.currentPrice) || 0;
            high52 = Number(quote.high52) || 0;
            low52 = Number(quote.low52) || 0;
            change = Number(quote.change) || 0;
            pChange = Number(quote.pChange) || 0;
            pe = Number(quote.pe) || 0;
            marketCap = Number(quote.marketCap) || 0;
            source = quote.source || "";
            stale = quote.stale === true;
            fetchedAt = quote.fetchedAt || null;

            if (quote.nseBlocked) {
              nseBlocked = true;
            }
          } catch (err) {
            if (isNseBlocked(err)) {
              nseBlocked = true;
              const reason = getNseErrorMessage(err);
              console.log(
                `[prices] NSE blocked live quote requests; stopping NSE calls. ${reason}`
              );
              failedSymbols.push({
                symbol: symbolRaw,
                reason,
              });
              continue;
            }

            throw err;
          }

          if (!price) {
            console.log(`⚠️ No price for: ${symbol}`);
            failedSymbols.push({
              symbol: symbolRaw,
              reason: "No price returned",
            });
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
            marketCap,
            source,
            stale,
            fetchedAt
          });

        console.log(
  `✅ ${symbolRaw}: ₹${price}`
);
        console.log(`[prices] ${symbolRaw} = ${price}`);
          
        } catch (err) {
          console.log("Push failed:", err.message);
        }

        successCount++;

        await sleep(750);

      } catch (err) {
        console.log(`❌ Failed: ${symbolRaw}`, err.message);
        failedSymbols.push({
          symbol: symbolRaw,
          reason: getNseErrorMessage(err),
        });
      }
    }

    res.json({
      success: true,
      updated: successCount,
      data: results,
      failed: failedSymbols,
      nseBlocked,
    });

    console.log(`[prices] update completed: ${successCount}/${symbols.length}`);

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

    const nse = createNseClient();

    try {
      await nse.get("/");
    } catch {
      console.log("⚠️ NSE cookie init failed (events)");
    }

    const res = await nse.get(
      "/api/corporate-announcements?index=equities"
    );

    const data = res.data || [];

    if (!data.length) {

  console.log(
    "⚠️ NSE returned empty events response → preserving cache"
  );

  return;
}

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

    const announcementDate = item.sort_date
  ? item.sort_date.split(" ")[0]
  : null;

const recordDate =
  extractRecordDate(rawTitle);

// ✅ Safe date normalizer
const normalizeDate = (value) => {

  if (!value) return null;

  // Already ISO
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }

  // DD-MMM-YYYY
  const match = value.match(
    /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/
  );

  if (!match) return null;

  const [, dd, mon, yyyy] = match;

  const months = {
    Jan: "01",
    Feb: "02",
    Mar: "03",
    Apr: "04",
    May: "05",
    Jun: "06",
    Jul: "07",
    Aug: "08",
    Sep: "09",
    Oct: "10",
    Nov: "11",
    Dec: "12",
  };

  const month =
    months[
      mon.charAt(0).toUpperCase() +
      mon.slice(1).toLowerCase()
    ];

  if (!month) return null;

  return `${yyyy}-${month}-${dd.padStart(2, "0")}`;
};

const effectiveDate =
  normalizeDate(
    recordDate || announcementDate
  );

return {
  symbol,
  type,
  title: getCleanTitle(type),
  rawTitle,

  announcementDate,
  recordDate,

  date: effectiveDate,
};

}); // ✅ IMPORTANT: closes parsed.map()

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

      if (isNaN(eventDate)) {
        return;
      }

      eventDate.setHours(0, 0, 0, 0);

      const diff = (eventDate - today) / (1000 * 60 * 60 * 24);

      // Active: past 7 days to next 14 days
      if (diff >= -7 && diff <= 14) {
        active.push(e);
      }
      // Archive: older than 7 days, within 30 days
      else if (diff < -7 && diff >= -30) {
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
      active,
      archive,
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

  const rows = (req.body.rows || [])
    .slice(0, 50);

  const valid = [];
  const suggestions = [];
  const invalid = [];

  for (const row of rows) {

    const original =
      (row.symbol || "").toUpperCase();

    const symbol =
      normalizeSymbol(original);

    const isMF =
      symbol.toLowerCase().includes("fund") ||
      symbol.toLowerCase().includes("plan");

    // =========================
    // ✅ MUTUAL FUNDS
    // =========================

    if (isMF) {

      if (!MF_LIST.length) {

  console.log(
    "⚠️ MF_LIST empty → skipping MF validation"
  );

  invalid.push({
    input: original,
    type: "MF",
  });

  continue;
}

      let result = matchMF(symbol);

      // 🔥 MFAPI fallback
      if (result.type === "invalid") {

        try {

          const search =
            await axios.get(
              "https://api.mfapi.in/mf/search?q=" +
              encodeURIComponent(symbol)
            );

          if (search.data?.length) {

            result = {
              type: "suggest",

              matches: search.data
                .slice(0, 5)
                .map((m) => ({
                  name: m.schemeName,
                  code: m.schemeCode,
                })),
            };
          }

        } catch (err) {

          console.log(
            "⚠️ MFAPI fallback failed:",
            err.message
          );
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

      } else if (
        result.type === "suggest"
      ) {

        suggestions.push({
          input: original,
          type: "MF",

          suggested:
            result.matches.map(
              (m) => m.name
            ),
        });

      } else {

        invalid.push({
          input: original,
          type: "MF",
        });
      }

    }

    // =========================
    // ✅ STOCKS (YAHOO)
    // =========================

    else {

    const isValid =
  await validateYahooSymbol(symbol);

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

    // ✅ Light throttle
    await sleep(100);
  }

  res.json({
    success: true,
    valid,
    suggestions,
    invalid,
  });

} catch (err) {

  console.error(
    "❌ Validation failed",
    err.message
  );

  res.status(500).json({
    error: "Validation failed"
  });
}
});

// 🔥 LOAD MF DATA + EVENTS CACHE BEFORE SERVER STARTS
const initServer = async () => {
  try {
    console.log("⏳ Starting server...");

    // ✅ FIX: Load persisted events first so archive/active survive restarts
    loadEventsCache();
    loadPriceCache();

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
cron.schedule("*/5 * * * *", refreshCachedPrices);
