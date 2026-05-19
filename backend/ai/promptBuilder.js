const toCompactHolding = (holding) => ({
  symbol: holding.symbol,
  assetType: holding.assetType,
  sector: holding.sector,
  allocationPct: Number(holding.allocationPct || 0).toFixed(1),
  pnlPct: Number(holding.pnlPct || 0).toFixed(1),
  pe: holding.pe || null,
});

const buildPrompt = ({ message, profile, analysis, technical, intent }) => {
  const usableIndicators = (technical.indicators || []).filter(
    (item) => item.indicators?.hasData
  );

  const payload = {
    profile,
    userQuestion: message,
    intent,
    portfolioSummary: analysis.summary,
    topHoldings: (analysis.holdings || [])
      .slice()
      .sort((a, b) => b.allocationPct - a.allocationPct)
      .slice(0, 10)
      .map(toCompactHolding),
    portfolioInsights: analysis.insights || [],
    eventInsights: analysis.eventInsights || [],
    technicalSignals: technical.signals || [],
    technicalIndicators: usableIndicators,
    targetSymbols: intent.mentionedSymbols || [],
  };

  return [
    "You are WatchMyFolio's AI Portfolio Analyst.",
    "Use only the JSON facts below. Do not invent prices, events, ratings, targets, or future returns.",
    "This is educational portfolio analysis, not financial advice.",
    "Keep the answer concise: 3 to 6 short bullets or sentences.",
    "When targetSymbols are present, answer only about those symbols.",
    "Include exact numbers from the facts: price, allocation percentage, P&L percentage, 52-week range position, PE, RSI, MACD, or daily move when available.",
    "Prefer direct, factual wording. Mention concentration, valuation, momentum, diversification, and event impact only when present in the facts.",
    "Never guarantee returns or tell the user to buy/sell.",
    "If technicalSignals are present, answer from those signals instead of saying market data is unavailable.",
    "",
    JSON.stringify(payload, null, 2),
  ].join("\n");
};

module.exports = {
  buildPrompt,
};
