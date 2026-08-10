// 모기제로 AI 도우미 — Vercel 서버리스 함수
// 역할: 브라우저가 보낸 질문을, '사이트 안의 사실'에만 근거해 답한다.
// 제공자(아무거나 1개 키만 설정하면 됨, 우선순위: OpenAI > Groq > Gemini):
//   - OPENAI_API_KEY (유료·저렴, gpt-4o-mini 등)
//   - GROQ_API_KEY   (무료·빠름, Llama 등)
//   - GEMINI_API_KEY (무료, 단 신규 계정은 모델 제한이 있을 수 있음)
// 키는 이 서버에서만 읽으므로 브라우저에 노출되지 않는다.
// 숫자(구역 점수 등)는 LLM이 만들지 않고, 브라우저가 계산해 보낸 값만 쓴다(환각 방지).
// 사이트로 답할 수 없는 질문(치즈케이크 등)은 정중히 거절한다.

const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
// Gemini는 계정마다 되는 모델이 달라, 여러 개를 순차 시도한다.
const GEMINI_MODELS = ['gemini-2.0-flash-lite', 'gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-flash-latest'];

// === 사이트가 답할 수 있는 '고정 지식' (사람이 검수한 사실만) ===
const KNOWLEDGE = `
[모기제로란]
- 김해시 발생원(모기가 번식하는 시설·환경) 데이터와 실시간 날씨로 '오늘의 모기 위험'을 예보하는 웹서비스.
- 김해시는 발생원 데이터가 있어 '정밀 모델'이 적용되고, 그 외 지역은 '날씨 기반 추정'으로만 표시된다.

[모기지수와 등급]
- 0~100점. 높을수록 위험. 화면 등급 이름: 쾌적 / 관심 / 주의 / 불쾌.
- 이 값은 '참고용 예상값'이며 의학적·방역적 최종 판단이 아니다.

[계산 방법(v4)]
- 모기지수 = 100 × 날씨활동지수 × (0.30 + 0.70 × 밀도위험)
- 밀도위험(0~1) = 발생원 밀도(개/㎢)와 인구 밀도(명/㎢)를 로그정규화해 평균한 값. '개수'가 아니라 '단위면적당 밀도'를 쓴다.
- 날씨활동지수 = 유효기온(당일 29% + 최근 7일 71%)을 Brière 곡선(30℃ 정점)으로 평가하고 습도·최근 7일 강수·풍속으로 보정.
- 유충 검출률·성충 포집은 점수 계산에 넣지 않는다(검증 전용).

[검증 — 신뢰 근거]
- 공간 검증: 예측 '밀도위험'이 실제 2025년 방역민원 밀도와 순위상관 +0.951로 일치. (개수 기반 이전 버전은 -0.258로 방향이 반대였음)
- 시간 검증: 모델 날씨 활동곡선이 실측 유충(1,086개 지점·2024~2026·5.4만 건)의 월별 발생과 상관 +0.996으로 거의 포개짐.
- 민원·유충은 검증에만 쓰고 점수에는 넣지 않아 순환이 없다.

[발생원 16종]
정화조(청소대상), 개인하수처리시설, 개인오수처리시설, 공공하수처리시설, 축산농가, 저수지, 타이어가게, 폐타이어적치, 폐기물처리업, 고물상, 수경시설, 공중화장실, 도시공원, 목욕장, 배수펌프장, 양봉농가. 김해시 전체 약 17,081개소.

[데이터 출처]
- 김해시 방역현황보고 시스템(sodamap)에서 발생원·면적·인구·민원·유충 실측을 확보. 날씨는 Open-Meteo(무료 공개 API), 지도는 OpenStreetMap.

[예방 요령 — 시민]
- 집·주변의 고인 물(화분받침, 폐타이어, 빗물받이, 양동이)을 비운다. 방충망을 점검한다.
- 해질녘·새벽 야외활동 시 밝은 긴 옷과 모기 기피제를 쓴다. 물가·수풀 가까운 곳을 피한다.
- 산책은 물가의 수변공원·넓은 근린공원보다, 작고 관리되는 어린이·소공원이 상대적으로 안전하다.

[방제 요령 — 당국]
- 위험·발생원이 높은 구역부터 유충 구제(라바사이드·IGR)를 선제 시행하고 인력·예산을 배분한다.
- 정화조·오수처리 정체수, 공원 인공연못·배수로, 저수지 등 발생원별로 유충 서식면을 관리한다.

[국내 매개모기와 감염병 — 논문(이동규, 2017) 기반]
- 작은빨간집모기: 일본뇌염 매개. 논·축사·웅덩이에서 번식.
- 빨간집모기: 웨스트나일열 매개 가능. 정화조·오수 등 오염된 정체수에서 번식.
- 흰줄숲모기: 뎅기열·지카 매개 가능. 폐타이어·인공용기 등 소형 용기에서 번식.
- 얼룩날개모기류: 말라리아 매개. 논·습지에서 번식.

[한계]
- 구역 단위가 17개로 작아, 정밀 예측보다 위험 스크리닝·방제 우선순위용으로 적합하다.
`;

