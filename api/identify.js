// 모기제로 사진 판별 — Vercel 서버리스 함수
// -------------------------------------------------------------
// 역할: 시민이 찍은 모기 사진 한 장을 받아, 이미지를 읽을 수 있는 AI 모델에게
//       "우리 주변 모기 4종 중 무엇에 가까운지"만 물어 답을 돌려준다.
// 원칙
//   · 학습하지 않는다. 사진을 저장하지 않는다. 서버 기록(로그)에도 사진을 남기지 않는다.
//   · 모르면 모른다고 답하게 한다. 빨간집모기·작은빨간집모기는 사진으로 구분이 어려워 '집모기류'로 묶는다.
//   · 의학적 판단(물렸으니 무슨 병)은 하지 않는다.
// 키는 api/ask.js 와 같은 환경변수를 쓴다: OPENAI_API_KEY / GEMINI_API_KEY / GROQ_API_KEY (하나만 있으면 됨)

const OPENAI_VISION_MODEL = process.env.OPENAI_VISION_MODEL || 'gpt-4o-mini';
const GEMINI_VISION_MODELS = ['gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-flash-latest'];
const GROQ_VISION_MODEL = process.env.GROQ_VISION_MODEL || '';   // 비워 두면 api/_groq.js 가 이미지를 받는 모델을 골라 준다
const groq = require('./_groq.js');

const LABELS = ['흰줄숲모기', '얼룩날개모기', '집모기류', '모기 아님', '알 수 없음'];

const PROMPT = `당신은 한국 김해시 보건소 웹사이트의 모기 사진 판별 도우미입니다.
사진 속 곤충이 아래 중 무엇에 가장 가까운지 고르세요.
- 흰줄숲모기: 검은 몸과 다리에 흰 줄무늬·흰 점이 뚜렷함. 가슴 등쪽 가운데 흰 세로줄.
- 얼룩날개모기: 날개에 검은 얼룩점. 앉을 때 몸을 비스듬히(머리를 아래로) 세움.
- 집모기류: 갈색·황갈색의 평범한 모기. 빨간집모기와 작은빨간집모기는 사진으로 구분이 어려우므로 이 이름으로 묶는다.
- 모기 아님: 파리, 각다귀(큰 모기처럼 생긴 다리 긴 곤충), 나방파리, 깔따구 등 모기가 아닌 곤충이거나 곤충이 없는 사진.
- 알 수 없음: 흐리거나, 너무 멀거나, 짓눌려 특징이 안 보임.
규칙: 확실하지 않으면 '알 수 없음'이나 낮은 확신도를 고르세요. 추측을 사실처럼 말하지 마세요. 의학적 진단은 하지 마세요.
반드시 아래 JSON 하나만 출력하세요.
{"label": "흰줄숲모기|얼룩날개모기|집모기류|모기 아님|알 수 없음", "confidence": "높음|보통|낮음", "reasons": ["사진에서 본 특징 1", "특징 2"], "photo_tip": "다시 찍을 때 도움이 되는 한 문장(필요 없으면 빈 문자열)"}`;

function parseResult(raw) {
  let text = String(raw || '').trim();
  const m = text.match(/\{[\s\S]*\}/);
  if (m) text = m[0];
  try {
    const p = JSON.parse(text);
    const label = LABELS.includes(p.label) ? p.label : '알 수 없음';
    const confidence = ['높음', '보통', '낮음'].includes(p.confidence) ? p.confidence : '낮음';
    const reasons = Array.isArray(p.reasons) ? p.reasons.slice(0, 3).map((r) => String(r).slice(0, 80)) : [];
    const photoTip = String(p.photo_tip || '').slice(0, 120);
    return { label, confidence, reasons, photoTip };
  } catch (_) {
    return { label: '알 수 없음', confidence: '낮음', reasons: [], photoTip: '' };
  }
}

async function callOpenAICompatible(url, key, model, dataUrl) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model, temperature: 0.1, max_tokens: 300,
      messages: [{ role: 'user', content: [{ type: 'text', text: PROMPT }, { type: 'image_url', image_url: { url: dataUrl } }] }],
    }),
  });
  if (!r.ok) throw new Error(`${r.status}: ${(await r.text()).slice(0, 200)}`);
  const data = await r.json();
  return parseResult(data?.choices?.[0]?.message?.content);
}

async function callGemini(key, base64, mime) {
  let lastErr = '';
  for (const model of GEMINI_VISION_MODELS) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: PROMPT }, { inline_data: { mime_type: mime, data: base64 } }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 300, responseMimeType: 'application/json' },
      }),
    });
    if (!r.ok) { lastErr = `[${model}] ${r.status}`; continue; }
    const data = await r.json();
    return parseResult(data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join(''));
  }
  throw new Error(lastErr || 'Gemini 실패');
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST만 허용됩니다.' }); return; }
  const openaiKey = process.env.OPENAI_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;
  const groqKey = process.env.GROQ_API_KEY;
  if (!openaiKey && !geminiKey && !groqKey) {
    res.status(200).json({ ok: false, configured: false, message: '사진 판별이 아직 설정되지 않았어요. (관리자: Vercel 환경변수에 AI 키를 넣어 주세요)' });
    return;
  }
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const dataUrl = String(body.image || '');
    const m = dataUrl.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
    if (!m) { res.status(400).json({ ok: false, message: '사진 형식을 읽지 못했어요. 다시 찍어 주세요.' }); return; }
    if (m[2].length > 2_000_000) { res.status(413).json({ ok: false, message: '사진이 너무 커요. 다시 찍어 주세요.' }); return; }

    const chain = [];
    if (openaiKey) chain.push(() => callOpenAICompatible('https://api.openai.com/v1/chat/completions', openaiKey, OPENAI_VISION_MODEL, dataUrl));
    if (geminiKey) chain.push(() => callGemini(geminiKey, m[2], m[1]));
    if (groqKey) chain.push(async () => {
      let err = '이미지 모델 없음';
      for (const model of await groq.visionModels(groqKey, GROQ_VISION_MODEL)) {
        try { return await callOpenAICompatible('https://api.groq.com/openai/v1/chat/completions', groqKey, model, dataUrl); }
        catch (e) { err = `[${model}] ${String(e.message).slice(0, 120)}`; }
      }
      throw new Error(err);
    });

    const errors = [];
    for (const fn of chain) {
      try { const result = await fn(); res.status(200).json({ ok: true, ...result }); return; }
      catch (e) { const m = String(e.message || e).slice(0, 200); errors.push(m); console.error('사진 판별 제공자 실패, 다음으로', m); }   // 사진 내용은 기록하지 않는다
    }
    res.status(200).json({ ok: false, message: '지금은 사진을 판별하지 못했어요. 잠시 후 다시 시도해 주세요.', ...(String(body.debug || '') === '1' ? { errors } : {}) });
  } catch (e) {
    res.status(200).json({ ok: false, message: '지금은 사진을 판별하지 못했어요. 잠시 후 다시 시도해 주세요.' });
  }
};
