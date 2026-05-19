import React, { useEffect, useRef, useState } from "react";
import { Bot, Loader2, Send, Sparkles, X } from "lucide-react";

const STARTER_MESSAGES = [
  {
    role: "assistant",
    text: "Portfolio snapshot ready.",
  },
];

const QUICK_PROMPTS = [
  "Portfolio health",
  "Concentration risk",
  "Event impact",
  "Technical momentum",
];

const normalizeSymbol = (value) =>
  String(value || "")
    .trim()
    .toUpperCase()
    .replace(/-E$|-GB$/i, "");

const compactSymbol = (value) =>
  normalizeSymbol(value).replace(/[^A-Z0-9]/g, "");

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

const findSymbolsInText = (text, holdings) => {
  const compactText = compactSymbol(text);
  const tokens = String(text || "")
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter((token) => token.length >= 3 && !SYMBOL_STOP_WORDS.has(token));
  const symbolTokens = String(text || "")
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter((token) => token.length >= 2 && !SYMBOL_STOP_WORDS.has(token));

  return holdings
    .map((holding) => normalizeSymbol(holding.symbol))
    .filter(Boolean)
    .filter((symbol) => {
      const compactHolding = compactSymbol(symbol);
      const exactMatch =
        compactHolding.length >= 3
          ? compactText.includes(compactHolding)
          : symbolTokens.includes(compactHolding);

      return (
        exactMatch ||
        tokens.some(
          (token) =>
            compactHolding.startsWith(token) ||
            (token.length >= 4 && compactHolding.includes(token))
        )
      );
    });
};

export default function AIChat({
  apiUrl,
  profile,
  holdings = [],
  portfolio = {},
  theme,
}) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState(STARTER_MESSAGES);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [lastSymbols, setLastSymbols] = useState([]);
  const endRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (open) {
      endRef.current?.scrollIntoView({ behavior: "smooth" });
      setTimeout(() => inputRef.current?.focus(), 80);
    }
  }, [messages, open, loading]);

  const sendMessage = async (text) => {
    const message = String(text || input).trim();
    if (!message || loading) return;

    const symbolsInMessage = findSymbolsInText(message, holdings);
    const contextSymbols = symbolsInMessage.length
      ? symbolsInMessage
      : lastSymbols;

    setMessages((prev) => [...prev, { role: "user", text: message }]);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch(`${apiUrl}/api/ai-chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(import.meta.env.VITE_API_KEY && {
            "x-api-key": import.meta.env.VITE_API_KEY,
          }),
        },
        body: JSON.stringify({
          message,
          portfolio,
          holdings,
          profile,
          context: {
            lastSymbols: contextSymbols,
          },
        }),
      });

      const json = await res.json();

      if (!res.ok || json.success === false) {
        throw new Error(json.error || "AI analysis failed");
      }

      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text: json.answer || "I could not generate an insight right now.",
          source: json.source,
        },
      ]);

      const responseSymbols = [
        ...(json.targetSymbols || []),
        ...symbolsInMessage,
      ].filter(Boolean);

      if (responseSymbols.length) {
        setLastSymbols([...new Set(responseSymbols.map(normalizeSymbol))]);
      }
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text:
            "I could not analyze the portfolio right now. Please try again after prices are updated.",
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    sendMessage();
  };

  return (
    <>
      <button
        className="ai-chat-button"
        onClick={() => setOpen((value) => !value)}
        title="AI Portfolio Analyst"
        aria-label="Open AI Portfolio Analyst"
        style={{
          background: "#2563eb",
          color: "#fff",
          border: "1px solid rgba(255,255,255,0.20)",
        }}
      >
        {open ? <X size={22} /> : <Bot size={22} />}
      </button>

      {open && (
        <section
          className="ai-chat-panel"
          style={{
            background: theme.card,
            color: theme.text,
            borderColor: theme.border,
          }}
          aria-label="AI Portfolio Analyst chat"
        >
          <header
            className="ai-chat-header"
            style={{ borderColor: theme.border }}
          >
            <div className="ai-chat-title">
              <span className="ai-chat-icon">
                <Sparkles size={16} />
              </span>
              <div>
                <strong>AI Analyst</strong>
                <span style={{ color: theme.subText }}>
                  {holdings.length} holdings
                </span>
              </div>
            </div>

            <button
              className="ai-chat-close"
              onClick={() => setOpen(false)}
              title="Close"
              aria-label="Close AI chat"
              style={{ color: theme.subText }}
            >
              <X size={18} />
            </button>
          </header>

          <div className="ai-chat-messages">
            {messages.map((message, index) => (
              <div
                key={`${message.role}-${index}`}
                className={`ai-chat-message ${message.role}`}
              >
                <div
                  className="ai-chat-bubble"
                  style={{
                    background:
                      message.role === "user"
                        ? "#2563eb"
                        : "rgba(148, 163, 184, 0.12)",
                    color: message.role === "user" ? "#fff" : theme.text,
                    borderColor:
                      message.role === "user" ? "#2563eb" : theme.border,
                  }}
                >
                  {message.text}
                </div>
              </div>
            ))}

            {loading && (
              <div className="ai-chat-message assistant">
                <div
                  className="ai-chat-bubble ai-chat-typing"
                  style={{
                    background: "rgba(148, 163, 184, 0.12)",
                    borderColor: theme.border,
                    color: theme.subText,
                  }}
                >
                  <Loader2 size={14} className="ai-chat-spinner" />
                  Analyzing
                </div>
              </div>
            )}

            <div ref={endRef} />
          </div>

          <div className="ai-chat-prompts">
            {QUICK_PROMPTS.map((prompt) => (
              <button
                key={prompt}
                type="button"
                onClick={() => sendMessage(prompt)}
                disabled={loading}
                style={{
                  borderColor: theme.border,
                  color: theme.subText,
                  background: "transparent",
                }}
              >
                {prompt}
              </button>
            ))}
          </div>

          <form
            className="ai-chat-input-row"
            onSubmit={handleSubmit}
            style={{ borderColor: theme.border }}
          >
            <input
              ref={inputRef}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Ask about this portfolio"
              disabled={loading}
              style={{
                background: theme.card,
                color: theme.text,
                borderColor: theme.border,
              }}
            />
            <button
              type="submit"
              disabled={!input.trim() || loading}
              title="Send"
              aria-label="Send message"
            >
              {loading ? (
                <Loader2 size={17} className="ai-chat-spinner" />
              ) : (
                <Send size={17} />
              )}
            </button>
          </form>
        </section>
      )}
    </>
  );
}
