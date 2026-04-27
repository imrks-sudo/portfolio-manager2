import React, { useEffect, useState, useRef } from "react";
import * as XLSX from "xlsx";

import posthog from 'posthog-js';

import {
  LayoutDashboard,
  Flame,
  Target,
  TrendingUp,
  BarChart3,
  Lightbulb,
  HelpCircle,
  Info,
  Heart,
  Bell,
  PieChart as PieChartIcon 
} from "lucide-react";

import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
} from "recharts";

if (import.meta.env.DEV) {
  console.log("API URL:", import.meta.env.VITE_API_URL);
}

const API_URL =
  import.meta.env.VITE_API_URL || "http://localhost:5000";

if (!import.meta.env.VITE_API_URL) {
  console.warn("⚠️ VITE_API_URL not set. Using localhost fallback.");
}

import Papa from "papaparse";

const PROFILE_KEY = "activeProfile";

const getActiveProfile = () => {
  let profile = localStorage.getItem(PROFILE_KEY);

  if (!profile) {
    profile = "default";   // 👈 KEY FIX
    localStorage.setItem(PROFILE_KEY, profile);
  }

  return profile;
};

const getAllProfiles = () => {
  return Object.keys(localStorage)
    .filter((k) => k.startsWith("portfolio_"))
    .map((k) => k.replace("portfolio_", ""));
};

const setActiveProfile = (name) => {
  localStorage.setItem(PROFILE_KEY, name);

  // 🔥 Track user switch
  posthog.identify(name);

  // optional (recommended)
  posthog.capture('profile_switched', { profile: name });
};

const getPortfolioKey = (profile) => {
  return `portfolio_${profile}`;
};

const loadLocalPortfolio = () => {
  const profile = getActiveProfile();
  if (!profile) return [];

  try {
    const saved = localStorage.getItem(getPortfolioKey(profile));
    return saved ? JSON.parse(saved) : [];
  } catch {
    return [];
  }
};

const saveLocalPortfolio = (data) => {
  
  const profile = getActiveProfile();
  if (!profile) return;

  try {
    localStorage.setItem(getPortfolioKey(profile), JSON.stringify(data));
  } catch (e) {
    console.error("Local save failed", e);
  }
};


const COLORS = ["#0088FE", "#00C49F", "#FFBB28", "#FF8042", "#845EC2"];

const format2 = (v) =>
  Number(v).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  

const formatPercent = (value, total) =>
  total ? ((value / total) * 100).toFixed(2) : "0.00";

