const { normalize } = require("./intentParser");

const number = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const round = (value, digits = 2) => Number(number(value).toFixed(digits));

const isMutualFund = (symbol = "") => {
  const value = symbol.toLowerCase();
  return value.includes("fund") || value.includes("plan");
};

const getAssetType = (holding = {}) => {
  const symbol = String(holding.symbol || "").toLowerCase();

  if (isMutualFund(symbol)) return "Mutual Fund";
  if (symbol.includes("etf") || symbol.endsWith("-e")) return "ETF";
  if (symbol.includes("sgb") || symbol.endsWith("-gb")) return "SGB";
  return "Stock";
};

const getValue = (holding) => {
  const currentValue = number(holding.currentValue);

  if (currentValue > 0) return currentValue;

  return number(holding.quantity) * number(holding.currentPrice);
};

const getInvestment = (holding) =>
  number(holding.quantity) * number(holding.avgPrice);

const enrichHoldings = (holdings = [], totalValue) =>
  holdings
    .filter(Boolean)
    .map((holding) => {
      const currentValue = getValue(holding);
      const investment = getInvestment(holding);
      const pnl = number(holding.pnl) || currentValue - investment;
      const pnlPct =
        number(holding.pnlPct) ||
        (investment > 0 ? (pnl / investment) * 100 : 0);
      const allocationPct =
        totalValue > 0 ? (currentValue / totalValue) * 100 : 0;

      return {
        symbol: normalize(holding.symbol),
        rawSymbol: holding.symbol,
        sector: holding.sector || "Others",
        assetType: getAssetType(holding),
        quantity: number(holding.quantity),
        avgPrice: number(holding.avgPrice),
        currentPrice: number(holding.currentPrice),
        currentValue,
        investment,
        pnl,
        pnlPct,
        allocationPct,
        dailyPct: number(holding.dailyPct),
        dailyChange: number(holding.dailyChange),
        high52: number(holding.high52),
        low52: number(holding.low52),
        pe: number(holding.pe),
        marketCap: number(holding.marketCap),
      };
    });

const pushInsight = (insights, insight) => {
  if (!insight.detail) return;
  insights.push(insight);
};

const analyzeValuation = (holding, insights) => {
  if (holding.assetType !== "Stock") return;

  if (holding.pe >= 60) {
    pushInsight(insights, {
      type: "valuation",
      severity: "high",
      symbol: holding.symbol,
      title: `${holding.symbol} has a very high PE`,
      detail: `PE is ${round(holding.pe, 1)}, so valuation risk is elevated unless earnings growth supports it.`,
    });
  } else if (holding.pe >= 35) {
    pushInsight(insights, {
      type: "valuation",
      severity: "medium",
      symbol: holding.symbol,
      title: `${holding.symbol} valuation is elevated`,
      detail: `PE is ${round(holding.pe, 1)}. Watch whether growth and results justify the premium.`,
    });
  } else if (holding.pe > 0 && holding.pe <= 15) {
    pushInsight(insights, {
      type: "valuation",
      severity: "low",
      symbol: holding.symbol,
      title: `${holding.symbol} has a lower PE`,
      detail: `PE is ${round(holding.pe, 1)}. It may be cheaper, but quality and sector context still matter.`,
    });
  }
};

const analyzeRange = (holding, insights) => {
  if (holding.assetType !== "Stock") return;
  if (!holding.currentPrice || !holding.high52 || !holding.low52) return;
  if (holding.high52 <= holding.low52) return;

  const position =
    ((holding.currentPrice - holding.low52) /
      (holding.high52 - holding.low52)) *
    100;
  const fromHigh = ((holding.high52 - holding.currentPrice) / holding.high52) * 100;

  if (position >= 90) {
    pushInsight(insights, {
      type: "momentum",
      severity: "medium",
      symbol: holding.symbol,
      title: `${holding.symbol} trades near its 52-week high`,
      detail: `It is about ${round(fromHigh, 1)}% below the 52-week high, showing strong momentum but less margin for error.`,
    });
  } else if (position <= 15) {
    pushInsight(insights, {
      type: "momentum",
      severity: "medium",
      symbol: holding.symbol,
      title: `${holding.symbol} trades near its 52-week low`,
      detail: `It sits low in its 52-week range, which can indicate weakness or a possible recovery setup.`,
    });
  }
};

const analyzeEvents = (holdings, eventsCache = {}) => {
  const symbols = new Set(holdings.map((holding) => holding.symbol));
  const allEvents = [
    ...(eventsCache.active || []),
    ...(eventsCache.archive || []),
  ];

  return allEvents
    .filter((event) => symbols.has(normalize(event.symbol)))
    .slice(0, 8)
    .map((event) => {
      const symbol = normalize(event.symbol);
      const type = event.type || "EVENT";
      const detail =
        type === "DIVIDEND"
          ? "Dividend events can affect short-term price behavior around ex-date and record date."
          : type === "RESULT"
          ? "Results can reset expectations if earnings or guidance differ from market assumptions."
          : type === "MEETING"
          ? "Board meetings can create event risk, especially around dividends, fundraising, or strategic actions."
          : type === "RECORD"
          ? "Record dates matter for eligibility and can influence near-term price movement."
          : "Corporate announcements may affect sentiment depending on materiality.";

      return {
        type: "event",
        severity: type === "RESULT" || type === "MEETING" ? "medium" : "low",
        symbol,
        title: `${symbol}: ${event.title || type}`,
        detail,
        date: event.date || null,
        rawTitle: event.rawTitle || "",
      };
    });
};

