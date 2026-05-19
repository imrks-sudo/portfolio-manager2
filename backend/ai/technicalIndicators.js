const yahooFinance = require("yahoo-finance2").default;
const {
  BollingerBands,
  EMA,
  MACD,
  RSI,
  SMA,
} = require("technicalindicators");
const { normalize } = require("./intentParser");

const number = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const round = (value, digits = 2) => Number(number(value).toFixed(digits));

const isStockLike = (holding = {}) => holding.assetType === "Stock";

const toYahooSymbol = (symbol) => {
  const clean = normalize(symbol);
  if (!clean) return "";
  if (clean.includes(".")) return clean;
  return `${clean}.NS`;
};

const getClosePrices = async (symbol) => {
  const period1 = new Date();
  period1.setMonth(period1.getMonth() - 8);

  const result = await yahooFinance.chart(toYahooSymbol(symbol), {
    period1,
    interval: "1d",
  });

  return (result?.quotes || [])
    .map((quote) => number(quote.close))
    .filter((price) => price > 0);
};

const latest = (values) => values[values.length - 1];

const calculateIndicators = (closes = []) => {
  if (closes.length < 35) {
    return {
      hasData: false,
      reason: "At least 35 daily closes are needed for RSI, MACD, and Bollinger Bands.",
    };
  }

  const rsi = RSI.calculate({ values: closes, period: 14 });
  const sma20 = SMA.calculate({ values: closes, period: 20 });
  const ema20 = EMA.calculate({ values: closes, period: 20 });
  const macd = MACD.calculate({
    values: closes,
    fastPeriod: 12,
    slowPeriod: 26,
    signalPeriod: 9,
    SimpleMAOscillator: false,
    SimpleMASignal: false,
  });
  const bands = BollingerBands.calculate({
    values: closes,
    period: 20,
    stdDev: 2,
  });

  const price = latest(closes);
  const lastBand = latest(bands);
  const lastMacd = latest(macd);
  const returns = closes
    .slice(1)
    .map((priceAtIndex, index) =>
      closes[index] > 0 ? (priceAtIndex - closes[index]) / closes[index] : 0
    );
  const averageReturn =
    returns.reduce((sum, value) => sum + value, 0) / Math.max(returns.length, 1);
  const variance =
    returns.reduce((sum, value) => sum + Math.pow(value - averageReturn, 2), 0) /
    Math.max(returns.length, 1);
  const volatility = Math.sqrt(variance) * Math.sqrt(252) * 100;

  return {
    hasData: true,
    price: round(price),
    rsi14: round(latest(rsi)),
    sma20: round(latest(sma20)),
    ema20: round(latest(ema20)),
    macd: {
      line: round(lastMacd?.MACD),
      signal: round(lastMacd?.signal),
      histogram: round(lastMacd?.histogram),
    },
    bollinger: {
      upper: round(lastBand?.upper),
      middle: round(lastBand?.middle),
      lower: round(lastBand?.lower),
    },
    volatility: round(volatility, 1),
  };
};