function App() {
  const [profile, setProfile] = useState(() => getActiveProfile());
  const [data, setData] = useState([]);
  const cleanData = data.filter(Boolean);
  const hasData = cleanData.length > 0;
  const [lastUpdated, setLastUpdated] = useState(null);
  const [dark, setDark] = useState(() => localStorage.getItem("darkMode") === "true");
  const [updatingPrices, setUpdatingPrices] = useState(false);
  const [search, setSearch] = useState("");
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [sortKey, setSortKey] = useState(null);
  const [sortDir, setSortDir] = useState("desc");
  const [showAlerts, setShowAlerts] = useState(false);
  const alertRef = useRef(null);
  const [events, setEvents] = useState({
  active: [],
  archive: []
});

  const theme = {
  bg: dark ? "#020617" : "#ffffff",
  card: dark ? "#020617" : "#f9fafb",
  border: dark ? "#1f2937" : "#e5e7eb",
  text: dark ? "#e5e7eb" : "#111827",
  subText: dark ? "#9ca3af" : "#6b7280",
};
  const [view, setView] = useState("dashboard");

  const [previewData, setPreviewData] = useState([]);
  const [showPreview, setShowPreview] = useState(false);
  const [profiles, setProfiles] = useState(() => {
  return Object.keys(localStorage)
    .filter((k) => k.startsWith("portfolio_"))
    .map((k) => k.replace("portfolio_", ""));
  });

useEffect(() => {
  const handleClickOutside = (event) => {
    if (
      alertRef.current &&
      !alertRef.current.contains(event.target)
    ) {
      setShowAlerts(false);
    }
  };

  document.addEventListener("mousedown", handleClickOutside);

  return () => {
    document.removeEventListener("mousedown", handleClickOutside);
  };
}, []);

useEffect(() => {
  const fetchEvents = async () => {
    try {
      const res = await fetch(`${API_URL}/api/events`, {
        headers: {
          ...(import.meta.env.VITE_API_KEY && {
            "x-api-key": import.meta.env.VITE_API_KEY,
          }),
        },
      });

      const json = await res.json();

      setEvents({
        active: json.active || [],
        archive: json.archive || []
      });

    } catch (err) {
      console.error("❌ Events fetch failed", err);
    }
  };

  fetchEvents();
}, []);

useEffect(() => {
  posthog.init('phc_uWKkVjeiNkgXHPDMSugLefet86cAmhQcxkgPdUvi2gdm', {
    api_host: 'https://app.posthog.com',
  });

  const profile = getActiveProfile() || "guest";

  posthog.identify(profile);

  posthog.capture('app_opened');
}, []);

  const switchProfile = (newProfile) => {
  setActiveProfile(newProfile);
  setProfile(newProfile);
  setData(loadLocalPortfolio());
};

const refreshProfiles = () => {
  const list = Object.keys(localStorage)
    .filter((k) => k.startsWith("portfolio_"))
    .map((k) => k.replace("portfolio_", ""));

  setProfiles(list);
};

const portfolioSymbols = cleanData.map(d =>
  d.symbol.replace(/-E$|-GB$/i, "")
);

const filteredActive = events.active.filter(e =>
  portfolioSymbols.includes(
    (e.symbol || "").replace(/-E$|-GB$/i, "")
  )
);

const filteredArchive = events.archive.filter(e =>
  portfolioSymbols.includes(
    (e.symbol || "").replace(/-E$|-GB$/i, "")
  )
);

const handleConfirmUpload = async () => {
  try {
    const enriched = previewData.map(item => {
      const investment = item.quantity * item.avgPrice;

      return {
        ...item,
        investment,
        currentPrice: 0,
        currentValue: investment,
        pnl: 0,
        pnlPct: 0,
      };
    });

    // ✅ MERGE INSTEAD OF REPLACE
    const map = new Map();

    cleanData.forEach(d => map.set(d.symbol, d));
    enriched.forEach(d => map.set(d.symbol, d));

    const merged = Array.from(map.values());

    setData(merged);
    saveLocalPortfolio(merged);
    refreshProfiles();

    setShowPreview(false);
    setPreviewData([]);

    alert(`✅ Portfolio updated (${enriched.length} items)`);
  } catch (err) {
    console.error(err);
    alert("❌ Upload failed");
  }
};

const getDiffData = () => {
  const currentMap = new Map(
    data.map((d) => [d.symbol, d])
  );

  const previewMap = new Map(
    previewData.map((d) => [d.symbol, d])
  );

  const diff = [];

  // NEW + UPDATED + SAME
  previewData.forEach((p) => {
    const existing = currentMap.get(p.symbol);

    if (!existing) {
      diff.push({ ...p, type: "NEW" });
    } else if (
      existing.quantity !== p.quantity ||
      existing.avgPrice !== p.avgPrice
    ) {
      diff.push({ ...p, type: "UPDATED" });
    } else {
      diff.push({ ...p, type: "SAME" });
    }
  });

  // REMOVED
  cleanData.forEach((d) => {
    if (!previewMap.has(d.symbol)) {
      diff.push({
        symbol: d.symbol,
        quantity: d.quantity,
        avgPrice: d.avgPrice,
        sector: d.sector,
        type: "REMOVED",
      });
    }
  });

  return diff;
};

  const [form, setForm] = useState({
    symbol: "",
    quantity: "",
    avgPrice: "",
    sector: "",
  });

  const renderCustomLegend = (data) => {
  const total = data.reduce((s, d) => s + d.value, 0);

  return (
    <div style={{ fontSize: 12 }}>
      {data.map((entry, index) => {
        const pct = formatPercent(entry.value, total);

        return (
          <div
            key={index}
            style={{
              display: "flex",
              justifyContent: "space-between",
              marginBottom: 4,
            }}
          >
            <span>
              <span
                style={{
                  display: "inline-block",
                  width: 10,
                  height: 10,
                  background: COLORS[index % COLORS.length],
                  marginRight: 6,
                }}
              />
              {entry.name}
            </span>

            <span>
              ₹{format2(entry.value)} • {pct}%
            </span>
          </div>
        );
      })}
    </div>
  );
};


  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({
    quantity: "",
    avgPrice: "",
  });

  // FIRE
const [rate, setRate] = useState(0);
const [years, setYears] = useState(0);
const [inflation, setInflation] = useState(0);
const [fireTarget, setFireTarget] = useState(0);
const [sip, setSip] = useState(0);

  useEffect(() => {
  if (cleanData.length === 0) {
    setRate(12);
    setYears(10);
    setInflation(6);
    setFireTarget(50000000);
    setSip(0); // 👈 IMPORTANT (reset SIP)
  }
}, [cleanData.length]);

  const resetCalculator = () => {
  setRate(0);
  setYears(0);
  setInflation(0);
  setFireTarget(0);
  setSip(0);
};

  const [futureValue, setFutureValue] = useState(0);
  const [requiredSip, setRequiredSip] = useState(0);

  const fetchData = () => {
  const local = loadLocalPortfolio();
  setData(local);
};

useEffect(() => {
  if (view === "dashboard") {
    posthog.capture('portfolio_viewed');
  }
}, [view]);

useEffect(() => {
  localStorage.setItem("darkMode", dark);
}, [dark]);

useEffect(() => {
  const p = getActiveProfile();
  setProfile(p);
  setData(loadLocalPortfolio());
}, []);

  const totalValue = cleanData.reduce(
  (s, d) => s + (Number(d?.currentValue) || 0),
  0
);

const totalInvestment = cleanData.reduce(
  (s, d) => s + ((Number(d?.quantity) || 0) * (Number(d?.avgPrice) || 0)),
  0
);

const totalPnL = totalValue - totalInvestment;

  const assetTotals = {
  stocks: 0,
  mf: 0,
  etf: 0,
  sgb: 0,
};

const totalPnLPct =
  totalInvestment > 0
    ? ((totalPnL / totalInvestment) * 100)
    : 0;

// 🔥 TODAY CHANGE + TOP MOVERS

const totalToday = cleanData.reduce(
  (sum, d) =>
    sum +
    ((Number(d?.dailyChange) || 0) *
     (Number(d?.quantity) || 0)),
  0
);

const prevValue = totalValue - totalToday;

const todayPct =
  prevValue > 0 ? (totalToday / prevValue) * 100 : 0;

// sort by daily %
const stockOnly = cleanData.filter(
  (d) => d.dailyPct !== 0 && !isNaN(d.dailyPct)
);

const sorted = [...stockOnly].sort(
  (a, b) => (b.dailyPct || 0) - (a.dailyPct || 0)
);

const topGainer = sorted[0];
const topLoser = sorted[sorted.length - 1];


// 🧠 PORTFOLIO HEALTH SCORE

// 1. Diversification
const weights = cleanData.map(d =>
  totalValue > 0 ? (d.currentValue || 0) / totalValue : 0
);
const maxWeight = weights.length ? Math.max(...weights) : 0;

let diversificationScore = 100;
if (maxWeight > 0.4) diversificationScore -= 40;
else if (maxWeight > 0.25) diversificationScore -= 20;

// 2. Sector concentration
const healthSectorMap = {};

cleanData.forEach((d) => {
  const sector = d.sector || "Others";
  healthSectorMap[sector] =
    (healthSectorMap[sector] || 0) + (d.currentValue || 0);
});

const maxSectorValue = Math.max(
  ...Object.values(healthSectorMap),
  0
);

let sectorScore = 100;
if (totalValue > 0 && maxSectorValue / totalValue > 0.5) {
  sectorScore -= 30;
}

// 3. Loss exposure
const lossStocks = cleanData.filter(d => (d.pnl || 0) < 0).length;

const lossScore =
  cleanData.length > 0
    ? 100 - (lossStocks / cleanData.length) * 100
    : 100;

// 4. Return quality
let returnScore = 50;

if (totalPnLPct > 15) returnScore = 100;
else if (totalPnLPct > 5) returnScore = 80;
else if (totalPnLPct > 0) returnScore = 60;
else returnScore = 30;



/* ✅ ADD THIS RIGHT BELOW */

const stockOnly10Rule = cleanData.filter((d) => {
  const symbol = (d.symbol || "").toLowerCase();

  return !(
    symbol.includes("fund") ||
    symbol.includes("plan") ||
    symbol.includes("etf") ||
    symbol.includes("sgb") ||
    symbol.endsWith("-e") ||
    symbol.endsWith("-gb")
  );
});

// ✅ use total portfolio INVESTED amount
const totalInvestedPortfolio = cleanData.reduce(
  (sum, d) => sum + ((d.quantity || 0) * (d.avgPrice || 0)),
  0
);

let overAllocatedStock = null;

if (totalInvestedPortfolio > 0) {
  for (let s of stockOnly10Rule) {

    const invested = (s.quantity || 0) * (s.avgPrice || 0);

    const weight = invested / totalInvestedPortfolio;

    if (weight > 0.1) {
      overAllocatedStock = {
        name: s.symbol,
        pct: (weight * 100).toFixed(1),
      };
      break;
    }
  }
}

const healthScore = hasData
  ? Math.round(
      diversificationScore * 0.35 +
      sectorScore * 0.25 +
      lossScore * 0.2 +
      returnScore * 0.2
    )
  : 0;

cleanData.forEach((d) => {
  const value = d.currentValue || 0;
  const symbol = (d.symbol || "").toLowerCase();

  if (symbol.includes("fund") || symbol.includes("plan")) {
    assetTotals.mf += value;
  } else if (symbol.includes("etf") || symbol.endsWith("-e")) {
    assetTotals.etf += value;
  } else if (symbol.includes("sgb") || symbol.endsWith("-gb")) {
    assetTotals.sgb += value;
  } else {
    assetTotals.stocks += value;
  }
});

  // FIRE CALC
useEffect(() => {
  // ✅ FIX: no portfolio → reset everything
  if (cleanData.length === 0) {
    setFutureValue(0);
    setRequiredSip(0);
    return;
  }

  const r = rate / 100;
  const n = years;
  const inf = inflation / 100;

  if (years <= 0) {
    setFutureValue(0);
    setRequiredSip(0);
    return;
  }

  const inflatedFire = fireTarget * Math.pow(1 + inf, n);
  const fvCurrent = totalValue * Math.pow(1 + r, n);

  let fvSip =
    r > 0
      ? sip * ((Math.pow(1 + r / 12, n * 12) - 1) / (r / 12))
      : sip * 12 * n;

  const totalFuture = fvCurrent + fvSip;
  const remaining = Math.max(inflatedFire - totalFuture, 0);

  let sipNeeded =
    r > 0
      ? remaining /
        ((Math.pow(1 + r / 12, n * 12) - 1) / (r / 12))
      : remaining / (n * 12);

  setFutureValue(Math.round(inflatedFire));
  setRequiredSip(Math.round(sipNeeded));
}, [rate, years, inflation, fireTarget, sip, totalValue, cleanData.length]);

  const progress =
  futureValue > 0
    ? Math.min((totalValue / futureValue) * 100, 100)
    : 0;

  const handleUpdatePrices = async () => {
    posthog.capture('update_prices_clicked');
    if (!data.length) {
  alert("⚠️ No holdings to update");
  return;
}
  try {
    setUpdatingPrices(true);

    const symbols = data.map((d) =>
    d.symbol.replace(/-E$|-GB$/i, "")
  );

    const res = await fetch(`${API_URL}/update-prices`, {
      method: "POST",
      headers: {
  "Content-Type": "application/json",
  ...(import.meta.env.VITE_API_KEY && {
    "x-api-key": import.meta.env.VITE_API_KEY,
  }),
},
      body: JSON.stringify({ symbols }),
    });

    if (!res.ok) {
      throw new Error("Failed to fetch prices");
    }

  const json = await res.json();
  const backendData = json.data || [];

  const priceMap = new Map(
  backendData.map(p => [
    p.symbol.replace(/-E$|-GB$/i, ""),
    p
  ])
);

  const prevPrices = new Map(
  data.map((d) => [d.symbol, d.currentPrice || 0])
);

const updated = data.map((item) => {
  const key = item.symbol.replace(/-E$|-GB$/i, "");
  const match = priceMap.get(key);

  if (!match) return item;

  const currentPrice = Number(match.currentPrice || 0);
  const prevPrice = prevPrices.get(item.symbol);

// 🔥 DAILY CHANGE CALCULATION (FIXED)
  const dailyChange = Number(match.change || 0);
  const dailyPct = Number(match.pChange || 0);

  const investment =
    Number(item.quantity) * Number(item.avgPrice);

  const currentValue =
    Number(item.quantity) * currentPrice;

  const pnl = currentValue - investment;
  const pnlPct =
    investment > 0 ? (pnl / investment) * 100 : 0;

  return {
    ...item,
    currentPrice,
    currentValue,
    pnl,
    pnlPct,
    dailyChange,   // ✅ REQUIRED
    dailyPct,       // ✅ REQUIRED
    high52: match.high52,
  low52: match.low52,
  };
});

    setData(updated);
    saveLocalPortfolio(updated);
    refreshProfiles();
    setLastUpdated(new Date());

    alert("✅ Prices updated successfully");

  } catch (err) {
    console.error("❌ Price update failed", err);
    alert("❌ Failed to update prices");
  } finally {
    setUpdatingPrices(false);
  }
};

  const normalize = (str) =>
  (str || "").toLowerCase().replace(/\s+/g, "").trim();

const findHeaderRow = (rows) => {
  for (let i = 0; i < rows.length; i++) {
    const values = Object.values(rows[i]).map(normalize);

    if (
      values.includes("symbol") ||
      values.includes("tradingsymbol") ||
      values.includes("instrument")
    ) {
      return i;
    }
  }
  return -1;
};

const mapRow = (row, headers) => {
  const get = (keys) => {
    for (let k of keys) {
      const found = headers.find((h) =>
        normalize(h).includes(normalize(k))
      );
      if (found && row[found] != null) return row[found];
    }
    return null;
  };

  const symbol = get(["symbol", "trading symbol", "instrument"]);
  const qty = get(["quantity", "qty", "quantity available"]);
  const avg = get(["average price", "avg price", "cost price"]);
  const sector = get(["sector"]);

  if (!symbol) return null;

  return {
    symbol: String(symbol).trim().toUpperCase(),
    quantity: Number(String(qty || "0").replace(/,/g, "")) || 0,
    avgPrice: Number(String(avg || "0").replace(/,/g, "")) || 0,
    sector: String(sector || "").trim(),
  };
};

const handleDrop = (e) => {
  e.preventDefault();
  const file = e.dataTransfer.files?.[0];
  if (!file) return;

  handleFileUpload({ target: { files: [file] } });
};

const handleDragOver = (e) => {
  e.preventDefault();
};

// ✅ NEW: shared parser
const handleParsedData = async (results) => {
  try {
    const rows = results.data;

    console.log("Raw rows:", rows.slice(0, 10));

    let headerIndex = -1;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i].map((c) =>
        (c || "").toString().toLowerCase()
      );

      if (
        row.some((c) =>
          c.includes("symbol") ||
          c.includes("trading") ||
          c.includes("instrument")
        )
      ) {
        headerIndex = i;
        break;
      }
    }

    if (headerIndex === -1) {
      alert("❌ Could not detect header row");
      return;
    }

    const headers = rows[headerIndex];

    console.log("Detected headers:", headers);

    const normalize = (str) =>
      (str || "").toLowerCase().replace(/[^a-z]/g, "");

    const cleaned = rows
      .slice(headerIndex + 1)
      .map((row) => {
        const obj = {};

        headers.forEach((h, i) => {
          obj[h] = row[i];
        });

        const keys = Object.keys(obj);

        const get = (possible) => {
          for (let p of possible) {
            const found = keys.find((k) =>
              normalize(k).includes(normalize(p))
            );
            if (found && obj[found]) return obj[found];
          }
          return null;
        };

        const symbol = get(["symbol", "tradingsymbol", "instrument"]);
        const qty = get(["qty", "quantity"]);
        const avg = get(["avgcost", "averageprice", "cost"]);
        const sector = get(["sector"]);

        if (!symbol) return null;

        return {
          symbol: String(symbol).trim(),
          quantity:
            Number(String(qty || "0").replace(/,/g, "")) || 0,
          avgPrice:
            Number(String(avg || "0").replace(/,/g, "")) || 0,
          sector: String(sector || "").trim(),
        };
      })
      .filter((x) => x && x.symbol);

    console.log("✅ Cleaned:", cleaned);

    if (!cleaned.length) {
      alert("⚠️ No valid holdings found in file");
      return;
    }

    setPreviewData(cleaned);
    setShowPreview(true);

  } catch (err) {
    console.error("❌ Upload failed:", err);
    alert("❌ Upload failed. Check console.");
  }
};

