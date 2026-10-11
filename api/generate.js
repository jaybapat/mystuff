export default async function handler(req, res) {
  try {
    const { topic = "general science" } = req.body || {};

    const prompt = `
Generate 5 multiple-choice questions about ${topic}.

Return ONLY valid JSON in this format:

{
  "questions": [
    {
      "question": "...",
      "choices": ["A", "B", "C", "D"],
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
          ]
        })
      }
    );

    const data = await response.json();

    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
}
