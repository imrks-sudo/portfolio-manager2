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

// Words that are part of chatbot commands / indicator names — not stock symbols
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
  "SUMMARY",
  "OVERVIEW",
  "IMPACT",
  "SCAN",
]);

// Common English words that can appear as all-caps tokens in messages
// but are not stock symbols. Covers 3–8 char words that would otherwise
// look like a ticker to the symbol matcher.
const COMMON_ENGLISH_WORDS = new Set([
  "THE", "AND", "FOR", "NOT", "BUT", "ARE", "CAN", "DID", "GET",
  "GOT", "HAS", "HAD", "ITS", "LET", "MAY", "NOW", "ONE", "OUR",
  "OUT", "PUT", "RUN", "SET", "TOO", "TWO", "USE", "WAS", "WHO",
  "YOU", "ALL", "ANY", "DAY", "OLD", "OWN", "SEE", "WAY", "YET",
  "HOW", "WHY", "WHAT", "WHEN", "WITH", "YOUR", "ALSO", "HAVE",
  "JUST", "LIKE", "MORE", "MUCH", "ONLY", "OVER", "SOME", "THAN",
  "THAT", "THEM", "THEN", "THEY", "THIS", "TIME", "VERY", "WERE",
  "WILL", "BEST", "GOOD", "SHOW", "TELL", "DOES", "GIVE", "FIND",
  "NEED", "KNOW", "HELP", "MEAN", "BOTH", "EACH", "SUCH", "INTO",
  "EVEN", "BACK", "NEXT", "LAST", "LONG", "DOWN", "LESS", "OPEN",
  "KEEP", "YEAR", "WEEK", "SAME", "STOP", "NEAR", "TAKE", "PLAN",
  "REAL", "MOST", "MANY", "SLOW", "FAST", "HIGH", "WEAK", "LOOK",
  "MOVE", "COME", "SAID", "WELL", "BEEN", "FROM", "ABOUT", "WOULD",
  "COULD", "THERE", "THEIR", "WHICH", "AFTER", "FIRST", "LARGE",
  "LOWER", "MIGHT", "OTHER", "PRICE", "RIGHT", "SINCE", "STILL",
  "THESE", "THOSE", "UNDER", "UPPER", "WHERE", "WHILE", "BEING",
  "BELOW", "DOING", "SMALL", "TOTAL", "RANGE", "SHARE", "VALUE",
  "BASED", "DAILY", "SHARP", "RATE", "SIGN", "SIDE", "TERM",
  "WAIT", "WANT", "WORK", "SOLD", "SELL", "HOLD", "CASH", "DEBT",
  "BOND", "GOLD", "NIFTY", "INDEX", "STOCK", "FUND", "SECTOR",
  "MARKET", "GAINERS", "LOSERS", "RETURNS", "GROWTH", "DIRECT",
  "SCAN", "IMPACT", "SHOW", "VIEW", "LIST", "GIVE", "FULL",
"QUICK", "BRIEF", "DEEP", "BROAD", "LATEST", "RECENT",
"TODAY", "CURRENT", "OVERALL", "GENERAL", "ACROSS",
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

/**
 * Finds tokens in the user message that look like stock/fund symbols
 * but don't match any holding in the portfolio.
 *
 * Used to detect when the user asks about a symbol they don't own,
 * so we can respond "X is not in your portfolio" instead of giving
 * a misleading portfolio-wide answer.
 */
const getUnmatchedSymbols = (message, holdings) => {
  const compactHoldings = new Set(
    holdings.map((h) => compact(normalize(h.symbol)))
  );

  return message
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter((token) => {
      if (token.length < 2 || token.length > 12) return false;
      if (!/^[A-Z]/.test(token)) return false; // must start with a letter
      if (SYMBOL_STOP_WORDS.has(token)) return false;
      if (COMMON_ENGLISH_WORDS.has(token)) return false;
      if (compactHoldings.has(compact(token))) return false; // already matched
      return true;
    })
    .slice(0, 3); // cap at 3 candidates
};

const parseIntent = (message = "", holdings = [], context = {}) => {
  const safeMessage = String(message || "").toLowerCase();
  const explicitSymbols = getExplicitSymbols(message, holdings);

  // FIX: wantsTechnical should only be true for actual technical keyword queries.
  // Previously it was forced true whenever any symbol was mentioned, which caused
  // every holding-specific question to trigger the full technical pipeline.
  const wantsTechnical = messageHas(safeMessage, TECHNICAL_WORDS);
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

  // Detect symbol-like tokens that the user mentioned but aren't in the portfolio.
  // Only populated when no portfolio holding was matched — this guards against
  // giving a misleading portfolio-wide answer when the user asks about ZOMATO,
  // PAYTM, or any other stock they don't own.
  const profileName = String(context.profile || "").toUpperCase().trim();

const unmatchedSymbols =
  explicitSymbols.length === 0
    ? getUnmatchedSymbols(message, holdings).filter(
        (token) => token !== profileName
      )
    : [];

  return {
    wantsTechnical,
    wantsLiveIndicators,
    wantsEvents,
    wantsRisk,
    wantsSummary,
    mentionedSymbols,
    unmatchedSymbols,
  };
};

module.exports = {
  parseIntent,
  normalize,
};