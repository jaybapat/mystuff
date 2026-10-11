
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

  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return res.status(500).json({
      error:
        "The question generator is not configured. Set GEMINI_API_KEY in Vercel environment variables."
    });
  }

  const body =
    req.body && typeof req.body === "object" ? req.body : {};

  const topic =
    typeof body.topic === "string" && body.topic.trim()
      ? body.topic.trim()
      : "general science";

  const count = body.count === undefined ? 20 : body.count;
  const difficulty =
    body.difficulty === undefined ? 5 : body.difficulty;

  if (topic.length > 200) {
    return res.status(400).json({
      error: "The course or topic must be 200 characters or fewer."
    });
  }

  if (!Number.isInteger(count) || count < 1 || count > 40) {
    return res.status(400).json({
      error: "The number of questions must be an integer from 1 to 40."
    });
  }

  if (
    !Number.isInteger(difficulty) ||
    difficulty < 1 ||
    difficulty > 10
  ) {
    return res.status(400).json({
      error: "Difficulty must be an integer from 1 to 10."
    });
  }

  const prompt = `
Create exactly ${count} original AP-style multiple-choice practice
questions for this course: "${topic}".

CONTENT AND ACCURACY:
- Use your learned knowledge of the College Board AP course
  framework and keep every question appropriate to the selected course.
- Live web research is not available in this request.
- Do not claim that you searched official websites, accessed a
  Course and Exam Description, or verified a citation.
- Prefer established course content and avoid unsupported,
  overly specific claims or invented College Board requirements.
- Write original practice questions. Do not reproduce or closely
  paraphrase protected questions from released exams or course materials.
- Include a balanced mix of relevant course topics and skills.
- Avoid duplicate questions and trivial trivia.

DIFFICULTY:
Set the overall difficulty to ${difficulty} on a scale from
1 (introductory) to 10 (very challenging).

- 1-2: Foundational understanding.
- 3-4: Straightforward application.
- 5-6: Typical AP-level application.
- 7-8: Multistep reasoning.
- 9-10: Demanding synthesis or nuanced analysis.

FOR EVERY QUESTION:
- Write one clear question.
- Include exactly four distinct answer choices.
- Include exactly one correct answer.
- Set "answer" to the zero-based index of the correct choice:
  0, 1, 2, or 3.
- Include a concise explanation of why the correct answer is right.

Return exactly ${count} questions, no more and no fewer.
`;

  try {
    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [{ text: prompt }]
            }
          ],
          generationConfig: {
            maxOutputTokens: 32768,
            responseMimeType: "application/json",
            responseSchema: {
              type: "OBJECT",
              properties: {
                questions: {
                  type: "ARRAY",
                  items: {
                    type: "OBJECT",
                    properties: {
                      question: { type: "STRING" },
                      choices: {
                        type: "ARRAY",
                        items: { type: "STRING" }
                      },
                      answer: { type: "INTEGER" },
                      explanation: { type: "STRING" }
                    },
                    required: [
                      "question",
                      "choices",
                      "answer",
                      "explanation"
                    ]
                  }
                }
              },
              required: ["questions"]
            }
          }
        })
      }
    );

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      const upstreamStatus = response.status;
      const statusCode =
        upstreamStatus === 429 ? 429 : 502;

      console.error("Gemini API error:", {
        status: upstreamStatus,
        code: data.error?.status,
        message: data.error?.message
      });

      return res.status(statusCode).json({
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
        error:
          "The AI response reached its output limit. Try generating fewer questions at once.",
        finishReason: candidate.finishReason
      });
    }

    const generatedText = candidate?.content?.parts
      ?.filter(
        (part) =>
          typeof part.text === "string" && !part.thought
      )
      .map((part) => part.text)
      .join("")
      .trim();

    if (!generatedText) {
      console.error("Gemini returned no text:", {
        finishReason: candidate?.finishReason || null,
        promptFeedback: data.promptFeedback || null
      });

      return res.status(502).json({
        error:
          "The AI service returned no questions. Please try again.",
        finishReason: candidate?.finishReason || null
      });
    }

    let result;

    try {
      result = JSON.parse(generatedText);
    } catch (error) {
      console.error(
        "Could not parse Gemini JSON:",
        error.message
      );

      return res.status(502).json({
        error:
          "The AI service returned invalid question data. Please try again."
      });
    }

    if (
      !Array.isArray(result.questions) ||
      result.questions.length !== count
    ) {
      return res.status(502).json({
        error:
          `The AI service returned an unexpected number of questions (expected ${count}).`
      });
    }

    for (
      let index = 0;
      index < result.questions.length;
      index++
    ) {
      const question = result.questions[index];

      const validQuestion =
        question &&
        typeof question.question === "string" &&
        question.question.trim().length > 0 &&
        Array.isArray(question.choices) &&
        question.choices.length === 4 &&
        question.choices.every(
          (choice) =>
            typeof choice === "string" &&
            choice.trim().length > 0
        ) &&
        new Set(
          question.choices.map((choice) =>
            choice.trim().toLocaleLowerCase()
          )
        ).size === 4 &&
        Number.isInteger(question.answer) &&
        question.answer >= 0 &&
        question.answer < 4 &&
        typeof question.explanation === "string" &&
        question.explanation.trim().length > 0;

      if (!validQuestion) {
        return res.status(502).json({
          error:
            `The AI service returned an invalid question (${index + 1}). Please try again.`
        });
      }
    }

    return res.status(200).json(result);
  } catch (error) {
    console.error("Question generation failed:", {
      name: error?.name,
      message: error?.message
    });

    return res.status(500).json({
      error:
        "The question generator encountered an unexpected error. Please try again."
    });
  }
}
