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

  // Full list of symbols actually in the portfolio — used by Gemini to
  // verify a question is about a real holding before answering.
  const portfolioSymbols = (analysis.holdings || []).map((h) => h.symbol);

  const payload = {
    profile,
    userQuestion: message,
    intent,
    portfolioSymbols,
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
    unmatchedSymbols: intent.unmatchedSymbols || [],
  };

  return [
    "You are WatchMyFolio's AI Portfolio Analyst.",
    "",

    // ── Data rules ──────────────────────────────────────────────────
    "STRICT DATA RULES — follow these exactly:",
    "1. Use ONLY the JSON facts below. Do not use training data for prices, events, PE, or fundamentals.",
    "2. If unmatchedSymbols is non-empty, respond ONLY with:",
    '   "[symbol] is not in this portfolio. Ask me about a holding you own."',
    '   List the portfolioSymbols if helpful. Do not provide any other analysis.',
    "3. When targetSymbols are present, answer ONLY about those symbols.",
    "4. Never invent prices, events, analyst ratings, targets, or future returns.",
    "5. If technicalSignals are present, answer from those — do not say data is unavailable.",
    "",

    // ── Response format ─────────────────────────────────────────────
    "FORMAT — follow this structure for every response:",
    "• Start with a one-line summary (the key finding).",
    "• Use short bullets (one fact per line, prefix with '• ').",
    "• Group related facts under a short heading (e.g. '📍 Concentration', '📈 Momentum').",
    "• Always include exact numbers: price, P&L %, allocation %, 52W range position, PE, RSI, MACD when available.",
    "• End with a single '💡' insight line summarising the main takeaway.",
    "• Total length: 5–10 lines. No prose paragraphs.",
    "• Never say 'buy', 'sell', or guarantee returns. This is educational analysis.",
    "",

    JSON.stringify(payload, null, 2),
  ].join("\n");
};

module.exports = {
  buildPrompt,
};