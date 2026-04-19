import React, { useEffect, useState } from "react";

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
  return localStorage.getItem(PROFILE_KEY);
};

const setActiveProfile = (name) => {
  localStorage.setItem(PROFILE_KEY, name);
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
  const [profile, setProfile] = useState(getActiveProfile());
  const [data, setData] = useState([]);
  const [dark, setDark] = useState(() => localStorage.getItem("darkMode") === "true");
  const [updatingPrices, setUpdatingPrices] = useState(false);
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

  const switchProfile = (name) => {
  setActiveProfile(name);
  setProfile(name);
  setData(loadLocalPortfolio());
};

const refreshProfiles = () => {
  const list = Object.keys(localStorage)
    .filter((k) => k.startsWith("portfolio_"))
    .map((k) => k.replace("portfolio_", ""));

  setProfiles(list);
};

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

    data.forEach(d => map.set(d.symbol, d));
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
  data.forEach((d) => {
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
  const [rate, setRate] = useState(12);
  const [years, setYears] = useState(10);
  const [inflation, setInflation] = useState(6);
  const [fireTarget, setFireTarget] = useState(50000000);
  const [sip, setSip] = useState(20000);

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
  fetchData();
}, []);

  const totalValue = data.reduce(
  (s, d) => s + (Number(d.currentValue) || 0),
  0
);
  const totalInvestment = data.reduce(
  (s, d) => s + (Number(d.quantity) * Number(d.avgPrice)),
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

data.forEach((d) => {
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
  }, [rate, years, inflation, fireTarget, sip, totalValue]);

  const progress =
  futureValue > 0
    ? Math.min((totalValue / futureValue) * 100, 100)
    : 0;

  const handleUpdatePrices = async () => {
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

const updated = data.map((item) => {
  const key = item.symbol.replace(/-E$|-GB$/i, "");
  const match = priceMap.get(key);

      if (!match) return item;

      const currentPrice = Number(match.currentPrice || 0);
      const investment = Number(item.quantity) * Number(item.avgPrice);
      const currentValue = Number(item.quantity) * currentPrice;
      const pnl = currentValue - investment;
      const pnlPct = investment > 0 ? (pnl / investment) * 100 : 0;

      return {
        ...item,
        currentPrice,
        currentValue,
        pnl,
        pnlPct,
      };
    });

    setData(updated);
    saveLocalPortfolio(updated);
    refreshProfiles();

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

const handleFileUpload = (e) => {
  console.log("📂 File upload triggered");

  const file = e.target.files?.[0];
  if (!file) {
    alert("❌ No file selected");
    return;
  }

  Papa.parse(file, {
    header: false, // 🔥 IMPORTANT CHANGE
    skipEmptyLines: true,

    complete: async function (results) {
      try {
        const rows = results.data;

        console.log("Raw rows:", rows.slice(0, 10));

        // 🔍 FIND HEADER ROW
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

        // 🔧 NORMALIZE
        const normalize = (str) =>
          (str || "").toLowerCase().replace(/[^a-z]/g, "");

        // 🔄 MAP ROWS
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
    },
  });
};

  const chartData = data.map((d) => ({
    name: d.symbol,
    value: d.currentValue || 0,
  }));

  const sectorMap = {};
  data.forEach((d) => {
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

  data.forEach((h) => {
    const investment = h.quantity * h.avgPrice;
    const symbol = h.symbol.toLowerCase();

    if (symbol.includes("sgb")) allocation.sgb += investment;
    else if (symbol.endsWith("-e")) allocation.etf += investment;
    else if (symbol.includes("fund") || symbol.includes("plan"))
      allocation.mf += investment;
    else allocation.stocks += investment;
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
            background: theme.card,
            color: theme.text,
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
            background: "#3b82f6",
            border: "none",
            color: "#fff",
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

        <p onClick={() => setView("dashboard")}>🏠 Dashboard</p>
        <p onClick={() => setView("analytics")}>📊 Analytics</p>
        <p onClick={() => setView("insights")}>💡 Insights</p>
        <p onClick={() => setView("help")}>❓ Help</p>
        <p onClick={() => setView("about")}>ℹ️ About</p>
        <p onClick={() => setView("support")}>❤️ Support</p>

        <button onClick={() => setDark(!dark)}>
          {dark ? "☀️ Light" : "🌙 Dark"}
        </button>
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

<div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
  
  <div style={{
    padding: "6px 10px",
    borderRadius: 6,
    background: "#1f2937",
    fontSize: 12
  }}>
    👤 {profile}
  </div>

  <select
    onChange={(e) => {
      if (e.target.value === "__new__") {
        const name = prompt("Enter new profile name");
        if (!name) return;

        setActiveProfile(name);
        setProfile(name);
        refreshProfiles();
        setData([]);
      } else {
        switchProfile(e.target.value);
      }
    }}
  >
    <option value="">Switch Profile</option>

    {profiles.map((p) => (
      <option key={p} value={p}>
        {p}
      </option>
    ))}

    <option value="__new__">➕ New Profile</option>
  </select>

  {/* ✅ LOGOUT BUTTON */}
  <button
    onClick={() => {
      localStorage.removeItem("activeProfile");
      setProfile(null);
      setData([]);
    }}
  >
    Logout
  </button>

</div>

        {/* DASHBOARD */}
        {view === "dashboard" && (
  <>
    <h1 style={{ marginBottom: 16 }}>Portfolio Overview</h1>

     {/* ✅ EMPTY STATE MESSAGE */}
    {data.length === 0 && (
      <p style={{ color: theme.subText, marginBottom: 12 }}>
        No data found. Upload your portfolio to begin.
      </p>
    )}

    {/* 🔷 TOP BAR */}
    <div className="card" style={{ marginBottom: 20, padding: 16 }}>

      <div style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        flexWrap: "wrap",
        gap: 12,
        width: "100%"
      }}>

      

        {/* CSV UPLOAD */}
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          background: theme.card,
          padding: "8px 12px",
          borderRadius: 8,
          border: `1px solid ${theme.border}`
        }}>
          <span style={{ fontSize: 12, color: theme.subText }}>
            Import CSV
          </span>

          <input type="file" onChange={handleFileUpload} />
        </div>

        {/* UPDATE BUTTON */}
        <button
  onClick={handleUpdatePrices}
  disabled={updatingPrices}
  style={{
    padding: "8px 14px",
    borderRadius: 8,
    background: updatingPrices ? "#1e3a8a" : "#3b82f6",
    border: "none",
    color: theme.text,
    fontSize: 13,
    cursor: updatingPrices ? "not-allowed" : "pointer",
    opacity: updatingPrices ? 0.7 : 1,
    transition: "all 0.2s ease"
  }}
>
  {updatingPrices ? "⏳ Updating..." : "🔄 Update Prices"}
</button>

      </div>
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
        <table className="table" style={{ minWidth: 700 }}>
            <thead>
              <tr>
                <th>Status</th>
                <th>Symbol</th>
                <th>Qty</th>
                <th>Avg Price</th>
                <th>Sector</th>
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
              border: "1px solid #374151",
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
              background: theme.card,
              border: "none",
              color: theme.text
            }}
          >
            Confirm Upload
          </button>
        </div>
      </div>
    )}

    {/* 🔷 KPI CARDS */}
    <div style={{
      display: "grid",
      gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
      gap: 14,
      marginBottom: 20
    }}>
      <div
  className="card"
  style={{
    background: theme.card,
    border: `1px solid ${theme.border}`
  }}
>
        <h3 style={{ color: theme.text }}>Investment</h3>
        <p>₹{totalInvestment.toLocaleString()}</p>
      </div>

      <div
  className="card"
  style={{
    background: theme.card,
    border: `1px solid ${theme.border}`
  }}
>
        <h3 style={{ color: theme.text }}>Value</h3>
        <p>₹{totalValue.toLocaleString()}</p>
      </div>

      <div
  className="card"
  style={{
    background: theme.card,
    border: `1px solid ${theme.border}`
  }}
>
        <h3 style={{ color: theme.text }}>P&L</h3>
        <p className={totalPnL > 0 ? "green" : "red"}>
          ₹{totalPnL.toLocaleString()}
        </p>
      </div>

      <div
  className="card"
  style={{
    background: theme.card,
    border: `1px solid ${theme.border}`
  }}
>
        <h3 style={{ color: theme.text }}>P&L (%)</h3>
        <p className={totalPnLPct > 0 ? "green" : "red"}>
          {totalPnLPct.toFixed(2)}%
        </p>
      </div>
    </div>

            {/* ADD HOLDING */}
            <div className="card" style={{ marginTop: 20 }}>
              <h3 style={{ color: theme.text }}>Add Holding</h3>
              <div
  style={{
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
    gap: 10
  }}
>
                <input placeholder="Symbol" value={form.symbol} onChange={(e) => setForm({ ...form, symbol: e.target.value })} />
                <input placeholder="Quantity" type="number" style={{ width: "80px" }} value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} />
                <input placeholder="Avg Price" type="number" style={{ width: "80px" }} value={form.avgPrice} onChange={(e) => setForm({ ...form, avgPrice: e.target.value })} />
                <input placeholder="Sector" value={form.sector} onChange={(e) => setForm({ ...form, sector: e.target.value })} />

                <button onClick={async () => {
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
                }}>
                  ➕ Add
                </button>
              </div>
            </div>

            {/* TABLE */}
            <div style={{ overflowX: "auto" }}>
            <table
  className="table"
  style={{
    minWidth: 900,
    borderCollapse: "collapse"
  }}
>
              <thead>
                <tr>
                  <th>Stock</th>
                  <th>Sector</th>
                  <th>Qty</th>
                  <th>Avg</th>
                  <th>Price</th>
                  <th>Value</th>
                  <th>P&L</th>
                  <th>%</th>
                  <th>Action</th>
                </tr>
              </thead>

              <tbody>
                {data.map((d) => {
                  const isEditing = editingId === d.symbol;

                  return (
                    <tr key={d.symbol}>
                      <td>{d.symbol}</td>
                      <td>{d.sector}</td>

                      <td>{isEditing ? <input type="number" style={{ width: "80px" }} value={editForm.quantity} onChange={(e) => setEditForm({ ...editForm, quantity: e.target.value })} /> : d.quantity}</td>

                      <td>{isEditing ? <input type="number" style={{ width: "80px" }} value={editForm.avgPrice} onChange={(e) => setEditForm({ ...editForm, avgPrice: e.target.value })} /> : d.avgPrice}</td>

                      <td>{d.currentPrice?.toFixed(2)}</td>
                      <td>{d.currentValue?.toFixed(0)}</td>
                      <td className={d.pnl > 0 ? "green" : "red"}>{d.pnl?.toFixed(0)}</td>
                      <td>{isNaN(d.pnlPct) ? "0.00%" : Number(d.pnlPct).toFixed(2) + "%"}</td>

                      <td>
                        {isEditing ? (
                          <>
                            <button onClick={async () => {
                              const updated = data.map(item =>
  item.symbol === d.symbol
    ? {
        ...item,
        quantity: Number(editForm.quantity),
        avgPrice: Number(editForm.avgPrice),
      }
    : item
);

setData(updated);
saveLocalPortfolio(updated);
refreshProfiles();

setEditingId(null);
                            }}>✅</button>

                            <button onClick={() => setEditingId(null)}>❌</button>
                          </>
                        ) : (
                          <>
                            <button onClick={() => {
                              setEditingId(d.symbol);
                              setEditForm({ quantity: d.quantity, avgPrice: d.avgPrice });
                            }}>✏️</button>

                            <button
  onClick={() => {
    if (!window.confirm("Delete this holding?")) return;

    const updated = data.filter(item => item.symbol !== d.symbol);

    setData(updated);
    saveLocalPortfolio(updated);
    refreshProfiles();

  }}
>
  🗑
</button>
                          </>
                        )}
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
      <h3 style={{ color: theme.text }}>Asset Allocation</h3>

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

    <h3 style={{ color: theme.text }}>🔥 FIRE Planner</h3>

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
              border: "1px solid #374151",
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
          background: dark
  ? "linear-gradient(135deg, #0f172a, #020617)"
  : theme.card,
          padding: 18,
          borderRadius: 12,
          border: `1px solid ${theme.border}`
        }}>
          <p style={{ fontSize: 12, color: "#93c5fd" }}>🎯 FIRE Target</p>
          <h2>₹{futureValue.toLocaleString()}</h2>
        </div>

        <div style={{
          background: dark
  ? "linear-gradient(135deg, #0f172a, #020617)"
  : theme.card,
          padding: 18,
          borderRadius: 12,
          border: `1px solid ${theme.border}`
        }}>
          <p style={{ fontSize: 12, color: "#6ee7b7" }}>💸 Monthly SIP Needed</p>
          <h2>₹{requiredSip.toLocaleString()}</h2>
        </div>

        <div style={{
          background: theme.card,
          padding: 18,
          borderRadius: 12,
          border: `1px solid ${theme.border}`
        }}>
          <p style={{ fontSize: 12, color: theme.subText }}>📈 Progress</p>

          <h2>{progress.toFixed(1)}%</h2>

          <div style={{
            height: 6,
            background: dark ? "#1f2937" : "#e5e7eb",
            borderRadius: 6,
            marginTop: 10,
            overflow: "hidden"
          }}>
            <div style={{
              width: `${progress}%`,
              background: theme.card,
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
      <h3 style={{ color: theme.text }}>💡 Insights</h3>

      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
        gap: 16,
        marginBottom: 20
      }}>
        <div style={{
          padding: 16,
          borderRadius: 12,
          background: theme.card,
          border: `1px solid ${theme.border}`
        }}>
          <p style={{ fontSize: 12, color: theme.subText }}>10% Rule</p>
          <h4 style={{ color: "#22c55e" }}>✅ Within Limit</h4>
        </div>
      </div>

      <div style={{
        padding: 16,
        borderRadius: 12,
        background: theme.card,
        border: `1px solid ${theme.border}`
      }}>
        <h4 style={{ marginBottom: 12 }}>📊 Asset Allocation</h4>

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
              <div style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: 13
              }}>
                <span>{item.label}</span>
                <span>{pct}%</span>
              </div>

              <div style={{
                height: 6,
                background: dark ? "#1f2937" : "#e5e7eb",
                borderRadius: 6,
                overflow: "hidden"
              }}>
                <div style={{
                  width: `${pct}%`,
                  background: theme.card,
                  height: "100%"
                }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  </>
)}

