// History.jsx — Portfolio P&L Timeline + Snapshot Engine
// Drop into src/components/History.jsx
// Usage: import History from "./components/History"; then <History data={cleanData} theme={theme} dark={dark} />

import React, { useEffect, useState, useRef } from "react";

// ─── Constants ───────────────────────────────────────────────────
const getHistoryKey = (profile) =>
  `portfolio_history_${profile || "default"}`;
const MAX_SNAPSHOTS = 180; // 6 months daily

// ─── Snapshot helpers ─────────────────────────────────────────────
export const loadHistory = (profile) => {
  try {
    const raw = localStorage.getItem(
      getHistoryKey(profile)
    );

    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
};

export const saveSnapshot = (
  profile,
  totalValue,
  totalInvestment,
  holdings
) => {
  if (!totalValue && !totalInvestment) return;

  const history = loadHistory(profile);
  const todayKey = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  // Only one snapshot per day — update if same day
  const existing = history.findIndex((h) => h.date === todayKey);
  const snap = {
    date: todayKey,
    value: Math.round(totalValue),
    invested: Math.round(totalInvestment),
    pnl: Math.round(totalValue - totalInvestment),
    pnlPct:
      totalInvestment > 0
        ? parseFloat(
            (((totalValue - totalInvestment) / totalInvestment) * 100).toFixed(2)
          )
        : 0,
    count: holdings?.length ?? 0,
  };

  if (existing >= 0) {
    history[existing] = snap;
  } else {
    history.push(snap);
  }

  // Keep only last N snapshots
  const trimmed = history
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-MAX_SNAPSHOTS);

  try {
    localStorage.setItem(
  getHistoryKey(profile), JSON.stringify(trimmed));
  } catch {
    // localStorage full — trim more aggressively
    localStorage.setItem(
      HISTORY_KEY,
      JSON.stringify(trimmed.slice(-30))
    );
  }
};

// ─── Formatting helpers ───────────────────────────────────────────
const fmtCurrency = (v) => {
  const abs = Math.abs(v);
  if (abs >= 10000000) return `₹${(v / 10000000).toFixed(2)}Cr`;
  if (abs >= 100000) return `₹${(v / 100000).toFixed(2)}L`;
  return `₹${Math.round(v).toLocaleString("en-IN")}`;
};

const fmtDate = (dateStr) => {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
};

// ─── Range filter options ─────────────────────────────────────────
const RANGES = [
  { label: "7D", days: 7 },
  { label: "1M", days: 30 },
  { label: "3M", days: 90 },
  { label: "ALL", days: 999 },
];

