const MODELS = new Set([
  "gemini-3.1-flash-lite",
  "gemini-3.5-flash-lite",
  "antigravity"
]);

const MAX_MESSAGE_LENGTH = 5000;
const MAX_MEMORY_ITEMS = 30;
const MAX_MEMORY_ITEM_LENGTH = 500;
const MAX_HISTORY_ITEMS = 30;

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.setHeader("Allow", "POST, OPTIONS");
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST, OPTIONS");
    return res.status(405).json({ error: "Method not allowed." });
  }

  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return res.status(500).json({
      error: "The AI chat is not configured. Set GEMINI_API_KEY in Vercel environment variables."
    });
  }

  const body = req.body && typeof req.body === "object" ? req.body : {};
  const { model, message, history, memory } = body;

  if (typeof model !== "string" || !MODELS.has(model)) {
    return res.status(400).json({ error: "Choose a supported model." });
  }

  if (
    typeof message !== "string" ||
    !message.trim() ||
    message.length > MAX_MESSAGE_LENGTH
  ) {
    return res.status(400).json({
      error: `Your message must be between 1 and ${MAX_MESSAGE_LENGTH} characters.`
    });
  }

  if (
    !Array.isArray(history) ||
    history.length > MAX_HISTORY_ITEMS ||
    !history.every(
      (item) =>
        item &&
        (item.role === "user" || item.role === "model") &&
        typeof item.text === "string" &&
        item.text.length <= MAX_MESSAGE_LENGTH
    )
  ) {
    return res.status(400).json({ error: "Chat history is invalid." });
  }

  if (
    !Array.isArray(memory) ||
    memory.length > MAX_MEMORY_ITEMS ||
    !memory.every(
      (item) =>
        typeof item === "string" &&
        item.trim() &&
        item.length <= MAX_MEMORY_ITEM_LENGTH
    )
  ) {
    return res.status(400).json({ error: "Saved memory is invalid." });
  }

  const contents = [
    ...history.map(({ role, text }) => ({
      role,
      parts: [{ text }]
    })),
    { role: "user", parts: [{ text: message.trim() }] }
  ];

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{
              text: `You are a helpful chat assistant. Use the saved memory when it is relevant.

Return JSON with exactly two fields:
- "reply": your natural, helpful answer to the latest message.
- "memory": an array of concise facts or preferences worth remembering in future chats.

Preserve existing memory items unless the user corrects or asks to forget them. Add only stable, useful information the user explicitly shares or clearly asks you to remember. Do not infer or store sensitive personal information. If the user asks to forget something, remove the matching item. Keep at most ${MAX_MEMORY_ITEMS} items. Existing memory:
${JSON.stringify(memory)}`
            }]
          },
          contents,
          generationConfig: {
            maxOutputTokens: 4096,
            responseMimeType: "application/json",
            responseSchema: {
              type: "OBJECT",
              properties: {
                reply: { type: "STRING" },
                memory: {
                  type: "ARRAY",
                  items: { type: "STRING" }
                }
              },
              required: ["reply", "memory"]
            }
          }
        })
      }
    );

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      const upstreamStatus = response.status;
      console.error("AI chat API error:", {
        model,
        status: upstreamStatus,
        code: data.error?.status,
        message: data.error?.message
      });

      return res.status(upstreamStatus === 429 ? 429 : 502).json({
        error:
          data.error?.message ||
          `The AI service returned status ${upstreamStatus}.`,
        upstreamStatus,
        code: data.error?.status || null
      });
    }

    const candidate = data.candidates?.[0];

    if (candidate?.finishReason === "MAX_TOKENS") {
      return res.status(502).json({
        error: "The AI response reached its output limit. Please try a shorter message."
      });
    }

    const generatedText = candidate?.content?.parts
      ?.filter((part) => typeof part.text === "string" && !part.thought)
      .map((part) => part.text)
      .join("")
      .trim();

    if (!generatedText) {
      console.error("AI chat returned no text:", {
        model,
        finishReason: candidate?.finishReason || null,
        promptFeedback: data.promptFeedback || null
      });
      return res.status(502).json({
        error: "The AI service returned no response. Please try again."
      });
    }

    let result;
    try {
      result = JSON.parse(generatedText);
    } catch (error) {
      console.error("Could not parse AI chat JSON:", error.message);
      return res.status(502).json({
        error: "The AI service returned an invalid response. Please try again."
      });
    }

    if (
      typeof result.reply !== "string" ||
      !result.reply.trim() ||
      !Array.isArray(result.memory) ||
      result.memory.length > MAX_MEMORY_ITEMS ||
      !result.memory.every(
        (item) =>
          typeof item === "string" &&
          item.trim() &&
          item.length <= MAX_MEMORY_ITEM_LENGTH
      )
    ) {
      return res.status(502).json({
        error: "The AI service returned an invalid response. Please try again."
      });
    }

    return res.status(200).json({
      reply: result.reply.trim(),
      memory: result.memory.map((item) => item.trim())
    });
  } catch (error) {
    console.error("AI chat request failed:", {
      model,
      name: error?.name,
      message: error?.message
    });
    return res.status(500).json({
      error: "The AI chat encountered an unexpected error. Please try again."
    });
  }
}
