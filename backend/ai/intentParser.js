const normalize = (value) =>
  String(value || "")
    .trim()
    .toUpperCase()
    .replace(/-E$|-GB$/i, "");

const compact = (value) => normalize(value).replace(/[^A-Z0-9]/g, "");

const TECHNICAL_WORDS = [
  "rsi",
  "sma",
  "ema",
  "macd",
  "bollinger",
  "momentum",
  "trend",
  "technical",
  "overbought",
  "oversold",
  "moving average",
];

const LIVE_INDICATOR_WORDS = [
  "rsi",
  "sma",
  "ema",
  "macd",
  "bollinger",
  "moving average",
];

const EVENT_WORDS = [
  "event",
  "dividend",
  "record date",
  "board meeting",
  "result",
  "announcement",
  "corporate",
];

const RISK_WORDS = [
  "risk",
  "health",
  "concentration",
  "diversification",
  "allocation",
  "exposure",
  "loss",
  "drawdown",
  "sector",
];

const SUMMARY_WORDS = [
  "summary",
  "overview",
  "portfolio",
  "best",
  "weakest",
  "performer",
  "insight",
];

const messageHas = (message, words) =>
  words.some((word) => message.includes(word));

const SYMBOL_STOP_WORDS = new Set([
  "ANALYZE",
  "ANALYSIS",
  "BASED",
  "BOLLINGER",
  "CONCENTRATION",
  "EVENT",
  "HEALTH",
  "INDICATOR",
  "INDICATORS",
  "MACD",
  "MOMENTUM",
  "PORTFOLIO",
  "RISK",
  "RSI",
  "SMA",
  "EMA",
  "TECHNICAL",
  "TREND",
]);

const getExplicitSymbols = (message, holdings = []) => {
  const upperMessage = message.toUpperCase();
  const compactMessage = compact(message);
  const tokens = upperMessage
    .split(/[^A-Z0-9]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !SYMBOL_STOP_WORDS.has(token));
  const symbolTokens = upperMessage
    .split(/[^A-Z0-9]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && !SYMBOL_STOP_WORDS.has(token));

  const matches = holdings
    .map((holding) => {
      const symbol = normalize(holding.symbol);
      const compactSymbol = compact(symbol);
      const exactMatch =
        compactSymbol.length >= 3
          ? compactMessage.includes(compactSymbol)
          : symbolTokens.includes(compactSymbol);
      const prefixMatch = tokens.some(
        (token) =>
          compactSymbol.startsWith(token) ||
          (token.length >= 4 && compactSymbol.includes(token))
      );

      return {
        symbol,
        score: exactMatch ? 100 : prefixMatch ? 50 : 0,
      };
    })
    .filter((match) => match.symbol && match.score > 0)
    .sort((a, b) => b.score - a.score);

  if (matches.length) {
    const bestScore = matches[0].score;
    return matches
      .filter((match) => match.score === bestScore)
      .map((match) => match.symbol);
  }

  return [];
};

const getContextSymbols = (holdings = [], context = {}) => {
  const contextSymbols = Array.isArray(context.lastSymbols)
    ? context.lastSymbols
    : [];

  return contextSymbols
    .map(normalize)
    .filter((symbol) =>
      holdings.some((holding) => normalize(holding.symbol) === symbol)
    );
};

const parseIntent = (message = "", holdings = [], context = {}) => {
  const safeMessage = String(message || "").toLowerCase();
  const explicitSymbols = getExplicitSymbols(message, holdings);

  const wantsTechnical =
  messageHas(safeMessage, TECHNICAL_WORDS);
  const wantsLiveIndicators = messageHas(safeMessage, LIVE_INDICATOR_WORDS);
  const wantsEvents = messageHas(safeMessage, EVENT_WORDS);
  const wantsRisk = messageHas(safeMessage, RISK_WORDS);
  const wantsSummary =
    messageHas(safeMessage, SUMMARY_WORDS) ||
    (!wantsTechnical && !wantsEvents && !wantsRisk);
  const shouldUseContext =
    explicitSymbols.length === 0 &&
    wantsLiveIndicators &&
    !wantsRisk &&
    !wantsEvents &&
    !wantsSummary;
  const mentionedSymbols = shouldUseContext
    ? getContextSymbols(holdings, context)
    : explicitSymbols;

  return {
    wantsTechnical,
    wantsLiveIndicators,
    wantsEvents,
    wantsRisk,
    wantsSummary,
    mentionedSymbols,
  };
};

module.exports = {
  parseIntent,
  normalize,
};