const handleFileUpload = (e) => {
  posthog.capture('file_uploaded');
  console.log("📂 File upload triggered");

  const file = e.target.files?.[0];
  if (!file) {
    alert("❌ No file selected");
    return;
  }

  const isCSV = file.name.toLowerCase().endsWith(".csv");

  // ================= CSV =================
  if (isCSV) {
    Papa.parse(file, {
      header: false,
      skipEmptyLines: true,
      complete: handleParsedData,
    });
    return;
  }

  // ================= EXCEL =================
  const reader = new FileReader();

  reader.onload = (evt) => {
    try {
      const data = new Uint8Array(evt.target.result);

      const workbook = XLSX.read(data, { type: "array" });

      const sheet = workbook.Sheets[workbook.SheetNames[0]];

      const rows = XLSX.utils.sheet_to_json(sheet, {
        header: 1,
        defval: "",
      });

      handleParsedData({ data: rows });

    } catch (err) {
      console.error("❌ Excel parse failed:", err);
      alert("❌ Failed to read Excel file");
    }
  };

  reader.readAsArrayBuffer(file);
};

  const chartData = data.map((d) => ({
    name: d.symbol,
    value: d.currentValue || 0,
  }));

  const sectorMap = {};
  cleanData.forEach((d) => {
    if (!d.sector) return;
    sectorMap[d.sector] = (sectorMap[d.sector] || 0) + (d.currentValue || 0);
  });

  const sectorData = Object.keys(sectorMap).map((s) => ({
    name: s,
    value: sectorMap[s],
  }));

  // INSIGHTS
  const stockHoldings = data.filter(
    (h) =>
      !h.symbol.toLowerCase().includes("fund") &&
      !h.symbol.toLowerCase().includes("plan")
  );

  const totalStockInvestment = stockHoldings.reduce(
    (sum, h) => sum + h.quantity * h.avgPrice,
    0
  );

  const maxPerStock = totalStockInvestment * 0.1;

  const exceededStocks = stockHoldings
    .map((h) => {
      const investment = h.quantity * h.avgPrice;
      const excess = investment - maxPerStock;

      return {
        ...h,
        investment,
        excess,
        isExceeded: investment > maxPerStock,
      };
    })
    .filter((h) => h.isExceeded);

  const allocation = { stocks: 0, mf: 0, etf: 0, sgb: 0 };

  cleanData.forEach((h) => {
    const investment = h.quantity * h.avgPrice;
    const symbol = h.symbol.toLowerCase();

    if (symbol.includes("sgb")) allocation.sgb += investment;
    else if (symbol.endsWith("-e")) allocation.etf += investment;
    else if (symbol.includes("fund") || symbol.includes("plan"))
      allocation.mf += investment;
    else allocation.stocks += investment;
  });

  const sortedData = [...cleanData].sort((a, b) => {
  if (!sortKey) return 0;

  const A = a[sortKey];
  const B = b[sortKey];

  // ✅ NUMBER SORT
  return sortDir === "asc"
    ? (A || 0) - (B || 0)
    : (B || 0) - (A || 0);
});

  const assetData = [
    { name: "Stocks", value: allocation.stocks },
    { name: "MF", value: allocation.mf },
    { name: "ETF", value: allocation.etf },
    { name: "SGB", value: allocation.sgb },
  ];

const diffData = getDiffData();

const summary = {
  new: diffData.filter(d => d.type === "NEW").length,
  updated: diffData.filter(d => d.type === "UPDATED").length,
  removed: diffData.filter(d => d.type === "REMOVED").length,
};

if (!profile) {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: theme.bg,
        color: theme.text
      }}
    >
      <div
        className="card"
        style={{
          width: 420,
          padding: 30,
          borderRadius: 16,
          textAlign: "center",
          boxShadow: "0 10px 30px rgba(0,0,0,0.2)"
        }}
      >
        {/* TITLE */}
        <h2 style={{ marginBottom: 10 }}>
          📊 Portfolio Management
        </h2>

        {/* SUBTEXT */}
        <p style={{
          fontSize: 13,
          color: theme.subText,
          marginBottom: 20
        }}>
          Track your investments privately. No login required.
        </p>

        {/* INPUT */}
        <input
          placeholder="Enter your name"
          autoFocus
          style={{
            width: "100%",
            padding: "10px 12px",
            borderRadius: 8,
            border: `1px solid ${theme.border}`,
            background: "#3b82f6",
color: "#fff",
            marginBottom: 12
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && e.target.value.trim()) {
              const name = e.target.value.trim();

              setActiveProfile(name);
              setProfile(name);
              fetchData();
            }
          }}
        />

        {/* BUTTON */}
        <button
          onClick={() => {
            const input = document.querySelector("input");
            if (!input.value.trim()) return;

            const name = input.value.trim();

            setActiveProfile(name);
            setProfile(name);
            fetchData();
          }}
          style={{
            width: "100%",
            padding: "10px",
            borderRadius: 8,
            background: theme.card,
            border: "none",
            color: theme.text,
            fontWeight: 500,
            cursor: "pointer"
          }}
        >
          Continue
        </button>

        {/* OPTIONAL FOOTNOTE */}
        <p style={{
          fontSize: 11,
          color: theme.subText,
          marginTop: 12
        }}>
          Data stays on your device
        </p>
      </div>
    </div>
  );
}

  return (
    <div
  className={dark ? "app dark" : "app"}
  style={{
    display: "flex",   // ✅ IMPORTANT
    background: theme.bg,
    minHeight: "100vh",
    color: theme.text
  }}
>

<aside
  className="sidebar"
  style={{
    background: theme.card,
    color: theme.text,
    borderRight: `1px solid ${theme.border}`,
    width: 220,
    minWidth: 220
  }}
>
  <h2>Portfolio Management</h2>

  {/* DASHBOARD */}
  <div
    onClick={() => setView("dashboard")}
    style={{
      display: "flex",
      alignItems: "center",
      gap: 10,
      padding: "8px 10px",
      borderRadius: 8,
      cursor: "pointer",
      background: view === "dashboard" ? "#2563eb" : "transparent",
      color: view === "dashboard" ? "#fff" : theme.text,
    }}
  >
    <LayoutDashboard size={18} strokeWidth={1.5} />
    <span>Dashboard</span>
  </div>

  {/* ANALYTICS */}
  <div
    onClick={() => setView("analytics")}
    style={{
      display: "flex",
      alignItems: "center",
      gap: 10,
      padding: "8px 10px",
      borderRadius: 8,
      cursor: "pointer",
      background: view === "analytics" ? "#2563eb" : "transparent",
      color: view === "analytics" ? "#fff" : theme.text,
    }}
  >
    <BarChart3 size={18} strokeWidth={1.5} />
    <span>Analytics</span>
  </div>

  {/* INSIGHTS */}
  <div
    onClick={() => setView("insights")}
    style={{
      display: "flex",
      alignItems: "center",
      gap: 10,
      padding: "8px 10px",
      borderRadius: 8,
      cursor: "pointer",
      background: view === "insights" ? "#2563eb" : "transparent",
      color: view === "insights" ? "#fff" : theme.text,
    }}
  >
    <Lightbulb size={18} strokeWidth={1.5} />
    <span>Insights</span>
  </div>

  {/* HELP */}
  <div
    onClick={() => setView("help")}
    style={{
      display: "flex",
      alignItems: "center",
      gap: 10,
      padding: "8px 10px",
      borderRadius: 8,
      cursor: "pointer",
      background: view === "help" ? "#2563eb" : "transparent",
      color: view === "help" ? "#fff" : theme.text,
    }}
  >
    <HelpCircle size={18} strokeWidth={1.5} />
    <span>Help</span>
  </div>

  {/* ABOUT */}
  <div
    onClick={() => setView("about")}
    style={{
      display: "flex",
      alignItems: "center",
      gap: 10,
      padding: "8px 10px",
      borderRadius: 8,
      cursor: "pointer",
      background: view === "about" ? "#2563eb" : "transparent",
      color: view === "about" ? "#fff" : theme.text,
    }}
  >
    <Info size={18} strokeWidth={1.5} />
    <span>About</span>
  </div>

  {/* SUPPORT */}
  <div
    onClick={() => setView("support")}
    style={{
      display: "flex",
      alignItems: "center",
      gap: 10,
      padding: "8px 10px",
      borderRadius: 8,
      cursor: "pointer",
      background: view === "support" ? "#2563eb" : "transparent",
      color: view === "support" ? "#fff" : theme.text,
    }}
  >
    <Heart size={18} strokeWidth={1.5} />
    <span>Support</span>
  </div>

  {/* THEME TOGGLE */}
  
   <div
  onClick={() => setDark(!dark)}
  style={{
    display: "flex",
    alignItems: "center",
    gap: 6,
    cursor: "pointer"
  }}
>
  <span style={{ fontSize: 12 }}>
    {dark ? "🌙" : "☀️"}
  </span>

  <div
    style={{
      width: 40,
      height: 20,
      borderRadius: 999,
      background: dark ? "#2563eb" : "#e5e7eb",
      padding: 2,
      display: "flex",
      alignItems: "center"
    }}
  >
    <div
      style={{
        width: 16,
        height: 16,
        borderRadius: "50%",
        background: "#fff",
        transform: dark ? "translateX(18px)" : "translateX(0px)",
        transition: "0.25s"
      }}
    />
  </div>
</div>
</aside>

      <main
  className="main"
  style={{
  flex: 1,                // ✅ take remaining space
  padding: 20,
  overflowX: "hidden",    // prevents layout shift
  color: theme.text
}}
>

<div
  style={{
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 18,
    gap: 12
  }}
>

  {/* LEFT */}
  <div>
    <h2 style={{ margin: 0, fontWeight: 600 }}>
      Hello, {profile} 👋
    </h2>
    <div style={{ fontSize: 12, opacity: 0.7 }}>
      Here's your portfolio overview
    </div>
  </div>

  {showProfileModal && (
  <div
    style={{
      position: "fixed",
      top: 0,
      left: 0,
      width: "100%",
      height: "100%",
      background: "rgba(0,0,0,0.5)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      zIndex: 200
    }}
    onClick={() => setShowProfileModal(false)}
  >
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        width: 360,
        maxHeight: "70vh",
        overflowY: "auto",
        background: theme.card,
        borderRadius: 14,
        border: `1px solid ${theme.border}`,
        padding: 16
      }}
    >

      <h3 style={{ marginBottom: 12 }}>Manage Profiles</h3>

      {/* PROFILE LIST */}
      {profiles.map((p) => (
        <div
          key={p}
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "8px 10px",
            borderRadius: 8,
            marginBottom: 6,
            background: p === profile ? "#2563eb" : "transparent",
            color: p === profile ? "#fff" : theme.text
          }}
        >
          {/* SWITCH */}
          <span
            style={{ cursor: "pointer", flex: 1 }}
            onClick={() => {
              switchProfile(p);
              setShowProfileModal(false);
            }}
          >
            👤 {p}
          </span>

          {/* DELETE */}
          {p !== profile && (
            <span
              onClick={() => {
                if (!confirm(`Delete "${p}"?`)) return;

                localStorage.removeItem(`portfolio_${p}`);
                refreshProfiles();
              }}
              style={{
                color: "#ef4444",
                cursor: "pointer",
                fontSize: 12
              }}
            >
              ✕
            </span>
          )}
        </div>
      ))}

      {/* NEW PROFILE */}
      <div
        style={{
          marginTop: 10,
          padding: "10px",
          borderTop: `1px solid ${theme.border}`,
          cursor: "pointer"
        }}
        onClick={() => {
          const name = prompt("Enter profile name");
          if (!name) return;

          const trimmed = name.trim();

          setActiveProfile(trimmed);
          setProfile(trimmed);
          saveLocalPortfolio([]);
          setData([]);

          refreshProfiles();
          setShowProfileModal(false);
        }}
      >
        ➕ New Profile
      </div>

      {/* CLOSE */}
      <button
        onClick={() => setShowProfileModal(false)}
        style={{
          marginTop: 10,
          width: "100%",
          padding: "8px",
          borderRadius: 8,
          border: "none",
          background: "#2563eb",
          color: "#fff",
          cursor: "pointer"
        }}
      >
        Close
      </button>

    </div>
  </div>
)}

  {/* RIGHT */}
  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>

    {/* 🔍 SEARCH */}
    <input
      value={search}
      onChange={(e) => setSearch(e.target.value)}
      placeholder="Search holdings..."
      style={{
        padding: "8px 12px",
        borderRadius: 8,
        border: `1px solid ${theme.border}`,
        background: theme.card,
        color: theme.text,
        fontSize: 13,
        width: 220
      }}
    />

  {/* 🔔 ALERTS */}