{view === "help" && (
  <div className="card" style={{ padding: 20 }}>
    <h2>❓ How to Use</h2>

    <div style={{ marginTop: 16, lineHeight: 1.6 }}>

      <h3 style={{ color: theme.text }}>📥 Upload Portfolio</h3>
      <ol>
        <li>Download holdings CSV from your broker (Zerodha, etc.)</li>
        <li>Go to Dashboard → Import CSV</li>
        <li>Upload file</li>
        <li>Review preview screen</li>
        <li>Click "Confirm Upload"</li>
        <li>Click "Update prices"</li>
      </ol>

      <h3 style={{ color: theme.text }}>📊 What We Read</h3>
      <ul>
        <li>Symbol / Stock Name</li>
        <li>Quantity</li>
        <li>Average Price</li>
        <li>Sector (optional)</li>
      </ul>

      <h3 style={{ color: theme.text }}>⚠️ Important Notes</h3>
      <ul>
        <li>Uploading updates your portfolio</li>
        <li>Missing stocks will be removed</li>
        <li>No data is shared externally</li>
      </ul>

    </div>
  </div>
)}

{view === "about" && (
  <div className="card" style={{ padding: 20 }}>
    <h2>ℹ️ About This Project</h2>

    <p style={{ marginTop: 12, lineHeight: 1.6 }}>
      This tool was built to simplify portfolio tracking for individual investors.
      Most tools are either too complex or require logins and tracking.
    </p>

    <p style={{ marginTop: 12 }}>
      The goal is simple:
      <br />
      <strong>Upload your holdings → get instant insights.</strong>
    </p>

    <h3 style={{ color: theme.text }}>💡 Why I Built This</h3>
    <p>
      I wanted a clean, fast, no-login tool to track my investments
      without relying on Excel or complicated apps.
    </p>

    <h3 style={{ color: theme.text }}>📬 Contact</h3>
    <p>
      Have feedback or ideas?
      <br />
      📧 rakeshkmr556@gmail.com
    </p>
  </div>
)}

{view === "support" && (
  <div className="card" style={{ padding: 20 }}>
    <h2>❤️ Support This Project</h2>

    <p style={{ marginTop: 12 }}>
      This tool is completely free to use.
    </p>

    <p style={{ marginTop: 10 }}>
      If you find it useful, consider supporting ❤️
    </p>

    <div style={{
      marginTop: 20,
      padding: 16,
      borderRadius: 10,
      background: theme.card,
      border: `1px solid ${theme.border}`
    }}>
      <p style={{ marginBottom: 10 }}>💸 Donate via UPI</p>

      <div style={{ marginTop: 12 }}>
        <img
          src="/QR.jpeg"
          alt="UPI QR"
          style={{ width: 160, borderRadius: 8 }}
        />
      </div>

      <p style={{ fontSize: 12, color: theme.subText, marginTop: 8 }}>
        (Scan to donate)
      </p>
    </div>
  </div>
)}


      </main>
    </div>
  );
}


export default App;