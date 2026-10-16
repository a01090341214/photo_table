module.exports = async function handler(req, res) {
  // CORS 허용
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

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "서버에 API 키가 설정되지 않았습니다." });
    }

    let cleanBase64 = image;
    let mimeType = "image/jpeg";
    if (cleanBase64.includes(",")) {
      const parts = cleanBase64.split(",");
      const match = parts[0].match(/:(.*?);/);
      if (match) mimeType = match[1];
      cleanBase64 = parts[1];
    }

    // 원인 해결: 구글 시스템에 존재하는 정확한 모델명(1.5-flash)으로 복구
    const apiUrl = `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

    const payload = {
      contents: [{ role: "user", parts: [
        { text: "이 사진에 나온 주요 음식을 인식하고, 1인분 기준 추정 칼로리와 설명, 주요 영양소(탄수화물, 단백질, 지방)를 산출해 주세요. 음식이 아니거나 식별 불가능한 경우에도 적절한 안내 메시지를 포함해 규격대로 반환하세요." },
        { inlineData: { mimeType: mimeType, data: cleanBase64 } }
      ]}],
      systemInstruction: { parts: [{ text: "당신은 대한민국 최고의 임상영양사입니다. 반드시 지정된 JSON 규격에 맞춰 한국어로 답변해야 합니다." }] },
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: {
            name: { type: "STRING" },
            desc: { type: "STRING" },
            baseKcal: { type: "INTEGER" },
            carbs: { type: "INTEGER" },
            protein: { type: "INTEGER" },
            fat: { type: "INTEGER" }
          },
          required: ["name", "desc", "baseKcal", "carbs", "protein", "fat"]
        }
      }
    };

    const geminiResponse = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    // 에러 코드 분리: 구글 API 에러일 경우 502(Bad Gateway)를 반환하여 Vercel 404와 명확히 구분
    if (!geminiResponse.ok) {
      const errorText = await geminiResponse.text();
      return res.status(502).json({ error: `Gemini API 에러 (${geminiResponse.status})`, details: errorText });
    }

    const geminiResult = await geminiResponse.json();
    const contentPart = geminiResult.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!contentPart) {
      return res.status(500).json({ error: "AI 분석 결과를 읽을 수 없습니다." });
    }

    const parsedData = JSON.parse(contentPart);
    return res.status(200).json({ success: true, data: parsedData });

  } catch (err) {
    return res.status(500).json({ error: "서버 내부 로직 에러", message: err.message });
  }
};