const getIndicatorSignals = (symbol, indicators) => {
  if (!indicators.hasData) {
    return [
      {
        type: "technical",
        severity: "low",
        symbol,
        title: `${symbol}: technical data unavailable`,
        detail: indicators.reason,
      },
    ];
  }

  const signals = [];
  const priceAboveSma = indicators.price > indicators.sma20;
  const priceAboveEma = indicators.price > indicators.ema20;

  if (indicators.rsi14 >= 70) {
    signals.push({
      type: "technical",
      severity: "medium",
      symbol,
      title: `${symbol} looks overbought on RSI`,
      detail: `RSI is ${indicators.rsi14}. Momentum is strong, but pullback risk is higher.`,
    });
  } else if (indicators.rsi14 <= 30) {
    signals.push({
      type: "technical",
      severity: "medium",
      symbol,
      title: `${symbol} looks oversold on RSI`,
      detail: `RSI is ${indicators.rsi14}. Weakness is stretched, but reversal is not guaranteed.`,
    });
  } else {
    signals.push({
      type: "technical",
      severity: "low",
      symbol,
      title: `${symbol} RSI is neutral`,
      detail: `RSI is ${indicators.rsi14}, which is neither overbought nor oversold.`,
    });
  }

  signals.push({
    type: "technical",
    severity: priceAboveSma && priceAboveEma ? "low" : "medium",
    symbol,
    title: `${symbol} trend is ${
      priceAboveSma && priceAboveEma ? "constructive" : "soft"
    }`,
    detail: `Price is ${priceAboveSma ? "above" : "below"} SMA20 and ${
      priceAboveEma ? "above" : "below"
    } EMA20.`,
  });

  if (indicators.macd.histogram > 0) {
    signals.push({
      type: "technical",
      severity: "low",
      symbol,
      title: `${symbol} MACD momentum is positive`,
      detail: `MACD histogram is ${indicators.macd.histogram}, indicating improving short-term momentum.`,
    });
  } else if (indicators.macd.histogram < 0) {
    signals.push({
      type: "technical",
      severity: "medium",
      symbol,
      title: `${symbol} MACD momentum is negative`,
      detail: `MACD histogram is ${indicators.macd.histogram}, indicating weaker short-term momentum.`,
    });
  }

  if (indicators.price >= indicators.bollinger.upper) {
    signals.push({
      type: "technical",
      severity: "medium",
      symbol,
      title: `${symbol} is near the upper Bollinger Band`,
      detail: "Price is stretched relative to its recent range.",
    });
  } else if (indicators.price <= indicators.bollinger.lower) {
    signals.push({
      type: "technical",
      severity: "medium",
      symbol,
      title: `${symbol} is near the lower Bollinger Band`,
      detail: "Price is weak relative to its recent range.",
    });
  }

  return signals;
};

const getLocalTechnicalSignals = (holding) => {
  const signals = [];
  const symbol = holding.symbol;
  const price = number(holding.currentPrice);
  const high52 = number(holding.high52);
  const low52 = number(holding.low52);
  const dailyPct = number(holding.dailyPct);
  const pe = number(holding.pe);

  if (!price) {
    return [
      {
        type: "technical",
        severity: "low",
        symbol,
        title: `${symbol}: update price first`,
        detail:
          "Current price is missing, so momentum and range analysis are limited.",
      },
    ];
  }

  if (high52 > low52) {
    const rangePosition = ((price - low52) / (high52 - low52)) * 100;
    const fromHigh = high52 > 0 ? ((high52 - price) / high52) * 100 : 0;

    if (rangePosition >= 85) {
      signals.push({
        type: "technical",
        severity: "medium",
        symbol,
        title: `${symbol} has strong price positioning`,
        detail: `It trades in the upper part of its 52-week range, about ${round(
          fromHigh,
          1
        )}% below its 52-week high.`,
      });
    } else if (rangePosition <= 20) {
      signals.push({
        type: "technical",
        severity: "medium",
        symbol,
        title: `${symbol} is weak in its 52-week range`,
        detail: `It trades near the lower part of its 52-week range, so momentum is soft.`,
      });
    } else {
      signals.push({
        type: "technical",
        severity: "low",
        symbol,
        title: `${symbol} is mid-range`,
        detail: `It is around ${round(
          rangePosition,
          1
        )}% through its 52-week range, so price positioning is neutral.`,
      });
    }
  }

  if (Math.abs(dailyPct) >= 2) {
    signals.push({
      type: "technical",
      severity: Math.abs(dailyPct) >= 5 ? "medium" : "low",
      symbol,
      title: `${symbol} has a ${dailyPct >= 0 ? "positive" : "negative"} daily move`,
      detail: `Latest daily move is ${round(
        dailyPct,
        2
      )}%, which can affect short-term momentum.`,
    });
  }

  if (pe >= 50) {
    signals.push({
      type: "technical",
      severity: "medium",
      symbol,
      title: `${symbol} valuation is stretched`,
      detail: `PE is ${round(pe, 1)}. Strong momentum needs earnings support at this valuation.`,
    });
  } else if (pe > 0 && pe <= 15) {
    signals.push({
      type: "technical",
      severity: "low",
      symbol,
      title: `${symbol} valuation is lower`,
      detail: `PE is ${round(pe, 1)}. Check whether the lower valuation reflects value or weaker growth.`,
    });
  }

  if (holding.allocationPct >= 10) {
    signals.push({
      type: "technical",
      severity: holding.allocationPct >= 20 ? "high" : "medium",
      symbol,
      title: `${symbol} also has allocation risk`,
      detail: `It is ${round(
        holding.allocationPct,
        1
      )}% of the portfolio, so price swings matter more to total returns.`,
    });
  }

  if (!signals.length) {
    signals.push({
      type: "technical",
      severity: "low",
      symbol,
      title: `${symbol} has no strong local momentum signal`,
      detail:
        "Based on current price, daily move, and available range data, no major technical warning stands out.",
    });
  }

  return signals.slice(0, 4);
};