const analyzePortfolio = ({ holdings = [], portfolio = {}, eventsCache = {} }) => {
  const rawHoldings = Array.isArray(holdings) ? holdings : [];
  const totalValue =
    number(portfolio.totalValue) ||
    rawHoldings.reduce((sum, holding) => sum + getValue(holding), 0);
  const totalInvestment =
    number(portfolio.totalInvestment) ||
    rawHoldings.reduce((sum, holding) => sum + getInvestment(holding), 0);
  const enrichedHoldings = enrichHoldings(rawHoldings, totalValue);
  const totalPnL = totalValue - totalInvestment;
  const totalPnLPct =
    totalInvestment > 0 ? (totalPnL / totalInvestment) * 100 : 0;

  const insights = [];
  const sectorMap = {};
  const assetMap = {};

  enrichedHoldings.forEach((holding) => {
    sectorMap[holding.sector] =
      (sectorMap[holding.sector] || 0) + holding.currentValue;
    assetMap[holding.assetType] =
      (assetMap[holding.assetType] || 0) + holding.currentValue;

    if (holding.allocationPct >= 20) {
      pushInsight(insights, {
        type: "concentration",
        severity: "high",
        symbol: holding.symbol,
        title: `${holding.symbol} is highly concentrated`,
        detail: `${holding.symbol} is ${round(holding.allocationPct, 1)}% of portfolio value.`,
      });
    } else if (holding.allocationPct >= 10) {
      pushInsight(insights, {
        type: "concentration",
        severity: "medium",
        symbol: holding.symbol,
        title: `${holding.symbol} is a large holding`,
        detail: `${holding.symbol} is ${round(holding.allocationPct, 1)}% of portfolio value.`,
      });
    }

    if (holding.pnlPct <= -20 && holding.currentValue > 0) {
      pushInsight(insights, {
        type: "loss",
        severity: "high",
        symbol: holding.symbol,
        title: `${holding.symbol} has a large unrealized loss`,
        detail: `Unrealized P&L is ${round(holding.pnlPct, 1)}%. Recheck thesis, position size, and event risk.`,
      });
    }

    analyzeValuation(holding, insights);
    analyzeRange(holding, insights);
  });

  const sectorBreakdown = Object.entries(sectorMap)
    .map(([sector, value]) => ({
      sector,
      value,
      pct: totalValue > 0 ? (value / totalValue) * 100 : 0,
    }))
    .sort((a, b) => b.value - a.value);

  const assetBreakdown = Object.entries(assetMap)
    .map(([assetType, value]) => ({
      assetType,
      value,
      pct: totalValue > 0 ? (value / totalValue) * 100 : 0,
    }))
    .sort((a, b) => b.value - a.value);

  const topSector = sectorBreakdown[0];

  if (topSector && topSector.pct >= 45) {
    pushInsight(insights, {
      type: "sector",
      severity: "high",
      title: `${topSector.sector} exposure is high`,
      detail: `${topSector.sector} is ${round(topSector.pct, 1)}% of the portfolio.`,
    });
  } else if (topSector && topSector.pct >= 30) {
    pushInsight(insights, {
      type: "sector",
      severity: "medium",
      title: `${topSector.sector} is the dominant sector`,
      detail: `${topSector.sector} is ${round(topSector.pct, 1)}% of the portfolio.`,
    });
  }

  const stockPct =
    totalValue > 0 ? ((assetMap.Stock || 0) / totalValue) * 100 : 0;
  const fundPct =
    totalValue > 0
      ? (((assetMap["Mutual Fund"] || 0) + (assetMap.ETF || 0)) / totalValue) *
        100
      : 0;

  if (stockPct >= 85 && enrichedHoldings.length >= 4) {
    pushInsight(insights, {
      type: "allocation",
      severity: "medium",
      title: "Portfolio is stock-heavy",
      detail: `Stocks are ${round(stockPct, 1)}% of portfolio value. Fund or ETF exposure is ${round(fundPct, 1)}%.`,
    });
  }

  if (Object.prototype.hasOwnProperty.call(portfolio, "cash")) {
    const cash = number(portfolio.cash);
    const cashPct = totalValue + cash > 0 ? (cash / (totalValue + cash)) * 100 : 0;
    pushInsight(insights, {
      type: "cash",
      severity: cashPct < 3 ? "medium" : "low",
      title: "Cash allocation",
      detail: `Cash is ${round(cashPct, 1)}% of tracked assets.`,
    });
  }

  const bestPerformer = [...enrichedHoldings].sort(
    (a, b) => b.pnlPct - a.pnlPct
  )[0];
  const weakestHolding = [...enrichedHoldings].sort(
    (a, b) => a.pnlPct - b.pnlPct
  )[0];
  const largestHolding = [...enrichedHoldings].sort(
    (a, b) => b.allocationPct - a.allocationPct
  )[0];
  const eventInsights = analyzeEvents(enrichedHoldings, eventsCache);

  return {
    summary: {
      holdingCount: enrichedHoldings.length,
      totalValue: round(totalValue, 0),
      totalInvestment: round(totalInvestment, 0),
      totalPnL: round(totalPnL, 0),
      totalPnLPct: round(totalPnLPct, 2),
      bestPerformer,
      weakestHolding,
      largestHolding,
      diversificationQuality:
        largestHolding?.allocationPct >= 20
          ? "Weak"
          : largestHolding?.allocationPct >= 10
          ? "Moderate"
          : "Healthy",
    },
    holdings: enrichedHoldings,
    sectorBreakdown,
    assetBreakdown,
    insights: insights
      .sort((a, b) => {
        const weight = { high: 3, medium: 2, low: 1 };
        return (weight[b.severity] || 0) - (weight[a.severity] || 0);
      })
      .slice(0, 12),
    eventInsights,
  };
};

module.exports = {
  analyzePortfolio,
  getAssetType,
};
