const axios = require("axios");

const getApiKey = () =>
  process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY || "";

const getModel = () => process.env.GEMINI_MODEL || "gemini-2.5-flash";

const formatWithGemini = async (prompt) => {
  const apiKey = getApiKey();

  if (!apiKey) return null;

  try {
    const model = getModel();
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

    const response = await axios.post(
      url,
      {
        contents: [
          {
            role: "user",
            parts: [{ text: prompt }],
          },
        ],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 900,
        },
      },
      {
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        timeout: 10000,
      }
    );

    return (
      response.data?.candidates?.[0]?.content?.parts
        ?.map((part) => part.text)
        .filter(Boolean)
        .join("\n")
        .trim() || null
    );
  } catch (error) {
    console.error("Gemini formatting failed:", error.message);
    return null;
  }
};

module.exports = {
  formatWithGemini,
};
