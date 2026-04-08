import React, { useEffect, useState } from "react";
import {
  getPortfolio,
  addHolding,
  deleteHolding,
  updatePrices,
} from "./api";
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
} from "recharts";
import Papa from "papaparse";

const COLORS = ["#0088FE", "#00C49F", "#FFBB28", "#FF8042", "#845EC2"];

function App() {
  const [data, setData] = useState([]);
  const [dark, setDark] = useState(() => localStorage.getItem("darkMode") === "true");

  const [form, setForm] = useState({
    symbol: "",
    quantity: "",
    avgPrice: "",
    sector: "",
  });

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

  const [futureValue, setFutureValue] = useState(0);
  const [requiredSip, setRequiredSip] = useState(0);

  const fetchData = async () => {
    const res = await getPortfolio();
    setData(res.data);
  };

  useEffect(() => {
    fetchData();
  }, []);

  // 🔥 FIRE CALC
  useEffect(() => {
    const r = rate / 100;
    const n = years;
    const inf = inflation / 100;

    if (!fireTarget || !years) return;

    const inflatedFire = fireTarget * Math.pow(1 + inf, n);
    const fvCurrent = totalValue * Math.pow(1 + r, n);

    let fvSip = r > 0
      ? sip * ((Math.pow(1 + r / 12, n * 12) - 1) / (r / 12))
      : sip * 12 * n;

    const totalFuture = fvCurrent + fvSip;
    const remaining = Math.max(inflatedFire - totalFuture, 0);

    let sipNeeded = r > 0
      ? remaining / ((Math.pow(1 + r / 12, n * 12) - 1) / (r / 12))
      : remaining / (n * 12);

    setFutureValue(Math.round(inflatedFire));
    setRequiredSip(Math.round(sipNeeded));
  }, [rate, years, inflation, fireTarget, sip]);

  // ✅ RESET FIX
  const resetCalculator = () => {
    setRate(12);
    setYears(10);
    setInflation(6);
    setFireTarget(50000000);
    setSip(20000);
  };

  // 🔥 STOCK INSIGHTS
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

  const exceededStocks = stockHoldings.map((h) => {
    const investment = h.quantity * h.avgPrice;
    const excess = investment - maxPerStock;

    return {
      ...h,
      investment,
      excess,
      isExceeded: investment > maxPerStock,
    };
  }).filter(h => h.isExceeded);

  // 🔥 ASSET ALLOCATION
  const allocation = { stocks: 0, mf: 0, etf: 0, sgb: 0 };

  data.forEach((h) => {
    const investment = h.quantity * h.avgPrice;
    const symbol = h.symbol.toLowerCase();

    if (symbol.includes("sgb")) allocation.sgb += investment;
    else if (symbol.endsWith("-e")) allocation.etf += investment;
    else if (symbol.includes("fund") || symbol.includes("plan")) allocation.mf += investment;
    else allocation.stocks += investment;
  });

  const assetData = [
    { name: "Stocks", value: allocation.stocks },
    { name: "MF", value: allocation.mf },
    { name: "ETF", value: allocation.etf },
    { name: "SGB", value: allocation.sgb },
  ];

  const handleUpdatePrices = async () => {
    await updatePrices();
    fetchData();
  };

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: async function (results) {
        await Promise.all(results.data.map((row) => addHolding(row)));
        fetchData();
      },
    });
  };

  const totalValue = data.reduce((s, d) => s + (d.currentValue || 0), 0);
  const totalInvestment = data.reduce((s, d) => s + (d.investment || 0), 0);
  const totalPnL = totalValue - totalInvestment;

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

  return (
    <div className={dark ? "app dark" : "app"}>
      <aside className="sidebar">
        <h2>📊 Portfolio AI</h2>
        <p>Dashboard</p>
        <p>Analytics</p>
        <p>Insights</p>
        <button onClick={() => setDark(!dark)}>
          {dark ? "☀️ Light" : "🌙 Dark"}
        </button>
      </aside>

      <main className="main">
        <h1>Portfolio Overview</h1>

        <div className="card">
          <h3>Import CSV</h3>
          <input type="file" onChange={handleFileUpload} />
        </div>

        <div className="card">
          <button onClick={handleUpdatePrices}>🔄 Update Prices</button>
        </div>

        {/* SUMMARY */}
        <div className="flex">
          <div className="card"><h3>Investment</h3><p>₹{totalInvestment.toLocaleString()}</p></div>
          <div className="card"><h3>Value</h3><p>₹{totalValue.toLocaleString()}</p></div>
          <div className="card"><h3>P&L</h3>
            <p className={totalPnL > 0 ? "green" : "red"}>₹{totalPnL.toLocaleString()}</p>
          </div>
        </div>

      {/* 🔥 FIRE (CLEAN UI FINAL) */}
<div className="card" style={{ marginTop: 20 }}>
  <h3 style={{ marginBottom: 15 }}>🔥 FIRE Planner</h3>

  <div
    style={{
      display: "grid",
      gridTemplateColumns: "1.2fr 0.8fr",
      gap: 20,
      alignItems: "start",
    }}
  >

    {/* LEFT SIDE INPUTS */}
    <div style={{ display: "grid", gap: 14 }}>

      {[
        { label: "Return (%)", value: rate, set: setRate, max: 20 },
        { label: "Years", value: years, set: setYears, max: 40 },
        { label: "Inflation (%)", value: inflation, set: setInflation, max: 10 },
        { label: "FIRE Target", value: fireTarget, set: setFireTarget, max: 200000000, step: 500000 },
        { label: "SIP", value: sip, set: setSip, max: 200000, step: 1000 },
      ].map((item, i) => (
        <div key={i}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
            <span style={{ fontSize: 13 }}>{item.label}</span>
            <input
              type="number"
              value={item.value}
              onChange={(e) => item.set(+e.target.value)}
              style={{
                width: 90,
                padding: "2px 6px",
                fontSize: 12,
              }}
            />
          </div>

          <input
            type="range"
            min="0"
            max={item.max}
            step={item.step || 1}
            value={item.value}
            onChange={(e) => item.set(+e.target.value)}
            style={{
              width: "100%",
              height: 4,
              cursor: "pointer",
            }}
          />
        </div>
      ))}

      <button
        onClick={() => {
          setRate(0);
          setYears(0);
          setInflation(0);
          setFireTarget(0);
          setSip(0);
        }}
        style={{ width: "fit-content", marginTop: 5 }}
      >
        Reset
      </button>
    </div>

    {/* RIGHT SIDE RESULTS */}
    <div
      style={{
        padding: 16,
        borderRadius: 12,
        background: "rgba(255,255,255,0.05)",
        display: "flex",
        flexDirection: "column",
        gap: 14,
      }}
    >

      {/* MAIN OUTPUT */}
      <div>
        <div style={{ fontSize: 12, opacity: 0.7 }}>FIRE Target (Inflation)</div>
        <div style={{ fontSize: 20, fontWeight: "bold" }}>
          ₹{futureValue.toLocaleString()}
        </div>
      </div>

      <div>
        <div style={{ fontSize: 12, opacity: 0.7 }}>Required SIP</div>
        <div style={{ fontSize: 16 }}>
          ₹{requiredSip.toLocaleString()}
        </div>
      </div>

      {/* PROGRESS */}
      {(() => {
        const r = rate / 100;
        const n = years;

        const fvCurrent = totalValue * Math.pow(1 + r, n);

        const fvSip =
          r > 0
            ? sip * ((Math.pow(1 + r / 12, n * 12) - 1) / (r / 12))
            : sip * 12 * n;

        const totalFuture = fvCurrent + fvSip;

        const progress =
          futureValue > 0
            ? Math.min((totalFuture / futureValue) * 100, 100)
            : 0;

        return (
          <div>
            <div style={{ fontSize: 12, opacity: 0.7 }}>
              Progress
            </div>

            <div style={{ fontWeight: "bold", marginBottom: 6 }}>
              {progress.toFixed(1)}%
            </div>

            <div
              style={{
                height: 6,
                background: "#222",
                borderRadius: 6,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  width: `${progress}%`,
                  height: "100%",
                  background: "#22c55e",
                }}
              />
            </div>
          </div>
        );
      })()}
    </div>

  </div>
</div> 
        

        {/* CHARTS */}
        <div className="flex">
          <div className="card">
            <h3>Allocation</h3>
            <PieChart width={280} height={280}>
              <Pie data={chartData} dataKey="value">
                {chartData.map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </div>

          <div className="card">
            <h3>Sector</h3>
            <PieChart width={280} height={280}>
              <Pie data={sectorData} dataKey="value">
                {sectorData.map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </div>

          {/* NEW CHART */}
          <div className="card">
            <h3>Asset Allocation</h3>
            <PieChart width={280} height={280}>
              <Pie data={assetData} dataKey="value">
                {assetData.map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip formatter={(v) => `₹${Math.round(v).toLocaleString()}`} />
            </PieChart>
          </div>
        </div>

        {/* INSIGHTS */}
        <div className="card">
          <h3>Insights</h3>
          <p>📦 Diversification: {stockHoldings.length} stocks</p>
          <p>⚖️ Max per stock: ₹{Math.round(maxPerStock).toLocaleString()}</p>

          {exceededStocks.length > 0 ? (
            exceededStocks.map((s) => (
              <p key={s.symbol} style={{ color: "#ff6b6b" }}>
                ⚠️ {s.symbol} exceeds by ₹{Math.round(s.excess).toLocaleString()}
              </p>
            ))
          ) : (
            <p style={{ color: "#22c55e" }}>
              ✅ All stocks within limits
            </p>
          )}
        </div>

        {/* ➕ Add Holding */}
<div className="card" style={{ marginTop: 20 }}>
  <h3>Add Holding</h3>

  <div className="flex">
    <input
      placeholder="Symbol"
      value={form.symbol}
      onChange={(e) => setForm({ ...form, symbol: e.target.value })}
    />

    <input
      placeholder="Quantity"
      type="number"
      value={form.quantity}
      onChange={(e) => setForm({ ...form, quantity: e.target.value })}
    />

    <input
      placeholder="Avg Price"
      type="number"
      value={form.avgPrice}
      onChange={(e) => setForm({ ...form, avgPrice: e.target.value })}
    />

    <input
      placeholder="Sector"
      value={form.sector}
      onChange={(e) => setForm({ ...form, sector: e.target.value })}
    />

    <button
      onClick={async () => {
        if (!form.symbol || !form.quantity || !form.avgPrice) return;

        await addHolding({
          symbol: form.symbol.trim(),
          quantity: Number(form.quantity),
          avgPrice: Number(form.avgPrice),
          sector: form.sector || "Others",
        });

        setForm({ symbol: "", quantity: "", avgPrice: "", sector: "" });
        fetchData();
      }}
    >
      ➕ Add
    </button>
  </div>
</div>

        {/* TABLE */}
        <table className="table">
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
    const isEditing = editingId === d.id;

    return (
      <tr key={d.id}>
        <td>{d.symbol}</td>
        <td>{d.sector}</td>

        <td>
          {isEditing ? (
            <input
              type="number"
              value={editForm.quantity}
              onChange={(e) =>
                setEditForm({ ...editForm, quantity: e.target.value })
              }
            />
          ) : (
            d.quantity
          )}
        </td>

        <td>
          {isEditing ? (
            <input
              type="number"
              value={editForm.avgPrice}
              onChange={(e) =>
                setEditForm({ ...editForm, avgPrice: e.target.value })
              }
            />
          ) : (
            d.avgPrice
          )}
        </td>

        <td>{d.currentPrice?.toFixed(2)}</td>
        <td>{d.currentValue?.toFixed(0)}</td>
        <td className={d.pnl > 0 ? "green" : "red"}>
          {d.pnl?.toFixed(0)}
        </td>
        <td>{d.pnlPct}%</td>

        <td>
          {isEditing ? (
            <>
              <button
                onClick={async () => {
                  await fetch(`http://localhost:5000/portfolio/${d.id}`, {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      quantity: Number(editForm.quantity),
                      avgPrice: Number(editForm.avgPrice),
                    }),
                  });

                  setEditingId(null);
                  fetchData();
                }}
              >
                ✅
              </button>

              <button onClick={() => setEditingId(null)}>❌</button>
            </>
          ) : (
            <>
              <button
                onClick={() => {
                  setEditingId(d.id);
                  setEditForm({
                    quantity: d.quantity,
                    avgPrice: d.avgPrice,
                  });
                }}
              >
                ✏️
              </button>

              <button
                onClick={() =>
                  deleteHolding(d.id).then(fetchData)
                }
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

      </main>
    </div>
  );
}

export default App;