// ─── Main Component ───────────────────────────────────────────────
export default function History({
  data = [],
  profile,
  theme,
  dark
}) {
  const [history, setHistory] = useState([]);
  const [range, setRange] = useState("1M");
  const [activeTab, setActiveTab] = useState("value"); // "value" | "pnl" | "pnlPct"
  const canvasRef = useRef(null);
  const chartInstanceRef = useRef(null);
  const scriptLoadedRef = useRef(false);

  // Load history on mount
  useEffect(() => {
    setHistory(loadHistory(profile));
  }, [data, profile]);

  // Filtered data by range
  const filteredHistory = (() => {
    const rangeDays = RANGES.find((r) => r.label === range)?.days ?? 30;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - rangeDays);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    return history.filter((h) => h.date >= cutoffStr);
  })();

  // Stats derived from filtered range
  const stats = (() => {
    if (!filteredHistory.length) return null;
    const first = filteredHistory[0];
    const last = filteredHistory[filteredHistory.length - 1];
    const valueChange = last.value - first.value;
    const valuePct =
      first.value > 0 ? (valueChange / first.value) * 100 : 0;
    const maxPnL = Math.max(...filteredHistory.map((h) => h.pnl));
    const minPnL = Math.min(...filteredHistory.map((h) => h.pnl));
    return { last, valueChange, valuePct, maxPnL, minPnL };
  })();

  // Draw chart via Chart.js (loaded from CDN)
  useEffect(() => {
    if (!filteredHistory.length || !canvasRef.current) return;

    const drawChart = () => {
      if (!window.Chart) return;

      if (chartInstanceRef.current) {
        chartInstanceRef.current.destroy();
        chartInstanceRef.current = null;
      }

      const labels = filteredHistory.map((h) => fmtDate(h.date));
      const isGain = activeTab === "pnlPct"
        ? filteredHistory[filteredHistory.length - 1]?.pnlPct >= 0
        : filteredHistory[filteredHistory.length - 1]?.[activeTab] >= 0;

      const lineColor = isGain ? "#22c55e" : "#ef4444";
      const fillColor = isGain
        ? "rgba(34,197,94,0.10)"
        : "rgba(239,68,68,0.10)";

      const dataset = filteredHistory.map((h) => {
        if (activeTab === "value") return h.value;
        if (activeTab === "pnl") return h.pnl;
        return h.pnlPct;
      });

      const ctx = canvasRef.current.getContext("2d");

      chartInstanceRef.current = new window.Chart(ctx, {
        type: "line",
        data: {
          labels,
          datasets: [
            {
              label:
                activeTab === "value"
                  ? "Portfolio Value"
                  : activeTab === "pnl"
                  ? "P&L"
                  : "P&L %",
              data: dataset,
              borderColor: lineColor,
              borderWidth: 2,
              backgroundColor: fillColor,
              fill: true,
              tension: 0.35,
              pointRadius: filteredHistory.length <= 14 ? 4 : 2,
              pointBackgroundColor: lineColor,
              pointBorderColor: dark ? "#020617" : "#fff",
              pointBorderWidth: 2,
              pointHoverRadius: 6,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: "index", intersect: false },
          plugins: {
            legend: { display: false },
            tooltip: {
              backgroundColor: dark ? "#1e293b" : "#fff",
              borderColor: dark ? "#334155" : "#e5e7eb",
              borderWidth: 1,
              titleColor: dark ? "#e5e7eb" : "#111827",
              bodyColor: dark ? "#9ca3af" : "#6b7280",
              padding: 10,
              callbacks: {
                label: (ctx) => {
                  const v = ctx.parsed.y;
                  if (activeTab === "pnlPct") return ` ${v.toFixed(2)}%`;
                  return ` ${fmtCurrency(v)}`;
                },
              },
            },
          },
          scales: {
            x: {
              grid: { display: false },
              ticks: {
                color: dark ? "#6b7280" : "#9ca3af",
                font: { size: 11 },
                maxTicksLimit: 8,
                maxRotation: 0,
              },
              border: { display: false },
            },
            y: {
              position: "right",
              grid: {
                color: dark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.05)",
              },
              ticks: {
                color: dark ? "#6b7280" : "#9ca3af",
                font: { size: 11 },
                maxTicksLimit: 5,
                callback: (v) =>
                  activeTab === "pnlPct"
                    ? `${v.toFixed(1)}%`
                    : fmtCurrency(v),
              },
              border: { display: false },
            },
          },
        },
      });
    };

    if (window.Chart) {
      drawChart();
    } else if (!scriptLoadedRef.current) {
      scriptLoadedRef.current = true;
      const script = document.createElement("script");
      script.src =
        "https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js";
      script.onload = drawChart;
      document.head.appendChild(script);
    }

    return () => {
      if (chartInstanceRef.current) {
        chartInstanceRef.current.destroy();
        chartInstanceRef.current = null;
      }
    };
  }, [filteredHistory, activeTab, dark]);

  // ─── Empty state ────────────────────────────────────────────────
  if (!history.length) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "60px 20px",
          textAlign: "center",
          gap: 12,
        }}
      >
        <div style={{ fontSize: 40 }}>📈</div>
        <h3 style={{ color: theme.text, margin: 0, fontSize: 16 }}>
          No history yet
        </h3>
        <p style={{ color: theme.subText, fontSize: 13, maxWidth: 280, margin: 0 }}>
          Snapshots are saved automatically each time you click{" "}
          <strong>Update Price</strong>. Come back after your first update!
        </p>
      </div>
    );
  }

  // ─── Render ─────────────────────────────────────────────────────
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

      {/* ── Stat cards ── */}
      {stats && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
            gap: 10,
          }}
        >
          {/* Current value */}
          <StatCard
            label="Current Value"
            value={fmtCurrency(stats.last.value)}
            theme={theme}
          />
          {/* Range change */}
          <StatCard
            label={`${range} Change`}
            value={fmtCurrency(stats.valueChange)}
            sub={`${stats.valuePct >= 0 ? "+" : ""}${stats.valuePct.toFixed(2)}%`}
            positive={stats.valueChange >= 0}
            theme={theme}
          />
          {/* Total P&L */}
          <StatCard
            label="Total P&L"
            value={fmtCurrency(stats.last.pnl)}
            sub={`${stats.last.pnlPct >= 0 ? "+" : ""}${stats.last.pnlPct.toFixed(2)}%`}
            positive={stats.last.pnl >= 0}
            theme={theme}
          />
          {/* Best P&L in range */}
          <StatCard
            label="Best in Range"
            value={fmtCurrency(stats.maxPnL)}
            positive={stats.maxPnL >= 0}
            theme={theme}
          />
        </div>
      )}

      {/* ── Chart card ── */}
      <div
        className="card"
        style={{
          padding: 16,
          border: `1px solid ${theme.border}`,
          borderRadius: 14,
          background: theme.card,
        }}
      >
        {/* Header row */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 10,
            marginBottom: 16,
          }}
        >
          {/* Tab switcher */}
          <div
            style={{
              display: "flex",
              gap: 6,
              background: dark ? "#0f172a" : "#f1f5f9",
              borderRadius: 8,
              padding: 3,
            }}
          >
            {[
              { key: "value", label: "Value" },
              { key: "pnl", label: "P&L ₹" },
              { key: "pnlPct", label: "P&L %" },
            ].map((t) => (
              <button
                key={t.key}
                onClick={() => setActiveTab(t.key)}
                style={{
                  padding: "4px 10px",
                  fontSize: 12,
                  borderRadius: 6,
                  border: "none",
                  cursor: "pointer",
                  background:
                    activeTab === t.key
                      ? dark
                        ? "#1e40af"
                        : "#2563eb"
                      : "transparent",
                  color:
                    activeTab === t.key
                      ? "#fff"
                      : theme.subText,
                  transition: "all 0.15s",
                  fontWeight: activeTab === t.key ? 500 : 400,
                }}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Range filter */}
          <div style={{ display: "flex", gap: 4 }}>
            {RANGES.map((r) => (
              <button
                key={r.label}
                onClick={() => setRange(r.label)}
                style={{
                  padding: "4px 8px",
                  fontSize: 11,
                  borderRadius: 6,
                  border: `1px solid ${
                    range === r.label ? "#2563eb" : theme.border
                  }`,
                  background:
                    range === r.label
                      ? "rgba(37,99,235,0.12)"
                      : "transparent",
                  color:
                    range === r.label ? "#3b82f6" : theme.subText,
                  cursor: "pointer",
                  fontWeight: range === r.label ? 500 : 400,
                }}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>

        {/* Chart */}
        {filteredHistory.length < 2 ? (
          <div
            style={{
              height: 220,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: theme.subText,
              fontSize: 13,
            }}
          >
            Need at least 2 data points for this range.
          </div>
        ) : (
          <div style={{ position: "relative", height: 220, width: "100%" }}>
            <canvas
              ref={canvasRef}
              role="img"
              aria-label="Portfolio value timeline chart"
            >
              Portfolio history chart
            </canvas>
          </div>
        )}
      </div>

      {/* ── Snapshot log table (mobile-friendly) ── */}
      <div
        className="card"
        style={{
          padding: 16,
          border: `1px solid ${theme.border}`,
          borderRadius: 14,
          background: theme.card,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 12,
          }}
        >
          <h3
            style={{
              fontSize: 13,
              color: theme.subText,
              margin: 0,
              fontWeight: 500,
            }}
          >
            Snapshot Log
          </h3>
          <span style={{ fontSize: 11, color: theme.subText }}>
            {filteredHistory.length} entries
          </span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {[...filteredHistory].reverse().map((snap, i) => (
            <SnapshotRow key={snap.date} snap={snap} theme={theme} dark={dark} />
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────

function StatCard({ label, value, sub, positive, theme }) {
  return (
    <div
      className="card"
      style={{
        padding: 12,
        borderRadius: 12,
        border: `1px solid ${theme.border}`,
        background: theme.card,
      }}
    >
      <div style={{ fontSize: 11, color: theme.subText, marginBottom: 4 }}>
        {label}
      </div>
      <div
        style={{
          fontSize: 16,
          fontWeight: 600,
          color:
            positive === undefined
              ? theme.text
              : positive
              ? "#22c55e"
              : "#ef4444",
        }}
      >
        {value}
      </div>
      {sub && (
        <div
          style={{
            fontSize: 11,
            marginTop: 2,
            color: positive ? "#22c55e" : "#ef4444",
          }}
        >
          {sub}
        </div>
      )}
    </div>
  );
}

function SnapshotRow({ snap, theme, dark }) {
  const isGain = snap.pnl >= 0;
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "8px 10px",
        borderRadius: 8,
        background: dark ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.02)",
        border: `1px solid ${theme.border}`,
        flexWrap: "wrap",
        gap: 4,
      }}
    >
      {/* Date + count */}
      <div>
        <div style={{ fontSize: 13, color: theme.text, fontWeight: 500 }}>
          {fmtDate(snap.date)}
        </div>
        <div style={{ fontSize: 11, color: theme.subText }}>
          {snap.count} holdings
        </div>
      </div>

      {/* Value + P&L */}
      <div style={{ textAlign: "right" }}>
        <div style={{ fontSize: 13, color: theme.text, fontWeight: 500 }}>
          {fmtCurrency(snap.value)}
        </div>
        <div
          style={{
            fontSize: 11,
            color: isGain ? "#22c55e" : "#ef4444",
          }}
        >
          {isGain ? "▲" : "▼"} {fmtCurrency(Math.abs(snap.pnl))} (
          {Math.abs(snap.pnlPct).toFixed(2)}%)
        </div>
      </div>
    </div>
  );
}