const selectTechnicalHoldings = (analysis, intent) => {
  const holdings = (analysis.holdings || []).filter(isStockLike);
  const mentioned = new Set(intent.mentionedSymbols || []);

  if (mentioned.size) {
    return holdings
      .filter((holding) => mentioned.has(holding.symbol))
      .slice(0, 5);
  }

  return [...holdings]
    .sort((a, b) => b.allocationPct - a.allocationPct)
    .slice(0, 4);
};

const getTechnicalAnalysis = async (analysis, intent) => {const selected = selectTechnicalHoldings(
  analysis,
  intent
);

const shouldFetchLiveIndicators =
  intent.wantsLiveIndicators === true;

if (!selected.length) {
  return {
    indicators: [],
    signals: [
      {
        type: "technical",
        severity: "low",
        title: "No stock holdings selected",
        detail:
          "Technical indicators are only computed for stock holdings.",
      },
    ],
  };
}

// ✅ Fast path when live indicators are not needed
if (!shouldFetchLiveIndicators) {

  const results = selected.map((holding) => {

    const localSignals =
      getLocalTechnicalSignals(holding);

    return {
      symbol: holding.symbol,
      indicators: {
        hasData: false,
        reason:
          "Using current portfolio data instead of live historical indicators.",
      },
      signals: localSignals,
    };
  });

  return {
    indicators: results.map(
      ({ symbol, indicators }) => ({
        symbol,
        indicators,
      })
    ),

    signals: results
      .flatMap((result) => result.signals)
      .slice(0, 12),
  };
}

// ✅ Parallel Yahoo Finance fetches
const results = await Promise.allSettled(

  selected.map(async (holding) => {

    const localSignals =
      getLocalTechnicalSignals(holding);

    try {

      const closes = await getClosePrices(
        holding.symbol
      );

      const indicators =
        calculateIndicators(closes);

      return {
        symbol: holding.symbol,

        indicators,

        signals: [
          ...getIndicatorSignals(
            holding.symbol,
            indicators
          ),

          ...localSignals,

        ].slice(0, 5),
      };

    } catch (error) {

      return {
        symbol: holding.symbol,

        indicators: {
          hasData: false,
          reason:
            "Live historical indicators are unavailable right now, so current portfolio data was used.",
        },

        signals: localSignals,
      };
    }
  })
);

const resolvedResults = results
  .filter(
    (result) =>
      result.status === "fulfilled"
  )
  .map((result) => result.value);

return {
  indicators: resolvedResults.map(
    ({ symbol, indicators }) => ({
      symbol,
      indicators,
    })
  ),

  signals: resolvedResults
    .flatMap((result) => result.signals)
    .slice(0, 12),
};
};

module.exports = {
  getTechnicalAnalysis,
  calculateIndicators,
};
