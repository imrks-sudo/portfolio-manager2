import React, { useEffect, useState } from "react";
import {
  getPortfolio,
  addHolding,
  deleteHolding,
  updateHolding,
  replacePortfolio,
  updatePrices,
} from "./api";
import { PieChart, Pie, Cell, Tooltip } from "recharts";
import Papa from "papaparse";

const COLORS = ["#0088FE", "#00C49F", "#FFBB28", "#FF8042", "#845EC2"];

function App() {
  const [data, setData] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({});

  const [dark, setDark] = useState(() => {
    return localStorage.getItem("darkMode") === "true";
  });

  const [form, setForm] = useState({
    symbol: "",
    quantity: "",
    avgPrice: "",
    sector: "",
  });

  const fetchData = async () => {
    try {
      const res = await getPortfolio();
      setData(res.data);
    } catch (err) {
      console.error("Error fetching data:", err);
    }
  };

  const handleUpdatePrices = async () => {
  try {
    await updatePrices();
    await fetchData();
    alert("Prices updated ✅");
  } catch (err) {
    console.error(err);
    alert("Price update failed ❌");
  }
};

  useEffect(() => {
    fetchData();
  }, []);

  const handleAdd = async () => {
    if (!form.symbol || !form.quantity) return;

    await addHolding(form);
    setForm({ symbol: "", quantity: "", avgPrice: "", sector: "" });
    fetchData();
  };

  // ✅ CSV Upload Handler
  const handleFileUpload = (e) => {
    console.log("FILE UPLOAD TRIGGERED");

    const file = e.target.files[0];
    if (!file) return;

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      beforeFirstChunk: function (chunk) {
        const lines = chunk.split("\n");
        const headerIndex = lines.findIndex((line) =>
          line.includes("Symbol")
        );
        return lines.slice(headerIndex).join("\n");
      },
      complete: async function (results) {
        console.log("Parsed CSV:", results.data);

        const payloads = results.data
  .map((row) => {
    const symbol = row["Symbol"]?.trim();

    const quantity =
      Number(row["Quantity Available"] || row["Qty"] || row["Units"]) || 0;

    const avgPrice =
      Number(row["Average Price"] || row["Buy avg."] || row["Avg NAV"])|| 0;

    const prevClose = 0;

    // 🔥 detect MF vs stock
    const isMF =
      symbol &&
      (symbol.toLowerCase().includes("fund") ||
        symbol.toLowerCase().includes("etf") ||
        symbol.toLowerCase().includes("plan"));

    return {
      symbol,
      quantity,
      avgPrice,
      prevClose,
      sector:
        row["Sector"] ||
        (isMF ? detectMFCategory(symbol) : row["Sector"]),
    };
  })
  .filter((p) => p.symbol && p.quantity);

        console.log("Uploading:", payloads.length, "stocks");

        try {
          await Promise.all(payloads.map(p => addHolding(p)));
          await fetchData();
          alert("Portfolio synced successfully 🚀");
        } catch (err) {
          console.error("Upload failed:", err);
          alert("Upload failed ❌");
        }
      },
    });
  };

        function detectMFCategory(symbol) {
  const name = symbol.toLowerCase();

  const map = [
    { key: "arbitrage", value: "Arbitrage" },
    { key: "flexi", value: "Flexi Cap" },
    { key: "multi", value: "Multi Cap" },
    { key: "large", value: "Large Cap" },
    { key: "mid", value: "Mid Cap" },
    { key: "small", value: "Small Cap" },
    { key: "index", value: "Index" },
    { key: "etf", value: "ETF" },
    { key: "liquid", value: "Liquid" },
  ];

  for (let m of map) {
    if (name.includes(m.key)) return m.value;
  }

  return "Others";
}

  // 📊 Charts
  const chartData = data.map((d) => ({
    name: d.symbol,
    value: d.currentValue || 0,
  }));

  const sectorDataMap = {};
  data.forEach((d) => {
    if (!d.sector) return;
    sectorDataMap[d.sector] =
      (sectorDataMap[d.sector] || 0) + (d.currentValue || 0);
  });

  const sectorData = Object.keys(sectorDataMap).map((sector) => ({
    name: sector,
    value: sectorDataMap[sector],
  }));

  // 📊 Totals
  const totalValue = data.reduce((sum, d) => sum + (d.currentValue || 0), 0);
  const totalInvestment = data.reduce((sum, d) => sum + (d.investment || 0), 0);
  const totalPnL = totalValue - totalInvestment;

  // 🧠 Insights
  const insights = [];
  if (totalValue > 0) {
    Object.entries(sectorDataMap).forEach(([sector, value]) => {
      const pct = (value / totalValue) * 100;
      if (pct > 40) {
        insights.push(`⚠️ High exposure to ${sector} (${pct.toFixed(0)}%)`);
      }
    });
  }

  return (
    <div className={dark ? "app dark" : "app"}>
      {/* Sidebar */}
      <aside className="sidebar">
        <h2>📊 Portfolio AI</h2>
        <p>Dashboard</p>
        <p>Analytics</p>
        <p>Insights</p>

        <button
          onClick={() => {
            const newMode = !dark;
            setDark(newMode);
            localStorage.setItem("darkMode", newMode);
          }}
        >
          {dark ? "☀️ Light" : "🌙 Dark"}
        </button>
      </aside>

      {/* Main */}
      <main className="main">
        <h1 style={{ fontWeight: 600 }}>Portfolio Overview</h1>

        {/* Upload */}
        <div className="card" style={{ marginTop: 10 }}>
          <h3>Import CSV</h3>
          <input
            type="file"
            accept=".csv"
            onChange={(e) => {
              console.log("INPUT CHANGED");
              handleFileUpload(e);
              e.target.value = null;
            }}
          />
        </div>

        <div className="card" style={{ marginTop: 10 }}>
  <h3>Market Data</h3>
  <button onClick={handleUpdatePrices}>
    🔄 Update Prices
  </button>
</div> 

        {/* Cards */}
        <div className="flex" style={{ marginTop: 20 }}>
          <div className="card" style={{ width: 340 }}>
            <h3>Portfolio Value</h3>
            <p>₹{totalValue.toLocaleString()}</p>
          </div>

          <div className="card" style={{ width: 340 }}>
            <h3>Investment</h3>
            <p>₹{totalInvestment.toLocaleString()}</p>
          </div>

          <div className="card" style={{ width: 340 }}>
            <h3>P&L</h3>
            <p className={totalPnL > 0 ? "green" : "red"}>
              ₹{totalPnL.toLocaleString()}
            </p>
          </div>
        </div>

        {/* Charts */}
        <div className="flex" style={{ marginTop: 20, alignItems: "stretch" }}>
          <div className="card" style={{ width: 340 }}>
            <h3>Stock Allocation</h3>
            <PieChart width={300} height={250}>
              <Pie
  data={chartData}
  dataKey="value"
  outerRadius={100}
  isAnimationActive={true}
  animationDuration={800}
>
                {chartData.map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip formatter={(v) => `₹${v.toFixed(0)}`} />
            </PieChart>
          </div>

          <div className="card" style={{ width: 340 }}>
            <h3>Sector Allocation</h3>
            <PieChart width={300} height={250}>
              <Pie
  data={sectorData}
  dataKey="value"
  outerRadius={100}
  isAnimationActive={true}
  animationDuration={800}
>
                {sectorData.map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip formatter={(v) => `₹${v.toFixed(0)}`} />
            </PieChart>
          </div>

          <div className="card" style={{ width: 340 }}>
            <h3>Insights</h3>
            {insights.length === 0 ? (
              <p>✅ Well diversified</p>
            ) : (
              insights.map((i, idx) => <p key={idx}>{i}</p>)
            )}
          </div>
        </div>

        {/* Form */}
        <div className="card" style={{ marginTop: 20 }}>
          <input
            placeholder="Symbol"
            value={form.symbol}
            onChange={(e) =>
              setForm({ ...form, symbol: e.target.value })
            }
          />
          <input
            placeholder="Qty"
            value={form.quantity}
            onChange={(e) =>
              setForm({ ...form, quantity: e.target.value })
            }
          />
          <input
            placeholder="Avg Price"
            value={form.avgPrice}
            onChange={(e) =>
              setForm({ ...form, avgPrice: e.target.value })
            }
          />

          <select
            value={form.sector}
            onChange={(e) =>
              setForm({ ...form, sector: e.target.value })
            }
          >
            <option value="">Select Sector</option>
            <option value="Financials">Financials</option>
            <option value="IT">IT</option>
            <option value="Energy">Energy</option>
            <option value="FMCG">FMCG</option>
            <option value="Pharma">Pharma</option>
            <option value="Auto">Auto</option>
            <option value="Others">Others</option>
          </select>

          <button onClick={handleAdd}>Add</button>
        </div>

        {/* Table */}
        <table className="table">
          <thead>
            <tr>
              <th>Stock</th>
              <th>Sector</th>
              <th>Quantity</th>
              <th>Average Price</th>
              <th>Current Price</th>
              <th>Value</th>
              <th>P&L</th>
              <th>%</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {data.length === 0 ? (
              <tr>
                <td colSpan="10">No data</td>
              </tr>
            ) : (
              data.map((d) => (
                <tr key={d.id}>
                  <td>{d.symbol}</td>
                  <td>{d.sector}</td>

                  <td>
                    {editingId === d.id ? (
                      <input
                        value={editForm.quantity}
                        onChange={(e) =>
                          setEditForm({
                            ...editForm,
                            quantity: e.target.value,
                          })
                        }
                      />
                    ) : (
                      d.quantity
                    )}
                  </td>

                  <td>
                    {editingId === d.id ? (
                      <input
                        value={editForm.avgPrice}
                        onChange={(e) =>
                          setEditForm({
                            ...editForm,
                            avgPrice: e.target.value,
                          })
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
                    {editingId === d.id ? (
                      <>
                        <button
                          onClick={async () => {
                            await updateHolding(d.id, editForm);
                            setEditingId(null);
                            fetchData();
                          }}
                        >
                          💾
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
                          ❌
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </main>
    </div>
  );
}

export default App;