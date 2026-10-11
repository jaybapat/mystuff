export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    const { topic = "general science" } = req.body || {};

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
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
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
          ]
        })
      }
    );

    const data = await response.json();

    const text =
    data.candidates[0].content.parts[0].text;

res.status(200).json(JSON.parse(text));
  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
}