<div style={{ position: "relative" }} ref={alertRef}>
  {/* 🔔 ICON */}
  <div
    onClick={() => setShowAlerts(prev => !prev)}
    style={{
      width: 34,
      height: 34,
      borderRadius: "50%",
      background: theme.card,
      border: `1px solid ${theme.border}`,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      cursor: "pointer",
      position: "relative"
    }}
  >
    <Bell size={18} />

    {/* BADGE */}
    {filteredActive.length > 0 && (
      <span
        style={{
          position: "absolute",
          top: -4,
          right: -4,
          background: "#ef4444",
          color: "#fff",
          fontSize: 10,
          borderRadius: "50%",
          padding: "2px 5px"
        }}
      >
        {filteredActive.length}
      </span>
    )}
  </div>

  {/* 🔽 DROPDOWN */}
{showAlerts && (
  <div
    style={{
      position: "absolute",
      right: 0,
      top: 42,
      width: 300,
      maxHeight: 320,
      overflowY: "auto",
      background: theme.card,
      border: `1px solid ${theme.border}`,
      borderRadius: 12,
      boxShadow: "0 10px 25px rgba(0,0,0,0.2)",
      zIndex: 100
    }}
  >
    <div style={{ padding: 10, fontSize: 12, opacity: 0.7 }}>
      Updates
    </div>

    {/* 🔄 LOADING */}
    {events.active.length === 0 && events.archive.length === 0 ? (
      <div style={{ padding: 10, fontSize: 12 }}>
        No recent updates
      </div>
    ) : (
      <>
        {/* 🟢 ACTIVE */}
        {filteredActive.length > 0 && (
          <>
            <div style={{
              padding: "6px 10px",
              fontSize: 11,
              opacity: 0.6
            }}>
              Active
            </div>

            {filteredActive.map((e, i) => (
              <div
                key={`a-${i}`}
                style={{
                  padding: 10,
                  borderTop: `1px solid ${theme.border}`
                }}
              >
                <div style={{ fontWeight: 600 }}>
                  {e.symbol}
                </div>

                <div style={{ fontSize: 12 }}>
                  {e.title}
                </div>

                <div style={{ fontSize: 11, opacity: 0.6 }}>
                  📅 {e.date}
                </div>

                {e.recordDate && (
                  <div style={{ fontSize: 11, opacity: 0.7 }}>
                    📌 Record: {e.recordDate}
                  </div>
                )}
              </div>
            ))}
          </>
        )}

        {/* 🟡 ARCHIVE */}
        {filteredArchive.length > 0 && (
          <>
            <div style={{
              padding: "6px 10px",
              fontSize: 11,
              opacity: 0.5
            }}>
              Archive
            </div>

            {filteredArchive.map((e, i) => (
              <div
                key={`ar-${i}`}
                style={{
                  padding: 10,
                  borderTop: `1px solid ${theme.border}`,
                  opacity: 0.7
                }}
              >
                <div style={{ fontWeight: 600 }}>
                  {e.symbol}
                </div>

                <div style={{ fontSize: 12 }}>
                  {e.title}
                </div>

                <div style={{ fontSize: 11, opacity: 0.6 }}>
                  📅 {e.date}
                </div>
              </div>
            ))}
          </>
        )}
      </>
    )}
  </div>
)} 
</div>

    {/* 👤 PROFILE */}
    <div style={{ position: "relative" }}>
      <div
        onClick={() => setShowProfileMenu(prev => !prev)}
        style={{
          width: 34,
          height: 34,
          borderRadius: "50%",
          background: "#3b82f6",
          color: "#fff",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          fontWeight: 600
        }}
      >
        {profile?.charAt(0)?.toUpperCase()}
      </div>

      {showProfileMenu && (
        <div
          style={{
            position: "absolute",
            right: 0,
            top: 42,
            background: theme.card,
            border: `1px solid ${theme.border}`,
            borderRadius: 12,
            width: 180,
            boxShadow: "0 10px 25px rgba(0,0,0,0.2)",
            overflow: "hidden",
            zIndex: 100
          }}
        >
          <div
            style={{ padding: 10, cursor: "pointer" }}
            onClick={() => {
              setShowProfileModal(true);
              setShowProfileMenu(false);
            }}
          >
            👥 Manage Profiles
          </div>

          <div
            style={{ padding: 10, cursor: "pointer", color: "#ef4444" }}
            onClick={() => {
              localStorage.setItem("activeProfile", "default");
              setProfile(null);
              setData([]);
              setShowProfileMenu(false);
            }}
          >
            🚪 Logout
          </div>
        </div>
      )}
    </div>

  </div>
