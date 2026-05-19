const formatCurrency = (value) =>
  `Rs ${Math.round(Number(value) || 0).toLocaleString("en-IN")}`;

const formatPct = (value) => `${Number(value || 0).toFixed(1)}%`;

const formatNumber = (value, digits = 2) =>
  Number(value || 0).toLocaleString("en-IN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });

const getRangeStats = (holding) => {
  if (!holding?.currentPrice || !holding.high52 || !holding.low52) {
    return null;
  }

  if (holding.high52 <= holding.low52) return null;

  const rangePct =
    ((holding.currentPrice - holding.low52) /
      (holding.high52 - holding.low52)) *
    100;
  const fromHigh =
    holding.high52 > 0
      ? ((holding.high52 - holding.currentPrice) / holding.high52) * 100
      : 0;

  return {
    rangePct,
    fromHigh,
    label:
      rangePct >= 85
        ? "upper range"
        : rangePct <= 20
        ? "lower range"
        : "middle range",
  };
};

const getTargetHoldings = (analysis, intent) => {
  const targets = new Set(intent.mentionedSymbols || []);
  if (!targets.size) return [];

  return (analysis.holdings || []).filter((holding) =>
    targets.has(holding.symbol)
  );
};

const getTechnicalLinesForSymbol = (technical, symbol) =>
  (technical.signals || [])
    .filter((signal) => signal.symbol === symbol)
    .map((signal) => signal.detail)
    .filter(Boolean)
    .slice(0, 3);

const getIndicatorLineForSymbol = (technical, symbol) => {
  const item = (technical.indicators || []).find(
    (entry) => entry.symbol === symbol
  );
  const indicators = item?.indicators;

  if (!indicators?.hasData) return null;

  const macdTone =
    indicators.macd?.histogram > 0
      ? "positive"
      : indicators.macd?.histogram < 0
      ? "negative"
      : "flat";

  return `RSI ${formatNumber(indicators.rsi14, 1)}, MACD histogram ${formatNumber(
    indicators.macd?.histogram,
    2
  )} (${macdTone}), price ${indicators.price > indicators.sma20 ? "above" : "below"} SMA20.`;
};

const getTopHoldings = (analysis, count = 5) =>
  [...(analysis.holdings || [])]
    .sort((a, b) => b.allocationPct - a.allocationPct)
    .slice(0, count);

const formatHoldingWeights = (holdings) =>
  holdings
    .map((holding) => `${holding.symbol} ${formatPct(holding.allocationPct)}`)
    .join(", ");

const formatAssetMix = (analysis) =>
  (analysis.assetBreakdown || [])
    .filter((item) => item.pct > 0)
    .map((item) => `${item.assetType} ${formatPct(item.pct)}`)
    .join(", ");

const getHealthLabel = (analysis) => {
  const largest = analysis.summary?.largestHolding?.allocationPct || 0;
  const topSector = analysis.sectorBreakdown?.[0]?.pct || 0;

  if (largest >= 20 || topSector >= 45) return "Needs attention";
  if (largest >= 10 || topSector >= 30) return "Moderate";
  return "Healthy";
};

const buildPortfolioHealthAnswer = (analysis) => {
  const summary = analysis.summary || {};
  const topHoldings = getTopHoldings(analysis, 5);
  const top5Pct = topHoldings.reduce(
    (sum, holding) => sum + holding.allocationPct,
    0
  );
  const topSector = analysis.sectorBreakdown?.[0];
  const watchItems = (analysis.insights || []).slice(0, 3);
  const lines = [];

  lines.push(
    `Portfolio health: ${getHealthLabel(analysis)}. ${summary.holdingCount || 0} holdings, value ${formatCurrency(
      summary.totalValue
    )}, P&L ${formatPct(summary.totalPnLPct)}.`
  );

  if (topHoldings.length) {
    lines.push(
      `Concentration: top 5 holdings are ${formatPct(
        top5Pct
      )}; largest is ${summary.largestHolding?.symbol || topHoldings[0].symbol} at ${formatPct(
        summary.largestHolding?.allocationPct || topHoldings[0].allocationPct
      )}.`
    );
  }

  if (topSector) {
    lines.push(
      `Sector exposure: ${topSector.sector} is ${formatPct(
        topSector.pct
      )}, the biggest sector bucket.`
    );
  }

  const assetMix = formatAssetMix(analysis);
  if (assetMix) lines.push(`Asset mix: ${assetMix}.`);

  if (summary.bestPerformer && summary.weakestHolding) {
    lines.push(
      `Performance spread: best ${summary.bestPerformer.symbol} ${formatPct(
        summary.bestPerformer.pnlPct
      )}; weakest ${summary.weakestHolding.symbol} ${formatPct(
        summary.weakestHolding.pnlPct
      )}.`
    );
  }

  if (watchItems.length) {
    lines.push(
      `Watch list: ${watchItems
        .map((item) => item.detail)
        .join(" ")}`
    );
  }

  return lines.join("\n");
};

const buildConcentrationAnswer = (analysis) => {
  const topHoldings = getTopHoldings(analysis, 5);
  const top5Pct = topHoldings.reduce(
    (sum, holding) => sum + holding.allocationPct,
    0
  );
  const above10 = (analysis.holdings || []).filter(
    (holding) => holding.allocationPct >= 10
  );
  const topSector = analysis.sectorBreakdown?.[0];
  const lines = [];

  lines.push(
    `Concentration risk: top 5 holdings add up to ${formatPct(top5Pct)}.`
  );

  if (topHoldings.length) {
    lines.push(`Largest positions: ${formatHoldingWeights(topHoldings)}.`);
  }

  lines.push(
    above10.length
      ? `Holdings above 10%: ${formatHoldingWeights(above10)}.`
      : "Holdings above 10%: none, so single-stock concentration is controlled."
  );

  if (topSector) {
    lines.push(
      `Sector concentration: ${topSector.sector} is ${formatPct(
        topSector.pct
      )}.`
    );
  }

  const read =
    above10.length || (topSector?.pct || 0) >= 30
      ? "Read: concentration risk is mainly from the largest positions or sector bucket, not from every holding."
      : "Read: concentration risk looks spread out; focus next on weak performers and event risk.";
  lines.push(read);

  return lines.join("\n");
};

const buildEventAnswer = (analysis) => {
  const events = analysis.eventInsights || [];
  const largest = getTopHoldings(analysis, 5);

  if (!events.length) {
    return [
      "Event impact: no cached NSE corporate events currently match your holdings.",
      largest.length
        ? `Highest-impact holdings to monitor if events appear: ${formatHoldingWeights(
            largest
          )}.`
        : "",
      "Read: cached event risk is low right now, but results, dividends, board meetings, and record dates can still matter when they appear.",
    ]
      .filter(Boolean)
      .join("\n");
  }

  return [
    `Event impact: ${events.length} matched corporate event(s) in cache.`,
    ...events.slice(0, 5).map((event) => {
      const date = event.date ? ` on ${event.date}` : "";
      return `${event.symbol}${date}: ${event.title}. ${event.detail}`;
    }),
    "Read: event impact is highest where allocation is large or price momentum is already weak.",
  ].join("\n");
};

const getMomentumRows = (analysis) =>
  (analysis.holdings || [])
    .filter((holding) => holding.assetType !== "Mutual Fund")
    .map((holding) => {
      const range = getRangeStats(holding);
      return { holding, range };
    })
    .filter((row) => row.range);

const formatMomentumRow = ({ holding, range }) =>
  `${holding.symbol} ${formatPct(range.rangePct)} of 52W range, ${formatPct(
    range.fromHigh
  )} below high, alloc ${formatPct(holding.allocationPct)}, daily ${formatPct(
    holding.dailyPct
  )}`;

const buildTechnicalScanAnswer = (analysis) => {
  const rows = getMomentumRows(analysis);

  if (!rows.length) {
    return "Technical momentum scan: update prices first so 52-week range and daily move data are available.";
  }

  const strong = rows
    .filter((row) => row.range.rangePct >= 85)
    .sort((a, b) => b.holding.allocationPct - a.holding.allocationPct)
    .slice(0, 3);
  const weak = rows
    .filter((row) => row.range.rangePct <= 20)
    .sort((a, b) => b.holding.allocationPct - a.holding.allocationPct)
    .slice(0, 3);
  const sharp = rows
    .filter((row) => Math.abs(row.holding.dailyPct) >= 2)
    .sort((a, b) => Math.abs(b.holding.dailyPct) - Math.abs(a.holding.dailyPct))
    .slice(0, 3);
  const lines = [`Technical momentum scan: ${rows.length} holdings have 52-week range data.`];

  lines.push(
    strong.length
      ? `Strong positioning: ${strong.map(formatMomentumRow).join("; ")}.`
      : "Strong positioning: none above 85% of 52-week range."
  );
  lines.push(
    weak.length
      ? `Weak positioning: ${weak.map(formatMomentumRow).join("; ")}.`
      : "Weak positioning: none below 20% of 52-week range."
  );
  if (sharp.length) {
    lines.push(`Sharp daily moves: ${sharp.map(formatMomentumRow).join("; ")}.`);
  }
  lines.push(
    "Read: prioritize high-allocation names that are weak in their range or moving sharply; small allocations have lower portfolio impact."
  );

  return lines.join("\n");
};

const describeHolding = (holding, technical, intent) => {
  const lines = [];
  const range = getRangeStats(holding);
  const indicatorLine = getIndicatorLineForSymbol(technical, holding.symbol);
  const technicalLines = getTechnicalLinesForSymbol(technical, holding.symbol);
  const indicatorRequested =
    intent.wantsLiveIndicators &&
    (technical.indicators || []).some((entry) => entry.symbol === holding.symbol);

  lines.push(
    `${holding.symbol}: price Rs ${formatNumber(
      holding.currentPrice,
      2
    )}, allocation ${formatPct(holding.allocationPct)}, P&L ${formatPct(
      holding.pnlPct
    )}.`
  );

  if (range) {
    lines.push(
      `52W range Rs ${formatNumber(holding.low52, 2)} - Rs ${formatNumber(
        holding.high52,
        2
      )}: it is in the ${range.label} (${formatPct(
        range.rangePct
      )} through the range, ${formatPct(range.fromHigh)} below high).`
    );
  }

  if (holding.dailyPct) {
    lines.push(`Latest daily move: ${formatPct(holding.dailyPct)}.`);
  }

  if (holding.pe) {
    lines.push(`PE is ${formatNumber(holding.pe, 1)}.`);
  }

  if (indicatorLine) {
    lines.push(indicatorLine);
  } else if (indicatorRequested) {
    lines.push(
      "RSI/MACD: recent daily-close history is unavailable right now, so this read uses current price, 52-week range, daily move, PE, and allocation."
    );
  }

  technicalLines.forEach((line) => {
    if (!lines.some((existing) => existing.includes(line))) {
      lines.push(line);
    }
  });

  const read =
    range?.rangePct <= 20
      ? "Read: momentum is weak until it moves out of the lower range."
      : range?.rangePct >= 85
      ? "Read: momentum is strong, but the stock is close to its recent high."
      : "Read: momentum is neutral; allocation and results matter more than price location right now.";

  lines.push(read);

  return lines.slice(0, 7).join("\n");
};

const compactInsight = (insight) => {
  if (!insight) return "";
  return insight.symbol
    ? `${insight.symbol}: ${insight.detail}`
    : insight.detail;
};

const getRelevantInsights = (analysis, technical, intent) => {
  const insights = [];

  if (intent.wantsRisk || intent.wantsSummary) {
    insights.push(...(analysis.insights || []));
  }

  if (intent.wantsEvents) {
    insights.push(...(analysis.eventInsights || []));
  }

  if (intent.wantsTechnical) {
    insights.push(...(technical.signals || []));
  }

  if (!insights.length) {
    insights.push(...(analysis.insights || []), ...(analysis.eventInsights || []));
  }

  return insights.slice(0, 5);
};

const buildFallbackAnswer = ({ analysis, technical, intent }) => {
  const summary = analysis.summary || {};
  const parts = [];
  const targetHoldings = getTargetHoldings(analysis, intent);

  if (targetHoldings.length) {
    return targetHoldings
      .map((holding) => describeHolding(holding, technical, intent))
      .join("\n\n");
  }

  if (intent.wantsEvents) {
    return buildEventAnswer(analysis);
  }

  if (intent.wantsRisk) {
    const messageType = intent.wantsSummary
      ? "health"
      : "concentration";

    return messageType === "health"
      ? buildPortfolioHealthAnswer(analysis)
      : buildConcentrationAnswer(analysis);
  }

  if (intent.wantsSummary) {
    return buildPortfolioHealthAnswer(analysis);
  }

  if (intent.wantsTechnical) {
    return buildTechnicalScanAnswer(analysis);
  }

  if (intent.wantsSummary || intent.wantsRisk) {
    parts.push(
      `Portfolio value is ${formatCurrency(summary.totalValue)} with P&L ${formatCurrency(
        summary.totalPnL
      )} (${formatPct(summary.totalPnLPct)}).`
    );

    if (summary.largestHolding) {
      parts.push(
        `Largest holding is ${summary.largestHolding.symbol} at ${formatPct(
          summary.largestHolding.allocationPct
        )}; diversification looks ${String(
          summary.diversificationQuality || "moderate"
        ).toLowerCase()}.`
      );
    }

    if (summary.bestPerformer && summary.weakestHolding) {
      parts.push(
        `Best performer: ${summary.bestPerformer.symbol} (${formatPct(
          summary.bestPerformer.pnlPct
        )}). Weakest: ${summary.weakestHolding.symbol} (${formatPct(
          summary.weakestHolding.pnlPct
        )}).`
      );
    }
  }

  const relevant = getRelevantInsights(analysis, technical, intent);
  relevant.forEach((insight) => {
    const line = compactInsight(insight);
    if (line) parts.push(line);
  });

  if (!parts.length) {
    return "I need updated holdings and prices before I can analyze this portfolio.";
  }

  return parts.slice(0, 6).join("\n");
};

module.exports = {
  buildFallbackAnswer,
};
