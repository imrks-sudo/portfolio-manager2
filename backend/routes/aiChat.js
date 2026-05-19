const express = require("express");
const { parseIntent } = require("../ai/intentParser");
const { analyzePortfolio } = require("../ai/portfolioAnalysis");
const { getTechnicalAnalysis } = require("../ai/technicalIndicators");
const { buildPrompt } = require("../ai/promptBuilder");
const { formatWithGemini } = require("../ai/geminiClient");
const { buildFallbackAnswer } = require("../ai/responseBuilder");

const MAX_HOLDINGS = 250;
const MAX_MESSAGE_LENGTH = 1000;

const createAiChatRouter = ({ getEvents } = {}) => {
  const router = express.Router();

  router.post("/api/ai-chat", async (req, res) => {
     const key = req.headers["x-api-key"];

  if (
    process.env.API_KEY &&
    key !== process.env.API_KEY
  ) {
    return res.status(401).json({
      success: false,
      error: "Unauthorized",
    });
  }
    try {
      const message = String(req.body?.message || "").trim();

      const holdings = Array.isArray(req.body?.holdings)
        ? req.body.holdings.slice(0, MAX_HOLDINGS)
        : [];

      const portfolio = req.body?.portfolio || {};

      const profile = String(
        req.body?.profile || "default"
      ).slice(0, 80);

      const context = req.body?.context || {};

      if (!message) {
        return res.status(400).json({
          success: false,
          error: "Message is required",
        });
      }

      if (message.length > MAX_MESSAGE_LENGTH) {
        return res.status(400).json({
          success: false,
          error: "Message is too long",
        });
      }

      if (!holdings.length) {
        return res.json({
          success: true,
          source: "rules",
          answer:
            "Add holdings and update prices first. Then I can analyze allocation, risk, events, and momentum.",
          insights: [],
        });
      }

      const eventsCache =
        typeof getEvents === "function"
          ? getEvents()
          : { active: [], archive: [] };

      const intent = parseIntent(
        message,
        holdings,
        context
      );

      const analysis = analyzePortfolio({
        holdings,
        portfolio,
        eventsCache,
      });

      const technical = intent.wantsTechnical
        ? await getTechnicalAnalysis(
            analysis,
            intent
          )
        : {
            indicators: [],
            signals: [],
          };

      const fallbackAnswer =
        buildFallbackAnswer({
          analysis,
          technical,
          intent,
        });

      const prompt = buildPrompt({
        message,
        profile,
        analysis,
        technical,
        intent,
      });

      const formattedAnswer =
        await formatWithGemini(prompt);

      res.json({
        success: true,
        source: formattedAnswer
          ? "gemini"
          : "rules",
        answer:
          formattedAnswer || fallbackAnswer,
        targetSymbols:
          intent.mentionedSymbols || [],
        insights: analysis.insights,
        events: analysis.eventInsights,
        technical: technical.signals,
      });

    } catch (error) {

      console.error(
        "/api/ai-chat failed:",
        error
      );

      res.status(500).json({
        success: false,
        error: "AI analysis failed",
      });
    }
  });

  return router;
};

module.exports = createAiChatRouter;