</div>


        {/* DASHBOARD */}
        {view === "dashboard" && (
  <>

     {/* ✅ EMPTY STATE MESSAGE */}
    {data.length === 0 && (
      <p style={{ color: theme.subText, marginBottom: 12 }}>
        No data found. Upload your portfolio to begin.
      </p>
    )}

{/* 🔷 TOP BAR */}
<div
  style={{
    display: "flex",
    justifyContent: "flex-end",
    alignItems: "center",
    marginBottom: 16,
    gap: 10,
    flexWrap: "wrap"
  }}
>

  {/* IMPORT BUTTON */}
  <label
    style={{
      padding: "6px 12px",
      borderRadius: 8,
      border: `1px solid ${theme.border}`,
      background: theme.card,
      color: theme.text,
      fontSize: 12,
      cursor: "pointer",
      display: "flex",
      alignItems: "center",
      gap: 6
    }}
  >
    ⬆ Import Portfolio
    <input
      type="file"
      accept=".csv, .xls, .xlsx"
      onChange={handleFileUpload}
      style={{ display: "none" }}
    />
  </label>

  {/* UPDATE BUTTON */}
  <button
    onClick={handleUpdatePrices}
    disabled={updatingPrices}
    style={{
      padding: "6px 12px",
      borderRadius: 8,
      background: updatingPrices ? "#1e293b" : "#2563eb",
      border: "none",
      color: "#fff",
      fontSize: 12,
      cursor: updatingPrices ? "not-allowed" : "pointer",
      opacity: updatingPrices ? 0.7 : 1
    }}
  >
    {updatingPrices ? "⏳ Updating..." : "🔄 Update Price"}
  </button>

</div>

    {/* 🔶 PREVIEW PANEL */}
    {showPreview && (
  <div className="card" style={{ marginBottom: 20, padding: 16 }}>

        <h3 style={{ color: theme.text }}>
          📄 Preview Upload ({previewData.length} items)
        </h3>

        {/* SUMMARY */}
        <div style={{
          display: "flex",
          gap: 12,
          flexWrap: "wrap",
          marginBottom: 12,
          fontSize: 13
        }}>
          <span style={{ color: "#22c55e" }}>🟢 New: {summary.new}</span>
          <span style={{ color: "#3b82f6" }}>🔵 Updated: {summary.updated}</span>
          <span style={{ color: "#ef4444" }}>🔴 Removed: {summary.removed}</span>
        </div>

        {/* TABLE */}
        <div style={{ maxHeight: 350, overflowY: "auto", overflowX: "auto" }}>
        <table
  className="table"
  style={{
    width: "100%",
    tableLayout: "fixed"
  }}
>
            <thead>
  <tr>
    <th style={{ fontWeight: 500, color: theme.subText }}>Status</th>
    <th style={{ fontWeight: 500, color: theme.subText }}>Symbol</th>
    <th style={{ fontWeight: 500, color: theme.subText }}>Qty</th>
    <th style={{ fontWeight: 500, color: theme.subText }}>Avg Price</th>
    <th style={{ fontWeight: 500, color: theme.subText }}>Sector</th>
  </tr>
</thead>

            <tbody>
              {diffData.map((row, i) => (
                <tr key={i}>
                  <td>
                    {row.type === "NEW" && "🟢 New"}
                    {row.type === "UPDATED" && "🔵 Updated"}
                    {row.type === "SAME" && "⚪ Same"}
                    {row.type === "REMOVED" && "🔴 Removed"}
                  </td>
                  <td>{row.symbol}</td>
                  <td>{row.quantity}</td>
                  <td>{row.avgPrice}</td>
                  <td>{row.sector || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* ACTION BUTTONS */}
        <div style={{
          display: "flex",
          justifyContent: "flex-end",
          gap: 10,
          marginTop: 12
        }}>
          <button
            onClick={() => {
              setShowPreview(false);
              setPreviewData([]);
            }}
            style={{
              padding: "6px 12px",
              borderRadius: 6,
              background: theme.card,
              border: `1px solid ${theme.border}`,
              color: theme.subText
            }}
          >
            Cancel
          </button>

          <button
            onClick={handleConfirmUpload}
            style={{
  padding: "6px 12px",
  borderRadius: 6,
  background: "#3b82f6",
  border: "none",
  color: "#fff"
}}
          >
            Confirm Upload
          </button>
        </div>
      </div>
    )}

<div
  className="card"
  style={{
    marginBottom: 16,
    padding: 16,
    border: `1px solid ${theme.border}`,
    borderRadius: 14,
  }}
>
  <h3 style={{ color: theme.subText }}>Portfolio Health</h3>

  {/* SCORE + DOTS */}
  <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 6 }}>
    
    <span
      style={{
        fontSize: 20,
        fontWeight: 600,
        color:
          healthScore >= 80
            ? "#22c55e"
            : healthScore >= 60
            ? "#f59e0b"
            : "#ef4444",
      }}
    >
      {hasData ? `${healthScore} / 100` : "-"}
    </span>

    {/* DOT VISUAL */}
    <div style={{ display: "flex", gap: 4 }}>
      {[...Array(10)].map((_, i) => {
        const filled = i < Math.round(healthScore / 10);

        return (
          <span
            key={i}
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: filled
                ? healthScore >= 80
                  ? "#22c55e"
                  : healthScore >= 60
                  ? "#f59e0b"
                  : "#ef4444"
                : "#374151",
              display: "inline-block",
            }}
          />
        );
      })}
    </div>
  </div>

  {/* LABEL */}
  <div style={{ fontSize: 12, opacity: 0.8, marginTop: 4 }}>
    {!hasData
  ? "Upload portfolio to see health score"
  : healthScore >= 80
  ? "Strong portfolio"
  : healthScore >= 60
  ? "Balanced portfolio"
  : "Needs attention"}
  </div>

  {/* WARNINGS */}
  <div style={{ marginTop: 10, fontSize: 12, opacity: 0.85 }}>
    {maxWeight > 0.4 && (
      <div style={{ color: "#f59e0b" }}>
        ⚠️ One stock dominates your portfolio
      </div>
    )}

    {totalValue > 0 && maxSectorValue / totalValue > 0.5 && (
      <div style={{ color: "#f59e0b" }}>
        ⚠️ High sector concentration
      </div>
    )}

    {lossStocks > cleanData.length / 2 && (
      <div style={{ color: "#ef4444" }}>
        ⚠️ Majority of stocks are in loss
      </div>
    )}
  </div>
</div>

{/* 🔶 TODAY + TOP MOVERS */}
<div
  style={{
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
    gap: 14,
    marginBottom: 16,
  }}
>
  {/* TODAY */}
  <div
    className="card"
    style={{
      padding: 16,
      borderRadius: 14,
      border: `1px solid ${theme.border}`,
    }}
  >
    <h3 style={{ color: theme.subText }}>Today</h3>

    <p
      className={
        totalToday > 0 ? "green" : totalToday < 0 ? "red" : ""
      }
      style={{ fontSize: 18, fontWeight: 600 }}
    >
      ₹{totalToday.toLocaleString()}{" "}
      {totalToday > 0 ? "▲" : totalToday < 0 ? "▼" : ""}
    </p>

    <span style={{ fontSize: 12, opacity: 0.8 }}>
      {todayPct.toFixed(2)}%
    </span>

    {/* ⏱ TIMESTAMP */}
    <div style={{ fontSize: 11, opacity: 0.6, marginTop: 4 }}>
      {lastUpdated
        ? `Updated at ${lastUpdated.toLocaleTimeString()}`
        : "Not updated yet"}
    </div>
  </div>

  {/* TOP GAINER */}
  {topGainer && (
    <div className="card" style={{ padding: 16, borderRadius: 14 }}>
      <h3 style={{ color: theme.subText }}>Top Gainer</h3>

      <p style={{ fontWeight: 600 }}>
        {topGainer.symbol}
      </p>

      <span className="green" style={{ fontSize: 12 }}>
        ₹{(topGainer.dailyChange * topGainer.quantity)?.toFixed(0)} ▲ (
        {topGainer.dailyPct?.toFixed(2)}%)
      </span>
    </div>
  )}

  {/* TOP LOSER */}
  {topLoser && (
    <div className="card" style={{ padding: 16, borderRadius: 14 }}>
      <h3 style={{ color: theme.subText }}>Top Loser</h3>

      <p style={{ fontWeight: 600 }}>
        {topLoser.symbol}
      </p>

      <span className="red" style={{ fontSize: 12 }}>
        ₹{(topLoser.dailyChange * topLoser.quantity)?.toFixed(0)} ▼ (
        {topLoser.dailyPct?.toFixed(2)}%)
      </span>
    </div>
  )}
</div>

    {/* 🔷 KPI CARDS */}
<div
  style={{
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
    gap: 14,
    marginBottom: 20,
  }}
>
  {/* Investment */}
  <div
    className="card"
    style={{
      background: theme.card,
      border: `1px solid ${theme.border}`,
      padding: 18,
      borderRadius: 14,
      transition: "all 0.2s ease",
    }}
  >
    <h3 style={{ color: theme.subText }}>Investment</h3>
    <p style={{ fontSize: 18, fontWeight: 600 }}>
      ₹
      {totalInvestment.toLocaleString(undefined, {
        maximumFractionDigits: 0,
      })}
    </p>
  </div>

  {/* Value */}
  <div
    className="card"
    style={{
      background: theme.card,
      border: `1px solid ${theme.border}`,
      padding: 18,
      borderRadius: 14,
      transition: "all 0.2s ease",
    }}
  >
    <h3 style={{ color: theme.subText }}>Value</h3>
    <p style={{ fontSize: 18, fontWeight: 600 }}>
      ₹{totalValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}
    </p>
  </div>

  {/* P&L */}
  <div
    className="card"
    style={{
      background: theme.card,
      border: `1px solid ${theme.border}`,
      padding: 18,
      borderRadius: 14,
      transition: "all 0.2s ease",
    }}
  >
    <h3 style={{ color: theme.subText }}>P&L</h3>
    <p
      className={totalPnL > 0 ? "green" : totalPnL < 0 ? "red" : ""}
      style={{ fontSize: 18, fontWeight: 600 }}
    >
      ₹{totalPnL.toLocaleString()} {totalPnL > 0 ? "▲" : totalPnL < 0 ? "▼" : ""}
    </p>
  </div>

  {/* P&L % */}
  <div
    className="card"
    style={{
      background: theme.card,
      border: `1px solid ${theme.border}`,
      padding: 18,
      borderRadius: 14,
      transition: "all 0.2s ease",
    }}
  >
    <h3 style={{ color: theme.subText }}>P&L (%)</h3>
    <p
      className={totalPnLPct > 0 ? "green" : totalPnLPct < 0 ? "red" : ""}
      style={{ fontSize: 18, fontWeight: 600 }}
    >
      {totalPnLPct.toFixed(2)}%{" "}
      {totalPnLPct > 0 ? "▲" : totalPnLPct < 0 ? "▼" : ""}
    </p>
  </div>
</div>

{/* ADD HOLDING */}
<div className="card" style={{ marginTop: 20, padding: 16 }}>
  <h3 style={{ color: theme.text, marginBottom: 10 }}>Add Holding</h3>

  <div
    style={{
      display: "grid",
      gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
      gap: 10,
      alignItems: "center",
    }}
  >
    <input
      placeholder="Symbol"
      value={form.symbol}
      onChange={(e) => setForm({ ...form, symbol: e.target.value })}
      style={{
        padding: "8px 10px",
        borderRadius: 8,
        border: `1px solid ${theme.border}`,
        background: theme.card,
        color: theme.text,
        fontSize: 13,
      }}
    />

    <input
      placeholder="Quantity"
      type="number"
      value={form.quantity}
      onChange={(e) => setForm({ ...form, quantity: e.target.value })}
      style={{
        padding: "8px 10px",
        borderRadius: 8,
        border: `1px solid ${theme.border}`,
        background: theme.card,
        color: theme.text,
        fontSize: 13,
      }}
    />

    <input
      placeholder="Avg Price"
      type="number"
      value={form.avgPrice}
      onChange={(e) => setForm({ ...form, avgPrice: e.target.value })}
      style={{
        padding: "8px 10px",
        borderRadius: 8,
        border: `1px solid ${theme.border}`,
        background: theme.card,
        color: theme.text,
        fontSize: 13,
      }}
    />

    <input
      placeholder="Sector"
      value={form.sector}
      onChange={(e) => setForm({ ...form, sector: e.target.value })}
      style={{
        padding: "8px 10px",
        borderRadius: 8,
        border: `1px solid ${theme.border}`,
        background: theme.card,
        color: theme.text,
        fontSize: 13,
      }}
    />

    {/* ADD BUTTON */}
    <button
      onClick={async () => {
        posthog.capture('holding_added');
        if (!form.symbol || !form.quantity || !form.avgPrice) return;

        const newItem = {
          symbol: form.symbol.trim().toUpperCase(),
          quantity: Number(form.quantity),
          avgPrice: Number(form.avgPrice),
          sector: form.sector || "Others",
        };

        const exists = data.find(
          (item) => item.symbol === newItem.symbol
        );

        let updated;

        if (exists) {
          updated = data.map((item) =>
            item.symbol === newItem.symbol
              ? {
                  ...item,
                  quantity: item.quantity + newItem.quantity,
                  avgPrice: newItem.avgPrice,
                }
              : item
          );
        } else {
          updated = [...data, newItem];
        }

        setData(updated);
        saveLocalPortfolio(updated);
        refreshProfiles();

        setForm({
          symbol: "",
          quantity: "",
          avgPrice: "",
          sector: "",
        });
      }}
      style={{
        padding: "8px 12px",
        borderRadius: 8,
        background: "#2563eb",
        border: "none",
        color: "#fff",
        cursor: "pointer",
        fontSize: 13,
        fontWeight: 500,
        height: "36px",
      }}
    >
      ➕ Add
    </button>
  </div>
</div>

            {/* TABLE */}
            <div style={{ overflowX: "auto", maxHeight: "65vh" }}>
  <table
    className="table"
    style={{
      minWidth: 900,
      borderCollapse: "collapse"
    }}
  >
              <thead
  style={{
    position: "sticky",
    top: 0,
    background: theme.card,
    zIndex: 5
  }}
>
                <tr>
  <th style={{ textAlign: "left", width: 180 }}>Stock</th>
  <th style={{ textAlign: "left", width: 140 }}>Sector</th>
  <th style={{ textAlign: "center", width: 160 }}>52W Range</th>

  <th style={{ textAlign: "right", width: 80 }}>Qty</th>
  <th style={{ textAlign: "right", width: 100 }}>Avg</th>
  <th style={{ textAlign: "right", width: 100 }}>Price</th>

  {/* SORTABLE VALUE */}
  <th
    style={{
      textAlign: "right",
      width: 120,
      cursor: "pointer",
      opacity: sortKey === "currentValue" ? 1 : 0.7
    }}
    onClick={() => {
      if (sortKey === "currentValue") {
        setSortDir(sortDir === "asc" ? "desc" : "asc");
      } else {
        setSortKey("currentValue");
        setSortDir("desc");
      }
    }}
  >
    Value
    <span style={{ marginLeft: 4, fontSize: 10 }}>
      {sortKey === "currentValue"
        ? sortDir === "asc"
          ? "▲"
          : "▼"
        : "⇅"}
    </span>
  </th>

  {/* SORTABLE P&L */}
  <th
    style={{
      textAlign: "right",
      width: 120,
      cursor: "pointer",
      opacity: sortKey === "pnl" ? 1 : 0.7
    }}
    onClick={() => {
      if (sortKey === "pnl") {
        setSortDir(sortDir === "asc" ? "desc" : "asc");
      } else {
        setSortKey("pnl");
        setSortDir("desc");
      }
    }}
  >
    P&amp;L
    <span style={{ marginLeft: 4, fontSize: 10 }}>
      {sortKey === "pnl"
        ? sortDir === "asc"
          ? "▲"
          : "▼"
        : "⇅"}
    </span>
  </th>

  {/* SORTABLE % */}
  <th
    style={{
      textAlign: "right",
      width: 90,
      cursor: "pointer",
      opacity: sortKey === "pnlPct" ? 1 : 0.7
    }}
    onClick={() => {
      if (sortKey === "pnlPct") {
        setSortDir(sortDir === "asc" ? "desc" : "asc");
      } else {
        setSortKey("pnlPct");
        setSortDir("desc");
      }
    }}
  >
    %
    <span style={{ marginLeft: 4, fontSize: 10 }}>
      {sortKey === "pnlPct"
        ? sortDir === "asc"
          ? "▲"
          : "▼"
        : "⇅"}
    </span>
  </th>

  <th style={{ textAlign: "center", width: 100 }}>Action</th>
</tr>
              </thead>

            <tbody>
  {sortedData
  .filter((d) =>
    (d.symbol || "")
      .toLowerCase()
      .includes(search.toLowerCase())
  )
  .map((d) => {
    const isEditing = editingId === d.symbol;
    const range = d.high52 && d.low52 ? d.high52 - d.low52 : 0;

const position =
  range > 0
    ? ((d.currentPrice - d.low52) / range) * 100
    : 0;

const clampedPosition = Math.max(0, Math.min(100, position));

    return (
      <tr
  key={d.symbol}
  style={{
    borderBottom: `1px solid ${theme.border}`,
    transition: "background 0.2s ease"
  }}
  onMouseEnter={(e) => {
    e.currentTarget.style.background = dark ? "#111827" : "#f9fafb";
  }}
  onMouseLeave={(e) => {
    e.currentTarget.style.background = "transparent";
  }}
>
 <td
  style={{
    width: 180,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    verticalAlign: "top"
  }}
>
  {isEditing ? (
    <input
      value={editForm.symbol}
      onChange={(e) =>
        setEditForm({ ...editForm, symbol: e.target.value.toUpperCase() })
      }
      style={{
        padding: "6px 8px",
        borderRadius: 6,
        border: `1px solid ${theme.border}`,
        background: theme.card,
        color: theme.text,
        fontSize: 12,
        width: "100%"   // ✅ IMPORTANT (fixes alignment)
      }}
    />
  ) : (
    <div
      style={{
        overflow: "hidden",
        textOverflow: "ellipsis"
      }}
      title={d.symbol} // ✅ shows full name on hover
    >
      {d.symbol}
    </div>
  )}
</td>
        <td style={{ width: 140 }}>
  {d.sector}
</td>

  {/* 📊 52W RANGE */}
<td style={{ width: 160, textAlign: "center", verticalAlign: "middle" }}>
  {(() => {
    const symbol = (d.symbol || "").toLowerCase();

    const isMF =
      symbol.includes("fund") ||
      symbol.includes("plan");

    if (isMF) {
      return (
        <span style={{ fontSize: 11, color: theme.subText }}>
          N/A
        </span>
      );
    }

    return (
      <div style={{ width: 130, margin: "0 auto" }}>

        {/* LOW / HIGH */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: 9,
            color: theme.subText,
            marginBottom: 4
          }}
        >
          <span>₹{d.low52 ?? "-"}</span>
          <span>₹{d.high52 ?? "-"}</span>
        </div>

        {/* BAR */}
        <div
          style={{
            position: "relative",
            height: 5,
            borderRadius: 999,
            background: dark ? "#1f2937" : "#e5e7eb"
          }}
        >
          {/* PROGRESS */}
          <div
            style={{
              position: "absolute",
              left: 0,
              width: `${
                d.high52 && d.low52
                  ? ((d.currentPrice - d.low52) / (d.high52 - d.low52)) * 100
                  : 0
              }%`,
              height: "100%",
              background: "#3b82f6",
              opacity: 0.3,
              borderRadius: 999
            }}
          />

          {/* DOT */}
          <div
            style={{
              position: "absolute",
              left: `${
                d.high52 && d.low52
                  ? ((d.currentPrice - d.low52) / (d.high52 - d.low52)) * 100
                  : 0
              }%`,
              top: "50%",
              transform: "translate(-50%, -50%)",
              width: 10,
              height: 10,
              borderRadius: "50%",
              background: "#3b82f6",
              border: dark ? "2px solid #020617" : "2px solid #fff",
              boxShadow: "0 0 0 2px rgba(59,130,246,0.2)"
            }}
          />
        </div>

        {/* CURRENT PRICE */}
        <div
          style={{
            fontSize: 10,
            marginTop: 4,
            fontWeight: 500,
            color: theme.text
          }}
        >
          ₹{d.currentPrice ?? "-"}
        </div>

      </div>
    );
  })()}
</td>

<td style={{ width: 80, textAlign: "right" }}>
  {isEditing ? (
    <input
      type="number"
      value={editForm.quantity}
      onChange={(e) =>
        setEditForm({ ...editForm, quantity: e.target.value })
      }
      style={{
        width: "100%",   // ✅ important
        padding: "4px 6px",
        borderRadius: 4,
        border: `1px solid ${theme.border}`,
        background: theme.card,
        color: theme.text,
        fontSize: 12,
        textAlign: "right"
      }}
    />
  ) : (
    d.quantity
  )}
</td>

<td style={{ width: 100, textAlign: "right" }}>
  {isEditing ? (
    <input
      type="number"
      value={editForm.avgPrice}
      onChange={(e) =>
        setEditForm({ ...editForm, avgPrice: e.target.value })
      }
      style={{
        width: "100%",   // ✅ important
        padding: "4px 6px",
        borderRadius: 4,
        border: `1px solid ${theme.border}`,
        background: theme.card,
        color: theme.text,
        fontSize: 12,
        textAlign: "right"
      }}
    />
  ) : (
    d.avgPrice
  )}
</td>

<td style={{ width: 100, textAlign: "right" }}>
  {d.currentPrice ? d.currentPrice.toFixed(2) : "-"}
</td>

<td style={{ width: 120, textAlign: "right", padding: "10px 8px" }}>
  {d.currentValue?.toFixed(0)}
</td>

<td
  style={{ width: 120, textAlign: "right" }}
  className={d.pnl > 0 ? "green" : d.pnl < 0 ? "red" : ""}
>
  <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
    ₹{d.pnl?.toFixed(0)}
    {d.pnl !== 0 && (
      <span style={{ fontSize: 12 }}>
        {d.pnl > 0 ? "▲" : "▼"}
      </span>
    )}
  </span>
</td>

<td
  style={{ width: 90, textAlign: "right" }}
  className={d.pnlPct > 0 ? "green" : d.pnlPct < 0 ? "red" : ""}
>
  <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
    {isNaN(d.pnlPct)
      ? "0.00%"
      : Number(d.pnlPct).toFixed(2) + "%"}
    {d.pnlPct !== 0 && (
      <span style={{ fontSize: 12 }}>
        {d.pnlPct > 0 ? "▲" : "▼"}
      </span>
    )}
  </span>
</td>

        <td>
          <div style={{ display: "flex", gap: 6 }}>
            {isEditing ? (
              <>
                <button
                  onClick={async () => {
                    const newSymbol = editForm.symbol.trim().toUpperCase();

     // HERE (duplicate check)
    if (
      data.some(
        (i) =>
          i.symbol === newSymbol &&
          i.symbol !== d.symbol
      )
    ) {
      alert("Symbol already exists");
      return;
    }
                    const updated = data.map((item) =>
  item.symbol === d.symbol
    ? {
        ...item,
        symbol: editForm.symbol.trim().toUpperCase(), // ✅ NEW
        quantity: Number(editForm.quantity),
        avgPrice: Number(editForm.avgPrice),
      }
    : item
);

                    setData(updated);
                    saveLocalPortfolio(updated);
                    refreshProfiles();
                    setEditingId(null);
                  }}
                  style={{
                    padding: "4px 6px",
                    borderRadius: 4,
                    background: "#22c55e",
                    border: "none",
                    color: "#fff",
                    cursor: "pointer",
                    fontSize: 12,
                  }}
                  title="Save"
                >
                  ✅
                </button>

                <button
                  onClick={() => setEditingId(null)}
                  style={{
  padding: "4px 8px",
  borderRadius: 6,
  background: dark ? "#1f2937" : "#f3f4f6",
  border: "none",
  color: theme.text,
  cursor: "pointer",
  fontSize: 12,
}}
                  title="Cancel"
                >
                  ❌
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => {
                    setEditingId(d.symbol);
                    setEditForm({
  symbol: d.symbol,
  quantity: d.quantity,
  avgPrice: d.avgPrice,
});
                  }}
                  style={{
  padding: "4px 8px",
  borderRadius: 6,
  background: dark ? "#1f2937" : "#f3f4f6",
  border: "none",
  color: theme.text,
  cursor: "pointer",
  fontSize: 12,
}}
                  title="Edit"
                >
                  ✏️
                </button>

                <button
                  onClick={() => {
                    if (!window.confirm("Delete this holding?")) return;

                    const updated = data.filter(
                      (item) => item.symbol !== d.symbol
                    );

                    setData(updated);
                    saveLocalPortfolio(updated);
                    refreshProfiles();
                  }}
                  style={{
  padding: "4px 8px",
  borderRadius: 6,
  background: dark ? "#1f2937" : "#f3f4f6",
  border: "none",
  color: theme.text,
  cursor: "pointer",
  fontSize: 12,
}}
                  title="Delete"
                >
                  🗑
                </button>
              </>
            )}
          </div>
        </td>
      </tr>
    );
  })}
