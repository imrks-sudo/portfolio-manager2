// ─── Formatters ───────────────────────────────────────────────────────────────

const formatCurrency = (value) =>
  `Rs ${Math.round(Number(value) || 0).toLocaleString("en-IN")}`;

const formatPct = (value, showSign = false) => {
  const num = Number(value || 0);
  const sign = showSign && num > 0 ? "+" : "";
  return `${sign}${num.toFixed(1)}%`;
};

const formatNumber = (value, digits = 2) =>
  Number(value || 0).toLocaleString("en-IN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });

// ─── Range helpers ─────────────────────────────────────────────────────────────

const getRangeStats = (holding) => {
  if (!holding?.currentPrice || !holding.high52 || !holding.low52) return null;
  if (holding.high52 <= holding.low52) return null;

  const rangePct =
    ((holding.currentPrice - holding.low52) / (holding.high52 - holding.low52)) * 100;
  const fromHigh =
    holding.high52 > 0
      ? ((holding.high52 - holding.currentPrice) / holding.high52) * 100
      : 0;

  return {
    rangePct,
    fromHigh,
    label:
      rangePct >= 85 ? "upper range" : rangePct <= 20 ? "lower range" : "middle range",
  };
};

// ─── Shared helpers ────────────────────────────────────────────────────────────

const getTargetHoldings = (analysis, intent) => {
  const targets = new Set(intent.mentionedSymbols || []);
  if (!targets.size) return [];
  return (analysis.holdings || []).filter((h) => targets.has(h.symbol));
};

const getTopHoldings = (analysis, count = 5) =>
  [...(analysis.holdings || [])]
    .sort((a, b) => b.allocationPct - a.allocationPct)
    .slice(0, count);

const getHealthLabel = (analysis) => {
  const largest = analysis.summary?.largestHolding?.allocationPct || 0;
  const topSector = analysis.sectorBreakdown?.[0]?.pct || 0;
  if (largest >= 20 || topSector >= 45) return "Needs Attention";
  if (largest >= 10 || topSector >= 30) return "Moderate";
  return "Healthy";
};

const formatAssetMix = (analysis) =>
  (analysis.assetBreakdown || [])
    .filter((item) => item.pct > 0)
    .map((item) => `${item.assetType} ${formatPct(item.pct)}`)
    .join("  •  ");

const getTechnicalLinesForSymbol = (technical, symbol) =>
  (technical.signals || [])
    .filter((s) => s.symbol === symbol)
    .map((s) => s.detail)
    .filter(Boolean)
    .slice(0, 3);

const getIndicatorLineForSymbol = (technical, symbol) => {
  const item = (technical.indicators || []).find((e) => e.symbol === symbol);
  const ind = item?.indicators;
  if (!ind?.hasData) return null;

  const macdTone =
    ind.macd?.histogram > 0 ? "positive" : ind.macd?.histogram < 0 ? "negative" : "flat";

  return [
    `RSI ${formatNumber(ind.rsi14, 1)}`,
    `MACD histogram ${formatNumber(ind.macd?.histogram, 2)} (${macdTone})`,
    `price ${ind.price > ind.sma20 ? "above" : "below"} SMA20`,
  ].join("  •  ");
};

// ─── Portfolio Health ──────────────────────────────────────────────────────────

const buildPortfolioHealthAnswer = (analysis) => {
  const summary = analysis.summary || {};
  const topHoldings = getTopHoldings(analysis, 5);
  const top5Pct = topHoldings.reduce((sum, h) => sum + h.allocationPct, 0);
  const topSector = analysis.sectorBreakdown?.[0];
  const assetMix = formatAssetMix(analysis);
  const watchItems = (analysis.insights || []).slice(0, 3);
  const lines = [];

  // ── Overview ──
  lines.push(
    `📊 ${getHealthLabel(analysis)}  —  ${summary.holdingCount || 0} holdings`
  );
  lines.push(
    `• Value: ${formatCurrency(summary.totalValue)}  |  P&L: ${formatPct(summary.totalPnLPct, true)}`
  );
  if (assetMix) lines.push(`• Asset mix: ${assetMix}`);
  if (topSector) {
    lines.push(
      `• Top sector: ${topSector.sector} at ${formatPct(topSector.pct)} of portfolio`
    );
  }

  // ── Performance ──
  if (summary.bestPerformer && summary.weakestHolding) {
    lines.push("");
    lines.push("🏆 Performance");
    lines.push(
      `• Best:    ${summary.bestPerformer.symbol.padEnd(12)} ${formatPct(summary.bestPerformer.pnlPct, true)}`
    );
    lines.push(
      `• Weakest: ${summary.weakestHolding.symbol.padEnd(12)} ${formatPct(summary.weakestHolding.pnlPct, true)}`
    );
  }

  // ── Concentration ──
  if (topHoldings.length) {
    lines.push("");
    lines.push(
      `📍 Largest positions  (top 5 = ${formatPct(top5Pct)} of portfolio)`
    );
    lines.push(
      topHoldings
        .map((h) => `• ${h.symbol.padEnd(14)} ${formatPct(h.allocationPct)}`)
        .join("\n")
    );
  }

  // ── Watch list — FIX: now includes stock symbol for each item ──
  if (watchItems.length) {
    lines.push("");
    lines.push("⚠️  Watch");
    watchItems.forEach((item) => {
      const label = item.symbol ? `${item.symbol}: ` : "";
      lines.push(`• ${label}${item.detail}`);
    });
  }

  return lines.join("\n");
};

// ─── Concentration ─────────────────────────────────────────────────────────────

const buildConcentrationAnswer = (analysis) => {
  const topHoldings = getTopHoldings(analysis, 5);
  const top5Pct = topHoldings.reduce((sum, h) => sum + h.allocationPct, 0);
  const above10 = (analysis.holdings || []).filter((h) => h.allocationPct >= 10);
  const topSector = analysis.sectorBreakdown?.[0];
  const lines = [];

  lines.push(`🎯 Concentration  —  top 5 = ${formatPct(top5Pct)} of portfolio`);
  lines.push("");

  if (topHoldings.length) {
    lines.push("Largest positions:");
    topHoldings.forEach((h) => {
      lines.push(`• ${h.symbol.padEnd(14)} ${formatPct(h.allocationPct)}`);
    });
  }

  lines.push("");

  if (above10.length) {
    lines.push(
      `Holdings above 10%: ${above10.map((h) => `${h.symbol} ${formatPct(h.allocationPct)}`).join("  •  ")}`
    );
  } else {
    lines.push("Holdings above 10%: none — single-stock concentration is controlled.");
  }

  if (topSector) {
    lines.push(
      `Top sector: ${topSector.sector} at ${formatPct(topSector.pct)}`
    );
  }

  lines.push("");
  const tip =
    above10.length || (topSector?.pct || 0) >= 30
      ? "💡 Risk is concentrated in the largest position and top sector, not spread across every holding."
      : "💡 Concentration looks spread out — focus next on weak performers and event risk.";
  lines.push(tip);

  return lines.join("\n");
};

// ─── Events ────────────────────────────────────────────────────────────────────

const buildEventAnswer = (analysis) => {
  const events = analysis.eventInsights || [];
  const topHoldings = getTopHoldings(analysis, 5);
  const lines = [];

  if (!events.length) {
    lines.push("📅 No matched NSE corporate events for your holdings right now.");
    lines.push("");
    if (topHoldings.length) {
      lines.push("Monitor when events appear:");
      topHoldings.forEach((h) => {
        lines.push(`• ${h.symbol.padEnd(14)} ${formatPct(h.allocationPct)}`);
      });
    }
    lines.push("");
    lines.push("💡 Results, dividends, board meetings and record dates can create price risk when they appear.");
    return lines.join("\n");
  }

  lines.push(`📅 Corporate Events  —  ${events.length} matched for your holdings`);
  lines.push("");

  events.slice(0, 5).forEach((event) => {
    const date = event.date ? ` (${event.date})` : "";
    lines.push(`• ${event.symbol}${date}: ${event.title}`);
    lines.push(`  ${event.detail}`);
  });

  lines.push("");
  lines.push("💡 Event impact is highest where allocation is large or price momentum is already weak.");

  return lines.join("\n");
};

// ─── Technical Momentum Scan ───────────────────────────────────────────────────

const formatMomentumRow = ({ holding, range }) => {
  const daily = Number(holding.dailyPct || 0);
  const dailyStr = `${daily >= 0 ? "+" : ""}${daily.toFixed(1)}%`;
  return (
    `• ${holding.symbol.padEnd(14)}` +
    `  ${formatPct(range.rangePct)} of range` +
    `  |  ${formatPct(range.fromHigh)} from high` +
    `  |  alloc ${formatPct(holding.allocationPct)}` +
    `  |  daily ${dailyStr}`
  );
};

const getMomentumRows = (analysis) =>
  (analysis.holdings || [])
    .filter((h) => h.assetType !== "Mutual Fund")
    .map((h) => ({ holding: h, range: getRangeStats(h) }))
    .filter((row) => row.range);

const buildTechnicalScanAnswer = (analysis) => {
  const rows = getMomentumRows(analysis);

  if (!rows.length) {
    return "📈 Technical scan: update prices first so 52-week range and daily move data are available.";
  }

  const strong = rows
    .filter((r) => r.range.rangePct >= 85)
    .sort((a, b) => b.holding.allocationPct - a.holding.allocationPct)
    .slice(0, 3);
  const weak = rows
    .filter((r) => r.range.rangePct <= 20)
    .sort((a, b) => b.holding.allocationPct - a.holding.allocationPct)
    .slice(0, 3);
  const sharp = rows
    .filter((r) => Math.abs(r.holding.dailyPct) >= 2)
    .sort((a, b) => Math.abs(b.holding.dailyPct) - Math.abs(a.holding.dailyPct))
    .slice(0, 3);

  const lines = [
    `📈 Technical Momentum  —  ${rows.length} holdings with 52W range data`,
    "",
  ];

  lines.push(
    strong.length
      ? "✅ Strong (near 52W high)"
      : "✅ Strong: none above 85% of 52-week range"
  );
  strong.forEach((r) => lines.push(formatMomentumRow(r)));

  lines.push("");
  lines.push(
    weak.length
      ? "⚠️  Weak (near 52W low)"
      : "⚠️  Weak: none below 20% of 52-week range"
  );
  weak.forEach((r) => lines.push(formatMomentumRow(r)));

  if (sharp.length) {
    lines.push("");
    lines.push("⚡ Sharp moves today");
    sharp.forEach((r) => lines.push(formatMomentumRow(r)));
  }

  lines.push("");
  lines.push(
    "💡 Prioritize high-allocation names that are weak in their range or moving sharply."
  );

  return lines.join("\n");
};

// ─── Individual Holding ────────────────────────────────────────────────────────

const describeHolding = (holding, technical, intent) => {
  const range = getRangeStats(holding);
  const indicatorLine = getIndicatorLineForSymbol(technical, holding.symbol);
  const technicalLines = getTechnicalLinesForSymbol(technical, holding.symbol);
  const indicatorRequested =
    intent.wantsLiveIndicators &&
    (technical.indicators || []).some((e) => e.symbol === holding.symbol);

  const lines = [];

  // ── Header ──
  lines.push(`📌 ${holding.symbol}`);
  lines.push("");
  lines.push(
    `• Price: Rs ${formatNumber(holding.currentPrice, 2)}` +
    `  |  Allocation: ${formatPct(holding.allocationPct)}` +
    `  |  P&L: ${formatPct(holding.pnlPct, true)}`
  );

  // ── 52W Range ──
  if (range) {
    lines.push(
      `• 52W range: Rs ${formatNumber(holding.low52, 2)} – Rs ${formatNumber(holding.high52, 2)}`
    );
    lines.push(
      `  → ${formatPct(range.rangePct)} through range  |  ${formatPct(range.fromHigh)} below 52W high  (${range.label})`
    );
  }

  // ── Daily & PE ──
  const extras = [];
  if (holding.dailyPct)
    extras.push(`Daily: ${formatPct(holding.dailyPct, true)}`);
  if (holding.pe) extras.push(`PE: ${formatNumber(holding.pe, 1)}`);
  if (extras.length) lines.push(`• ${extras.join("  |  ")}`);

  // ── Live indicators ──
  if (indicatorLine) {
    lines.push(`• Indicators: ${indicatorLine}`);
  } else if (indicatorRequested) {
    lines.push(
      "• Indicators: live history unavailable — reading uses 52-week range, daily move, PE and allocation."
    );
  }

  // ── Technical signals (de-duplicated) ──
  technicalLines.forEach((line) => {
    if (!lines.some((existing) => existing.includes(line))) {
      lines.push(`• ${line}`);
    }
  });

  // ── Callout ──
  lines.push("");
  const tip =
    range?.rangePct <= 20
      ? "💡 Momentum is weak — watch for a move out of the lower range before adding."
      : range?.rangePct >= 85
      ? "💡 Momentum is strong, but the price is close to its 52-week high."
      : "💡 Momentum is neutral — allocation size and upcoming results matter more than price location right now.";
  lines.push(tip);

  return lines.slice(0, 12).join("\n");
};

// ─── Not in Portfolio ──────────────────────────────────────────────────────────

/**
 * Returns a clear, helpful message when the user asks about a symbol
 * that is not in their portfolio.
 */
const buildNotInPortfolioAnswer = (intent, analysis) => {
  const symbols = (intent.unmatchedSymbols || []).join(", ");
  const holdingCount = analysis.holdings?.length || 0;
  const topHoldings = getTopHoldings(analysis, 5);

  const lines = [
    `❌ ${symbols} ${(intent.unmatchedSymbols || []).length === 1 ? "is" : "are"} not in your portfolio.`,
    "",
  ];

  if (holdingCount > 0) {
    lines.push(`Your portfolio has ${holdingCount} holdings.`);
    if (topHoldings.length) {
      lines.push(
        `Largest positions: ${topHoldings.map((h) => h.symbol).join(", ")}.`
      );
    }
    lines.push("");
    lines.push("You can ask me about:");
    lines.push('• A holding you own — e.g. "Analyze HDFCBANK" or "How is DIXON doing?"');
    lines.push('• Portfolio-wide analysis — "Portfolio health", "Risk", "Events", "Technical scan"');
  } else {
    lines.push("Add holdings first, then I can answer questions about them.");
  }

  return lines.join("\n");
};

// ─── Fallback answer (used when Gemini is unavailable) ────────────────────────

const compactInsight = (insight) => {
  if (!insight) return "";
  return insight.symbol ? `${insight.symbol}: ${insight.detail}` : insight.detail;
};

const getRelevantInsights = (analysis, technical, intent) => {
  const insights = [];
  if (intent.wantsRisk || intent.wantsSummary) insights.push(...(analysis.insights || []));
  if (intent.wantsEvents) insights.push(...(analysis.eventInsights || []));
  if (intent.wantsTechnical) insights.push(...(technical.signals || []));
  if (!insights.length) {
    insights.push(...(analysis.insights || []), ...(analysis.eventInsights || []));
  }
  return insights.slice(0, 5);
};

const buildFallbackAnswer = ({ analysis, technical, intent }) => {
  // ── Unknown symbol: user asked about a stock they don't own ──
  if ((intent.unmatchedSymbols || []).length > 0) {
    return buildNotInPortfolioAnswer(intent, analysis);
  }

  const targetHoldings = getTargetHoldings(analysis, intent);

  // ── Specific holding(s) ──
  if (targetHoldings.length) {
    return targetHoldings
      .map((h) => describeHolding(h, technical, intent))
      .join("\n\n─────────────────────\n\n");
  }

  // ── Corporate events ──
  if (intent.wantsEvents) {
    return buildEventAnswer(analysis);
  }

  // ── Risk / health ──
  if (intent.wantsRisk) {
    return intent.wantsSummary
      ? buildPortfolioHealthAnswer(analysis)
      : buildConcentrationAnswer(analysis);
  }

  // ── Summary ──
  if (intent.wantsSummary) {
    return buildPortfolioHealthAnswer(analysis);
  }

  // ── Technical scan ──
  if (intent.wantsTechnical) {
    return buildTechnicalScanAnswer(analysis);
  }

  // ── Generic fallback ──
  const summary = analysis.summary || {};
  const parts = [];

  if (summary.totalValue) {
    parts.push(
      `Portfolio value: ${formatCurrency(summary.totalValue)}  |  P&L: ${formatPct(summary.totalPnLPct, true)}`
    );
  }

  if (summary.largestHolding) {
    parts.push(
      `Largest holding: ${summary.largestHolding.symbol} at ${formatPct(
        summary.largestHolding.allocationPct
      )}  |  Diversification: ${String(summary.diversificationQuality || "moderate").toLowerCase()}`
    );
  }

  if (summary.bestPerformer && summary.weakestHolding) {
    parts.push(
      `Best: ${summary.bestPerformer.symbol} ${formatPct(summary.bestPerformer.pnlPct, true)}  |  ` +
      `Weakest: ${summary.weakestHolding.symbol} ${formatPct(summary.weakestHolding.pnlPct, true)}`
    );
  }

  const relevant = getRelevantInsights(analysis, technical, intent);
  relevant.forEach((insight) => {
    const line = compactInsight(insight);
    if (line) parts.push(`• ${line}`);
  });

  if (!parts.length) {
    return "I need updated holdings and prices before I can analyze this portfolio.";
  }

  return parts.slice(0, 6).join("\n");
};

module.exports = {
  buildFallbackAnswer,
  buildNotInPortfolioAnswer,
};