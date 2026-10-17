module.exports = async function handler(req, res) {
  // CORS 허용
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // Vercel KV REST API 환경변수 가져오기
  const kvUrl = process.env.KV_REST_API_URL;
  const kvToken = process.env.KV_REST_API_TOKEN;

  // 1. GET 요청: 관리자 페이지 통계 요청 시
  if (req.method === "GET") {
    if (!kvUrl || !kvToken) {
      return res.status(200).json({ day: 0, month: 0, total: 0, message: "DB가 아직 연결되지 않았습니다." });
    }
    try {
      const d = new Date();
      const dayKey = `count_day_${d.getFullYear()}${d.getMonth() + 1}${d.getDate()}`;
      const monthKey = `count_month_${d.getFullYear()}${d.getMonth() + 1}`;
      
      const kvRes = await fetch(`${kvUrl}/mget/count_total/${monthKey}/${dayKey}`, {
        headers: { Authorization: `Bearer ${kvToken}` }
      });
      const kvData = await kvRes.json();
      const counts = kvData.result || [0, 0, 0];
      
      return res.status(200).json({
        total: parseInt(counts[0] || 0),
        month: parseInt(counts[1] || 0),
        day: parseInt(counts[2] || 0)
      });
    } catch (e) {
      return res.status(500).json({ error: "DB 조회 실패" });
    }
  }

  // 2. POST 요청: 기존 이미지 분석
  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST 요청만 지원합니다." });
  }

  try {
    const { image } = req.body;
    if (!image) return res.status(400).json({ error: "이미지 데이터가 없습니다." });

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: "서버에 API 키가 설정되지 않았습니다." });

    let cleanBase64 = image;
    let mimeType = "image/jpeg";
    if (cleanBase64.includes(",")) {
      const parts = cleanBase64.split(",");
      const match = parts[0].match(/:(.*?);/);
      if (match) mimeType = match[1];
      cleanBase64 = parts[1];
    }

    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=${apiKey}`;

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

    if (!geminiResponse.ok) {
      const errorText = await geminiResponse.text();
      return res.status(502).json({ error: `Gemini API 에러 (${geminiResponse.status})`, details: errorText });
    }

    const geminiResult = await geminiResponse.json();
    const contentPart = geminiResult.candidates?.[0]?.content?.parts?.[0]?.text;
    
    if (!contentPart) return res.status(500).json({ error: "AI 분석 결과를 읽을 수 없습니다." });
    
    const parsedData = JSON.parse(contentPart);

    // [핵심] 분석 성공 시 DB 카운트 +1 (DB가 세팅된 경우에만 작동)
    if (kvUrl && kvToken) {
      const d = new Date();
      const dayKey = `count_day_${d.getFullYear()}${d.getMonth() + 1}${d.getDate()}`;
      const monthKey = `count_month_${d.getFullYear()}${d.getMonth() + 1}`;
      
      fetch(`${kvUrl}/pipeline`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${kvToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify([
          ["INCR", "count_total"],
          ["INCR", monthKey],
          ["INCR", dayKey]
        ])
      }).catch(e => console.error("DB 기록 무시됨:", e)); // 에러나도 분석 결과는 정상 반환
    }

    return res.status(200).json({ success: true, data: parsedData });

  } catch (err) {
    return res.status(500).json({ error: "서버 내부 로직 에러", message: err.message });
  }
};
