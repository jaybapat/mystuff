export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST, OPTIONS");
    return res.status(405).json({ error: "Method not allowed." });
  }

  if (!process.env.GEMINI_API_KEY) {
    return res.status(500).json({ error: "The question generator is not configured." });
  }

  try {
    const topic =
      typeof req.body?.topic === "string" && req.body.topic.trim()
        ? req.body.topic.trim()
        : "general science";

    const prompt = `
Generate 10 high-quality AP exam style multiple-choice questions for ${topic}.

Requirements:
- Appropriate for AP students
- Four answer choices
- Exactly one correct answer
- Mix conceptual and factual questions
- Avoid trivial memorization
- Include a brief explanation

Return ONLY valid JSON in this exact format:

{
  "questions": [
    {
      "question": "...",
      "choices": [
        "Answer A",
        "Answer B",
        "Answer C",
        "Answer D"
      ],
      "answer": 0,
      "explanation": "..."
    }
  ]
}
`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: prompt
                }
              ]
            }
          ],
          generationConfig: {
            responseMimeType: "application/json"
          }
        })
      }
    );

    const data = await response.json();
    if (!response.ok) {
      return res.status(502).json({
        error: data.error?.message || `The AI service returned status ${response.status}.`
      });
    }

    const text = data.candidates?.[0]?.content?.parts
      ?.map((part) => part.text || "")
      .join("")
      .trim();
    if (!text) {
      return res.status(502).json({ error: "The AI service returned no questions." });
    }

    let result;
    try {
      result = JSON.parse(text);
    } catch {
      return res.status(502).json({ error: "The AI service returned invalid question data." });
    }

    if (!Array.isArray(result.questions) || result.questions.length === 0) {
      return res.status(502).json({ error: "The AI service returned no questions." });
    }

    return res.status(200).json(result);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
