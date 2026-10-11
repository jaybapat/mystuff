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
    const count = req.body?.count === undefined ? 20 : req.body.count;
    const difficulty = req.body?.difficulty === undefined ? 5 : req.body.difficulty;

    if (!Number.isInteger(count) || count < 1 || count > 40) {
      return res.status(400).json({ error: "The number of questions must be an integer from 1 to 40." });
    }

    if (!Number.isInteger(difficulty) || difficulty < 1 || difficulty > 10) {
      return res.status(400).json({ error: "Difficulty must be an integer from 1 to 10." });
    }

    const prompt = `
Create exactly ${count} original AP-style multiple-choice questions for the course: "${topic}".

Research and source the questions from official College Board information before drafting:
- Search for the course's official AP course page and Course and Exam Description (CED) on apcentral.collegeboard.org or apstudents.collegeboard.org.
- Use the course framework, topic outline, learning objectives, and exam guidance on those official pages to select accurate, in-scope content.
- Prefer College Board sources over third-party study sites. Do not invent College Board topics or claim unsupported details.
- Write original practice questions; do not reproduce or closely paraphrase protected questions from released exams or course materials.

Requirements:
- Keep every question appropriate to the selected AP course and grounded in its College Board framework.
- Set the overall difficulty to ${difficulty} on a scale from 1 (introductory) to 10 (very challenging).
- Calibrate difficulty consistently: 1–2 tests foundational understanding, 3–4 requires a straightforward application, 5–6 reflects typical AP-level application, 7–8 requires multistep reasoning, and 9–10 requires demanding synthesis or nuanced analysis.
- Include a balanced mix of relevant course topics and skills; avoid duplicate questions and unsupported or trivial trivia.
- Every question must have exactly four distinct answer choices and exactly one correct answer.
- Include a concise explanation of why the correct answer is right.
- Return exactly ${count} questions, no more and no fewer.

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
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${process.env.GEMINI_API_KEY}`,
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
          tools: [{ google_search: {} }],
          generationConfig: {
            maxOutputTokens: 16384
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

    if (!Array.isArray(result.questions) || result.questions.length !== count) {
      return res.status(502).json({
        error: `The AI service returned an unexpected number of questions (expected ${count}).`
      });
    }

    return res.status(200).json(result);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