</tbody> 
            </table>
          </div>  
          </>
        )}

        {/* ANALYTICS */}

{view === "analytics" && (
  <div
    style={{
      display: "flex",
      gap: 20,
      flexWrap: "wrap"
    }}
  >

    {/* Sector */}
    <div className="card" style={{ flex: 1, minWidth: 420 }}>
      <h3 style={{ color: theme.text }}>Sector</h3>

      <PieChart width={340} height={300}>

        <Pie
          data={sectorData}
          dataKey="value"
          innerRadius={80}
          outerRadius={120}
        >
          {sectorData.map((_, i) => (
            <Cell key={i} fill={COLORS[i % COLORS.length]} />
          ))}
        </Pie>

        {/* ✅ CENTER TEXT (CORRECT PLACE) */}
        <text
          x="50%"
          y="45%"
          textAnchor="middle"
          style={{ fill: dark ? "#9ca3af" : "#6b7280", fontSize: 11 }}
        >
          Total
        </text>

        <text
          x="50%"
          y="55%"
          textAnchor="middle"
          style={{ fill: dark ? "#fff" : "#111827", fontSize: 16, fontWeight: 600 }}
        >
          ₹{format2(totalValue)}
        </text>

        {/* Tooltip */}
        <Tooltip
  contentStyle={{
    background: theme.card,
    border: `1px solid ${theme.border}`,
    color: theme.text
  }}
  formatter={(value, name, props) => [
    `₹${format2(value)}`,
    props.payload.name
  ]}
/>
      </PieChart>

      {renderCustomLegend(sectorData)}
    </div>

    {/* Asset */}
    <div className="card" style={{ flex: 1, minWidth: 420 }}>
      <h3
  style={{
    color: theme.text,
    display: "flex",
    alignItems: "center",
    gap: 8
  }}
>
  <PieChartIcon size={18} strokeWidth={1.5} />
  Asset Allocation
</h3>

      <PieChart width={340} height={300}>

        <Pie
          data={assetData}
          dataKey="value"
          innerRadius={80}
          outerRadius={120}
        >
          {assetData.map((_, i) => (
            <Cell key={i} fill={COLORS[i % COLORS.length]} />
          ))}
        </Pie>

        {/* ✅ CENTER TEXT (CORRECT TOTAL) */}
        <text
          x="50%"
          y="45%"
          textAnchor="middle"
          style={{ fill: dark ? "#9ca3af" : "#6b7280", fontSize: 11 }}
        >
          Total
        </text>

        <text
          x="50%"
          y="55%"
          textAnchor="middle"
          style={{ fill: dark ? "#fff" : "#111827", fontSize: 16, fontWeight: 600 }}
        >
          ₹{format2(
            assetData.reduce((s, d) => s + d.value, 0)
          )}
        </text>

        {/* Tooltip */}
        <Tooltip
  contentStyle={{
    background: theme.card,
    border: `1px solid ${theme.border}`,
    color: theme.text
  }}
  formatter={(value, name, props) => [
    `₹${format2(value)}`,
    props.payload.name
  ]}
/>
      </PieChart>

      <div style={{ marginTop: 10 }}>
        {renderCustomLegend(assetData)}
      </div>
    </div>

  </div>
)}


       {/* INSIGHTS */}
{view === "insights" && (
  <div className="card" style={{ marginBottom: 20, padding: 20 }}>

    <h3
  style={{
    color: theme.text,
    display: "flex",
    alignItems: "center",
    gap: 8
  }}
>
  <Flame size={18} strokeWidth={1.5} />
  FIRE Planner
</h3>

    {/* 🔹 LEFT + RIGHT WRAPPER */}
    <div style={{
      display: "flex",
      gap: 20,
      flexWrap: "wrap"
    }}>

      {/* 🔹 LEFT → INPUTS */}
      <div style={{
        flex: 1,
        minWidth: 320,
        maxWidth: 420,
        background: theme.card,
        padding: 16,
        borderRadius: 12,
        border: `1px solid ${theme.border}`
      }}>

        {[
          { label: "Return (%)", value: rate, set: setRate, min: 0, max: 20 },
          { label: "Years", value: years, set: setYears, min: 0, max: 40 },
          { label: "Inflation (%)", value: inflation, set: setInflation, min: 0, max: 10 },
          { label: "FIRE Target", value: fireTarget, set: setFireTarget, min: 0, max: 200000000 },
          { label: "Monthly SIP", value: sip, set: setSip, min: 0, max: 200000 },
        ].map((item) => (
          <div key={item.label} style={{ marginBottom: 18 }}>

            <div style={{
              display: "flex",
              justifyContent: "space-between",
              marginBottom: 6
            }}>
              <span style={{ fontSize: 12, color: theme.subText }}>
                {item.label}
              </span>

              <input
                type="number"
                value={item.value}
                onChange={(e) => item.set(Number(e.target.value) || 0)}
                style={{
                  width: 100,
                  background: theme.card,
                  border: `1px solid ${theme.border}`,
                  borderRadius: 6,
                  padding: "4px 6px",
                  color: theme.text,
                  fontSize: 12,
                  textAlign: "right"
                }}
              />
            </div>

            <div style={{ maxWidth: 300 }}>
              <input
                type="range"
                min={item.min}
                max={item.max}
                value={item.value}
                onChange={(e) => item.set(+e.target.value)}
                style={{
                  width: "100%",
                  height: 3,
                  accentColor: "#3b82f6"
                }}
              />
            </div>

          </div>
        ))}

        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button
            onClick={resetCalculator}
            style={{
              padding: "5px 10px",
              fontSize: 11,
              borderRadius: 6,
              background: theme.card,
              border: `1px solid ${theme.border}`,
              color: theme.subText
            }}
          >
            Reset
          </button>
        </div>

      </div>

      {/* 🔹 RIGHT → OUTPUT */}
      <div style={{
        flex: 1,
        minWidth: 320,
        display: "flex",
        flexDirection: "column",
        gap: 14
      }}>

        <div style={{
          background: theme.card,
          padding: 18,
          borderRadius: 12,
          border: `1px solid ${theme.border}`
        }}>
          <h3
  style={{
    color: theme.text,
    display: "flex",
    alignItems: "center",
    gap: 8
  }}
>
  <Target size={18} strokeWidth={1.5} />
  FIRE Target
</h3>
          <h2>{cleanData.length ? `₹${futureValue.toLocaleString()}` : "-"}</h2>
        </div>

        <div style={{
          background: theme.card,
          padding: 18,
          borderRadius: 12,
          border: `1px solid ${theme.border}`
        }}>
          <h3
  style={{
    color: theme.text,
    display: "flex",
    alignItems: "center",
    gap: 8
  }}
>
  <TrendingUp size={18} strokeWidth={1.5} />
  Monthly SIP Needed
</h3>
          <h2>{cleanData.length ? `₹${requiredSip.toLocaleString()}` : "-"}</h2>
        </div>

        <div style={{
          background: theme.card,
          padding: 18,
          borderRadius: 12,
          border: `1px solid ${theme.border}`
        }}>
          <h3
  style={{
    color: theme.text,
    display: "flex",
    alignItems: "center",
    gap: 8
  }}
>
  <BarChart3 size={18} strokeWidth={1.5} />
  Progress
</h3>

          <h2>{cleanData.length ? `${progress.toFixed(1)}%` : "-"}</h2>

          <div style={{
            height: 6,
            background: dark ? "#1f2937" : "#e5e7eb",
            borderRadius: 6,
            marginTop: 10,
            overflow: "hidden"
          }}>
            <div style={{
              width: `${progress}%`,
              background: "#3b82f6",
              height: "100%",
              borderRadius: 6,
              transition: "width 0.4s ease"
            }} />
          </div>
        </div>

      </div>

    </div>

  </div>
)}

