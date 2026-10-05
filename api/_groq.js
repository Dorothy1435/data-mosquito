// Groq 모델 고르기 도우미 (api/ask.js · api/identify.js 가 함께 쓴다)
// -------------------------------------------------------------
// Groq 는 모델을 자주 은퇴시키고, 키(계정)마다 쓸 수 있는 모델도 다르다.
// 2026-10 실제로 'llama-3.3-70b-versatile' 이 이 사이트 키에서 "없음" 오류가 나 챗봇과 사진 판별이 멈췄다.
// 그래서 이름을 코드에 박아 두지 않고, 이 키로 쓸 수 있는 모델 목록을 Groq 에 물어본 뒤
// 선호 순서대로 고른다. 목록을 못 받으면 선호 목록을 그대로 차례로 시도한다.
// (파일 이름이 _ 로 시작하면 Vercel 이 이 파일을 별도 주소로 열지 않는다)

const LIST_URL = 'https://api.groq.com/openai/v1/models';
let cache = { at: 0, ids: null };

async function availableModels(key) {
  if (cache.ids && Date.now() - cache.at < 10 * 60 * 1000) return cache.ids;
  try {
    const r = await fetch(LIST_URL, { headers: { Authorization: `Bearer ${key}` } });
    if (!r.ok) return null;
    const data = await r.json();
    const ids = (data.data || []).filter((m) => m.active !== false).map((m) => m.id);
    cache = { at: Date.now(), ids };
    return ids;
  } catch (_) { return null; }
}

// 글 답변용: 환경변수로 지정한 모델 → 아래 선호 순서 → 그 밖에 쓸 수 있는 대화 모델
const TEXT_PREFER = [/^llama-3\.3-70b/, /^openai\/gpt-oss-120b/, /^moonshotai\/kimi/, /^qwen\//, /^openai\/gpt-oss-20b/, /^llama-3\.1-8b/, /^meta-llama\/llama-4/];
// 사진 판별용: 이미지를 받을 수 있는 모델 이름 패턴
const VISION_PREFER = [/llama-4-maverick/, /llama-4-scout/, /vision/, /-vl\b|-vl-/, /llava/, /gemma-3/];
const NOT_CHAT = /whisper|guard|orpheus|tts|playai|distil|safeguard/;

function rank(ids, prefer, extraFilter) {
  const out = [];
  for (const re of prefer) for (const id of ids) if (re.test(id) && !out.includes(id)) out.push(id);
  if (extraFilter) for (const id of ids) if (extraFilter(id) && !out.includes(id)) out.push(id);
  return out;
}

async function textModels(key, envModel) {
  const ids = await availableModels(key);
  const base = ids ? rank(ids, TEXT_PREFER, (id) => !NOT_CHAT.test(id)) : ['llama-3.3-70b-versatile', 'openai/gpt-oss-120b', 'llama-3.1-8b-instant', 'openai/gpt-oss-20b'];
  return [...new Set([envModel, ...base].filter(Boolean))].slice(0, 5);
}

async function visionModels(key, envModel) {
  const ids = await availableModels(key);
  const base = ids ? rank(ids, VISION_PREFER) : ['meta-llama/llama-4-scout-17b-16e-instruct', 'meta-llama/llama-4-maverick-17b-128e-instruct'];
  return [...new Set([envModel, ...base].filter(Boolean))].slice(0, 4);
}

module.exports = { availableModels, textModels, visionModels };