function buildSystemPrompt(districtsText, today) {
  return `당신은 '모기제로' 웹사이트의 안내 도우미입니다. 김해시 모기 위험 정보만 안내합니다.

[반드시 지킬 규칙]
1) 아래 <사이트 지식>과 <오늘 데이터>에 있는 내용으로만 답하세요.
2) 거기에 없는 통계·수치·사실을 절대 지어내지 마세요(환각 금지). 특히 감염자 수·구역 점수 같은 숫자는 <오늘 데이터>에 있는 값만 쓰고, 없으면 "화면에서 확인해 주세요"라고 하세요.
3) 모기·모기지수·발생원·김해 구역·예방/방제·매개모기 감염병과 무관한 질문(예: 요리 레시피, 주식, 일반 잡담)에는 답하지 말고 answer에 정확히 이렇게만 쓰세요:
   "죄송해요, 저는 김해 모기 위험 정보만 안내할 수 있어요 🦟 모기지수·발생원·예방법 같은 걸 물어봐 주세요."
4) 짧고 쉽게(2~4문장), 한국어로, 초보자도 이해되게 답하세요.
5) 답이 참고용임을 필요할 때 덧붙이세요. 의학적 진단은 하지 마세요.
6) followups: 사용자가 이어서 궁금해할 후속 질문 3개(각 20자 이내, 반드시 이 사이트가 답할 수 있는 주제). 거절하는 경우에도 답할 수 있는 예시 질문 3개를 넣으세요.

[출력 형식] 반드시 아래 JSON 하나만 출력하세요. 다른 텍스트 금지.
{"answer": "여기에 답변", "followups": ["질문1", "질문2", "질문3"]}

오늘 날짜: ${today || '알 수 없음'}

<사이트 지식>
${KNOWLEDGE}

<오늘 데이터(구역별, 모델이 계산한 실제 값)>
${districtsText || '(구역 데이터 없음)'}
`;
}

function districtsToText(districts) {
  if (!Array.isArray(districts) || !districts.length) return '';
  return districts
    .map((d) => {
      const src = Array.isArray(d.top_sources) && d.top_sources.length
        ? ` 주요발생원: ${d.top_sources.join(', ')}` : '';
      return `- ${d.name}: ${d.index}점(${d.grade}), 밀도위험 ${d.density_risk}.${src}`;
    })
    .join('\n');
}

// LLM 원문(JSON 문자열 기대)을 {answer, followups}로 안전하게 파싱.
function parseAnswer(raw) {
  let answer = (raw || '').trim();
  let followups = [];
  try {
    const p = JSON.parse(raw);
    if (p && typeof p === 'object') {
      answer = String(p.answer || '').trim() || answer;
      followups = Array.isArray(p.followups) ? p.followups.slice(0, 3).map(String) : [];
    }
  } catch (_) { /* JSON이 아니면 원문을 그대로 답으로 */ }
  return { answer, followups };
}

// OpenAI 호환 API(OpenAI, Groq 공통). 실패 시 Error를 던진다.
async function callOpenAICompatible(baseUrl, key, model, systemPrompt, question) {
  const r = await fetch(baseUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      max_tokens: 800,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: question },
      ],
    }),
  });
  if (!r.ok) {
    const t = await r.text();
    let m = t; try { m = JSON.parse(t)?.error?.message || t; } catch (_) {}
    throw new Error(`${r.status}: ${m}`.slice(0, 300));
  }
  const data = await r.json();
  const raw = data?.choices?.[0]?.message?.content || '';
  return parseAnswer(raw);
}