{/* 💡 INSIGHTS */}
{view === "insights" && (
  <>
    <div className="card" style={{ marginTop: 20 }}>
      <h3
        style={{
          color: theme.text,
          display: "flex",
          alignItems: "center",
          gap: 8
        }}
      >
        <Lightbulb size={18} strokeWidth={1.5} />
        Insights
      </h3>

      {!hasData ? (
        <div
          style={{
            padding: 20,
            textAlign: "center",
            opacity: 0.7
          }}
        >
          📥 Add holdings to generate insights
        </div>
      ) : (
        <>
          {/* 🔹 10% Rule */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
              gap: 16,
              marginBottom: 20
            }}
          >
            <div
              style={{
                padding: 16,
                borderRadius: 12,
                background: theme.card,
                border: `1px solid ${theme.border}`
              }}
            >
              <p style={{ fontSize: 12, color: theme.subText }}>
                10% Rule
              </p>
              <h4
  style={{
    color: overAllocatedStock ? "#ef4444" : "#22c55e",
  }}
>
  {overAllocatedStock
    ? `⚠️ ${overAllocatedStock.name} (${overAllocatedStock.pct}%) exceeds 10%`
    : "✅ Within Limit"}
</h4>
            </div>
          </div>

          {/* 🔹 Asset Allocation */}
          <div
            style={{
              padding: 16,
              borderRadius: 12,
              background: theme.card,
              border: `1px solid ${theme.border}`
            }}
          >
            <h3
              style={{
                color: theme.text,
                display: "flex",
                alignItems: "center",
                gap: 8
              }}
            >
              <PieChartIcon size={18} strokeWidth={1.5} />
              Asset Allocation
            </h3>

            {[
              { label: "Stocks", value: assetTotals.stocks },
              { label: "Mutual Funds", value: assetTotals.mf },
              { label: "ETF", value: assetTotals.etf },
              { label: "SGB", value: assetTotals.sgb }
            ].map((item) => {
              const pct = totalValue
                ? ((item.value / totalValue) * 100).toFixed(1)
                : 0;

              return (
                <div key={item.label} style={{ marginBottom: 10 }}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      fontSize: 13
                    }}
                  >
                    <span>{item.label}</span>
                    <span>{pct}%</span>
                  </div>

                  <div
                    style={{
                      height: 6,
                      background: dark ? "#1f2937" : "#e5e7eb",
                      borderRadius: 6,
                      overflow: "hidden"
                    }}
                  >
                    <div
                      style={{
                        width: `${pct}%`,
                        background: "#3b82f6",
                        height: "100%"
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  </>
)}

{view === "help" && (
  <div className="card" style={{ padding: 12 }}>
    <h2 style={{ marginBottom: 12 }}>❓ How to Use</h2>

    <div style={{ marginTop: 12, lineHeight: 1.7, fontSize: 13 }}>

      {/* Upload Section */}
      <h3 style={{ color: theme.text, marginTop: 10 }}>
        📥 Upload Portfolio
      </h3>
      <ol style={{ paddingLeft: 18 }}>
        <li>
          Download holdings file from your broker (e.g. Zerodha).
        </li>
        <li>
          For Zerodha: If you're downloading the combined holdings file, keep only the <b>combined sheet</b> (delete stocks/MF sheets).
          Other brokers may differ.
        </li>
        <li>
          Go to <b>Dashboard → Choose File</b>.
        </li>
        <li>
          Review the preview screen.
        </li>
        <li>
          Click <b>Confirm Upload</b>, then <b>Update Prices</b>.
        </li>
      </ol>

      {/* Data Section */}
      <h3 style={{ color: theme.text, marginTop: 18 }}>
        📊 What We Read
      </h3>
      <ul style={{ paddingLeft: 18 }}>
        <li>Symbol / Stock Name</li>
        <li>Quantity</li>
        <li>Average Price</li>
        <li>Sector (optional)</li>
      </ul>

      {/* Notes Section */}
<h3 style={{ color: theme.text, marginTop: 18 }}>
  ⚠️ Important Notes
</h3>

<ul style={{ paddingLeft: 18, lineHeight: 1.7, fontSize: 13 }}>
  <li>
    Uploading a new file will <b>reset current prices to 0</b>.  
    Click <b>Update Prices</b> after upload.
  </li>

  <li>
    Holdings missing in the file will be <b>removed</b>.
  </li>

  <li>
    Existing holdings in the file will be <b>updated</b>.
  </li>

  <li>
    Use the preview screen to review <b>added, updated, and removed</b> holdings before confirming.
  </li>

  <li>
    You can manually add or delete holdings using <b>Add Holding</b>.
  </li>

  <li>
    You can edit quantity and average price directly in the table.
  </li>

  <li>
    Your data is stored locally in your browser — <b>nothing is shared externally</b>.
  </li>
</ul>

    </div>
  </div>
)}

{view === "about" && (
  <div className="card" style={{ padding: 12 }}>
    <h2 style={{ marginBottom: 12 }}>ℹ️ About This Project</h2>

    <p style={{ marginTop: 12, lineHeight: 1.7, fontSize: 13 }}>
      This tool is built to simplify portfolio tracking for individual investors.
      Most existing tools are either too complex or require logins and sharing
      of sensitive financial data.
    </p>

    <p style={{ marginTop: 12, lineHeight: 1.7, fontSize: 13 }}>
      This project is designed as a clean, private, and user-friendly alternative —
      helping you manage your investments without unnecessary friction.
    </p>

    <div style={{ marginTop: 16 }}>
      <p style={{ fontSize: 13 }}>
        <strong>Simple workflow:</strong>
      </p>
      <p style={{ fontSize: 13, marginTop: 4 }}>
        📥 Upload holdings → ⚡ Get instant insights → 📊 Track performance
      </p>
    </div>

    <h3 style={{ color: theme.text, marginTop: 18 }}>
      💡 Why I Built This
    </h3>
    <p style={{ fontSize: 13, lineHeight: 1.7 }}>
      I wanted a fast, no-login tool to track my investments without relying
      on spreadsheets or complicated platforms. This app focuses on speed,
      simplicity, and privacy.
    </p>

    <h3 style={{ color: theme.text, marginTop: 18 }}>
      🔒 Privacy First
    </h3>
    <p style={{ fontSize: 13, lineHeight: 1.7 }}>
      All your data stays in your browser (local storage).
      Nothing is stored on servers or shared externally.
    </p>

    <h3 style={{ color: theme.text, marginTop: 18 }}>
      📬 Contact
    </h3>
    <p style={{ fontSize: 13, lineHeight: 1.7 }}>
      Have feedback, suggestions, or ideas?
      <br />
      📧 <strong>rakeshkmr556@gmail.com</strong>
    </p>
  </div>
)}

{view === "support" && (
  <div className="card" style={{ padding: 12 }}>
    <h2 style={{ marginBottom: 12 }}>❤️ Support This Project</h2>

    <p style={{ marginTop: 8, fontSize: 13, lineHeight: 1.7 }}>
      This tool is completely free to use and built to help individual investors
      track their portfolios with simplicity and privacy.
    </p>

    <p style={{ marginTop: 10, fontSize: 13 }}>
      If you find it useful, consider supporting ❤️
    </p>

    <div
      style={{
        marginTop: 20,
        padding: 16,
        borderRadius: 10,
        background: theme.card,
        border: `1px solid ${theme.border}`,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        textAlign: "center"
      }}
    >
      <p style={{ marginBottom: 10, fontWeight: 500 }}>
        💸 Donate via UPI
      </p>

      <img
        src="/QR.jpeg"
        alt="UPI QR"
        style={{
          width: 160,
          borderRadius: 8,
          border: `1px solid ${theme.border}`
        }}
      />

      <p style={{ fontSize: 12, color: theme.subText, marginTop: 10 }}>
        Scan the QR code using any UPI app
      </p>

      <p style={{ fontSize: 12, color: theme.subText, marginTop: 4 }}>
        Your support helps maintain and improve this tool 🙏
      </p>
    </div>
  </div>
)}
      </main>
    </div>
  );
}


export default App;