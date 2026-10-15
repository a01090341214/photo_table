export default async function handler(req, res) {
  // CORS 헤더 설정
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST 요청만 지원합니다." });
  }

  try {
    const { image } = req.body;

    if (!image) {
      return res.status(400).json({ error: "이미지 데이터가 없습니다." });
    }

    // Vercel 환경변수에서 키를 읽어옵니다.
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "서버에 GEMINI_API_KEY가 설정되지 않았습니다." });
    }

    // Base64 포맷 정제
    let cleanBase64 = image;
    let mimeType = "image/jpeg";
    if (cleanBase64.includes(",")) {
      const parts = cleanBase64.split(",");
      const match = parts[0].match(/:(.*?);/);
      if (match) mimeType = match[1];
      cleanBase64 = parts[1];
    }

    // ⭐ 수정된 부분: 모델 이름을 실제 존재하는 gemini-1.5-flash 로 변경했습니다.
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

    const systemInstruction =
      "당신은 대한민국 최고의 임상영양사입니다. 제공된 사진 속 요리나 음식을 감별하고 현실적인 영양 정보를 분석하세요. " +
      "반드시 지정된 JSON 규격에 맞춰 한국어로 답변해야 합니다.";

    const userPrompt =
      "이 사진에 나온 주요 음식을 인식하고, 1인분 기준 추정 칼로리와 설명, 주요 영양소(탄수화물, 단백질, 지방)를 산출해 주세요. " +
      "음식이 아니거나 식별이 불가능한 경우에도 name을 '식별 불가 음식'으로 표기하고 적절한 안내 메시지를 포함해 규격대로 반환하세요.";

    const payload = {
      contents: [
        {
          role: "user",
          parts: [
            { text: userPrompt },
            {
              inlineData: {
                mimeType: mimeType,
                data: cleanBase64,
              },
            },
          ],
        },
      ],
      systemInstruction: {
        parts: [{ text: systemInstruction }],
      },
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: {
            name: { type: "STRING", description: "식별된 한국어 대표 요리명 (예: 김치찌개, 제육덮밥)" },
            desc: { type: "STRING", description: "추정 분량 및 설명 (예: 밥 1공기 포함 기준, 약 1인분)" },
            baseKcal: { type: "INTEGER", description: "1인분 기준 추정 총 칼로리(kcal, 정수)" },
            carbs: { type: "INTEGER", description: "탄수화물 g (정수)" },
            protein: { type: "INTEGER", description: "단백질 g (정수)" },
            fat: { type: "INTEGER", description: "지방 g (정수)" },
          },
          required: ["name", "desc", "baseKcal", "carbs", "protein", "fat"],
        },
      },
    };

    const geminiResponse = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!geminiResponse.ok) {
      const errorText = await geminiResponse.text();
      return res.status(geminiResponse.status).json({ error: "Gemini API 호출 실패", details: errorText });
    }

    const geminiResult = await geminiResponse.json();
    const contentPart = geminiResult.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!contentPart) {
      return res.status(500).json({ error: "AI로부터 응답을 받지 못했습니다." });
    }

    const parsedData = JSON.parse(contentPart);
    return res.status(200).json({ success: true, data: parsedData });
  } catch (err) {
    return res.status(500).json({ error: "서버 내부 오류", message: err.message });
  }
}