// Gemini API. 여러 모델을 순차 시도하고 모두 실패하면 마지막 오류를 던진다.
async function callGemini(key, systemPrompt, question) {
  const payload = {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: 'user', parts: [{ text: question }] }],
    generationConfig: {
      temperature: 0.2, maxOutputTokens: 800, topP: 0.9,
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'object',
        properties: { answer: { type: 'string' }, followups: { type: 'array', items: { type: 'string' } } },
        required: ['answer', 'followups'],
      },
    },
  };
  let lastErr = '알 수 없는 오류';
  for (const model of GEMINI_MODELS) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
    let r;
    try {
      r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    } catch (netErr) { lastErr = `네트워크: ${netErr.message}`; continue; }
    if (!r.ok) {
      const t = await r.text();
      let m = t; try { m = JSON.parse(t)?.error?.message || t; } catch (_) {}
      lastErr = `[${model}] ${r.status}: ${m}`.slice(0, 300);
      if ([400, 404, 429, 500, 503].includes(r.status)) continue; // 다른 모델로 우회
      break; // 401/403 등은 중단
    }
    const data = await r.json();
    const raw = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('').trim() || '';
    return parseAnswer(raw);
  }
  throw new Error(lastErr);
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST만 허용됩니다.' }); return; }

  const openaiKey = process.env.OPENAI_API_KEY;
  const groqKey = process.env.GROQ_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;
  if (!openaiKey && !groqKey && !geminiKey) {
    res.status(200).json({
      answer: '⚙️ AI 도우미가 아직 설정되지 않았어요. (관리자: Vercel 환경변수 OPENAI_API_KEY 또는 GROQ_API_KEY 또는 GEMINI_API_KEY 중 하나 설정 필요)',
      configured: false,
    });
    return;
  }

  let debug = false;
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const question = String(body.question || '').slice(0, 500).trim();
    if (!question) { res.status(400).json({ error: '질문이 비어 있습니다.' }); return; }
    debug = String(body.debug || '') === '1';
    const systemPrompt = buildSystemPrompt(districtsToText(body.districts), body.today);

    // 이중화 체인: 무료(Groq)를 먼저 쓰고, 한도 초과 등 실패 시 OpenAI→Gemini로 자동 폴백.
    // → 평소엔 공짜, 폭주(429) 때만 유료 OpenAI가 받아준다. 설정된 키만 후보에 오른다.
    const chain = [];
    if (groqKey) chain.push({ name: 'groq', fn: () => callOpenAICompatible('https://api.groq.com/openai/v1/chat/completions', groqKey, GROQ_MODEL, systemPrompt, question) });
    if (openaiKey) chain.push({ name: 'openai', fn: () => callOpenAICompatible('https://api.openai.com/v1/chat/completions', openaiKey, OPENAI_MODEL, systemPrompt, question) });
    if (geminiKey) chain.push({ name: 'gemini', fn: () => callGemini(geminiKey, systemPrompt, question) });

    let lastErr = '설정된 제공자가 없습니다.';
    for (const p of chain) {
      try {
        const result = await p.fn();
        res.status(200).json({
          answer: result.answer || '죄송해요, 답변을 만들지 못했어요. 다시 물어봐 주세요.',
          followups: result.followups || [],
          provider: p.name, ok: true,
        });
        return;
      } catch (err) {
        lastErr = `[${p.name}] ${err && err.message ? err.message : err}`;
        console.error('제공자 실패, 다음으로 폴백', lastErr);
      }
    }
    // 모든 제공자 실패
    res.status(200).json({
      answer: debug ? `⚠️ 답변 실패\n${lastErr}` : '⚠️ 잠시 답변을 가져오지 못했어요. 잠시 후 다시 시도해 주세요.',
      ok: false, error: lastErr,
    });
  } catch (e) {
    const msg = String(e && e.message || e);
    console.error('ask 오류', msg);
    res.status(200).json({
      answer: debug ? `⚠️ 답변 실패\n${msg}` : '⚠️ 잠시 답변을 가져오지 못했어요. 잠시 후 다시 시도해 주세요.',
      ok: false, error: msg,
    });
  }
};
