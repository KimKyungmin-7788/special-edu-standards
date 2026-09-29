// 성취기준 검색 엔진 — 브라우저와 Node 양쪽에서 동작 (서버·API 없음)
//
// 원리
// 1) 한국어는 조사·어미가 붙어 단어가 변하므로 두 글자 조각(바이그램)으로 비교한다.
//    - 검색어의 첫 조각은 '단어 첫머리'에서만 맞게 한다 ("마트"가 "스마트"에 걸리지 않도록).
// 2) BM25: 여러 성취기준에 두루 나오는 조각(순서, 활동 등)은 점수를 낮추고 드문 조각은 높인다.
// 3) 필드 가중치: 원문 > 성취수준 풀 > 내용요소·성취수준.
// 4) '게임, 앱, 연습'처럼 앱 형식을 말하는 단어는 점수를 크게 낮춘다.
// 5) 유의어 사전으로 교사의 말(돈, 빨래)을 성취기준의 말(화폐, 세탁)로 넓힌다.
// 6) 한 교과가 결과를 독차지하지 않도록 같은 교과 반복 시 점수를 조금씩 낮춘다.
// 7) 수업 주제 문장은 앱 설명보다 1.5배 무겁게 반영한다.
// 8) 결과마다 연관 강도(강함·보통·약함)를 맞은 핵심어 수로 판정한다.

const FIELD_WEIGHTS = { text: 3.0, keywords: 2.0, pool: 1.6, elements: 1.2 };
const K1 = 1.2;
// 길이 보정: 풀은 성취기준마다 길이 차가 커서 강하게 보정
const B_FIELD = { text: 0.5, keywords: 0.5, pool: 0.9, elements: 0.7 };

// 앱 형식·일반어: 내용을 말하지 않으므로 거의 무시
const FORMAT_WORDS = new Set([
  "앱", "웹", "웹앱", "어플", "게임", "시뮬레이션", "퀴즈", "프로그램", "콘텐츠", "컨텐츠",
  "연습", "활동", "학습", "수업", "학생", "학생들", "교사", "선생님", "만든", "만들었다",
  "도구", "자료", "화면", "놀이", "놀이형", "미니게임", "보상", "점수", "버튼식", "기반", "이용한", "활용한", "통해", "위한", "하는", "있는",
  "태블릿용", "인터랙티브", "디지털", "온라인", "체험형", "놀이형",
]);

// 앱 조작·일반 서술어: 내용보다 '어떻게 하는지'를 말하므로 낮게
const GENERIC_WORDS = new Set([
  "고르", "고르는", "고른", "누르", "누르는", "선택", "선택하는", "확인", "확인하는", "알아보", "알아본", "알아보는",
  "찾", "찾아", "찾는", "알맞", "알맞은", "맞춰", "맞추", "완성", "완성하는", "설정", "설정하고", "끌어다", "놓",
  "따라", "보고", "보며", "하며", "몇", "속", "중", "뒤", "위", "안", "각", "오늘", "다음", "여러", "다양",
  "해보", "해보는", "익히", "익히는", "체험", "체험하는",
]);

// 성취기준 문체(~할 수 있다)·기능어: 내용이 없으므로 검색어에서 뺀다
const STOP_WORDS = new Set(["수", "있다", "있는", "있음", "할", "것", "등", "및", "때", "곳", "곳에서", "통해", "위해"]);

// 끝 글자가 조사처럼 보여도 떼면 안 되는 말 (스스로 -> 스스 방지)
const KEEP_WORDS = new Set(["스스로", "서로", "따로", "바로", "새로", "홀로", "함께", "혼자", "처음으로", "마음대로", "차례로", "종류별로"]);

const PARTICLES = [
  "에서는", "으로는", "에게서", "이라는", "하면서", "합니다", "했어요", "해요",
  "에서", "에게", "으로", "하기", "하는", "하고", "해서", "한다", "하며", "하여", "까지", "부터", "처럼", "이나",
  "을", "를", "이", "가", "은", "는", "에", "로", "와", "과", "의", "도", "만",
];

export function normalize(s) {
  return (s || "")
    .replace(/[･·⋅ㆍ・]/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function stripParticle(tok) {
  if (KEEP_WORDS.has(tok)) return tok;
  // 관형형 어미 '-할'(연습할, 이동할)은 떼어 낸다
  if (tok.length >= 3 && tok.endsWith("할")) tok = tok.slice(0, -1);
  for (const p of PARTICLES) {
    if (tok.length - p.length >= 2 && tok.endsWith(p)) return tok.slice(0, -p.length);
  }
  return tok;
}

// 합성어 뒤쪽 명사: 유의어 사전에 있는 명사로 끝나는 단어는 그 명사도 단어 첫머리로 본다.
// (통근버스 -> 버스, 스쿨버스 -> 버스) 앞부분이 두 글자 이상일 때만 (스마트 -> 마트 방지)
let COMPOUND_HEADS = [];

// 문서 쪽 특징: 모든 바이그램 + 단어 첫머리 바이그램(^) + 단어 첫 글자(^1:)
function docFeatures(text) {
  const feats = [];
  for (const w of normalize(text).split(" ")) {
    if (!w) continue;
    feats.push("^1:" + w[0]);
    if (w.length === 1) continue;
    feats.push("^" + w.slice(0, 2));
    for (let i = 0; i + 2 <= w.length; i++) feats.push(w.slice(i, i + 2));
    for (const h of COMPOUND_HEADS) {
      if (w.length - h.length >= 2 && w.endsWith(h)) feats.push("^" + h.slice(0, 2));
    }
  }
  return feats;
}

// 검색어 쪽 특징: 첫 조각은 단어 첫머리에서만, 나머지는 어디서든
function queryFeatures(tok) {
  if (tok.length === 1) return ["^1:" + tok];
  const f = ["^" + tok.slice(0, 2)];
  for (let i = 1; i + 2 <= tok.length; i++) f.push(tok.slice(i, i + 2));
  return f;
}

function counts(arr) {
  const m = new Map();
  for (const x of arr) m.set(x, (m.get(x) || 0) + 1);
  return m;
}

export function buildIndex(standards, synonyms = []) {
  COMPOUND_HEADS = [...new Set(synonyms
    .flatMap((g) => [g.canonical, ...(g.variants || [])])
    .map((t) => normalize(t))
    .filter((t) => t.length >= 2 && !t.includes(" ")))];
  const docs = standards.map((s) => {
    const fields = {
      text: s.text,
      keywords: (s.search?.keywords || []).join(" "),
      pool: (s.search?.pool || []).join(" "),
      elements: (s.search?.elements || []).join(" "),
    };
    const tf = {};
    const len = {};
    for (const [f, v] of Object.entries(fields)) {
      const feats = docFeatures(v);
      tf[f] = counts(feats);
      len[f] = feats.length;
    }
    return { s, tf, len, blob: normalize(Object.values(fields).join(" ")) };
  });
  const avg = {};
  for (const f of Object.keys(FIELD_WEIGHTS)) {
    avg[f] = docs.reduce((a, d) => a + d.len[f], 0) / docs.length || 1;
  }
  const df = new Map();
  for (const d of docs) {
    const seen = new Set();
    for (const f of Object.keys(FIELD_WEIGHTS)) for (const k of d.tf[f].keys()) seen.add(k);
    for (const k of seen) df.set(k, (df.get(k) || 0) + 1);
  }
  const N = docs.length;
  const idf = (k) => {
    const n = df.get(k) || 0;
    return Math.log(1 + (N - n + 0.5) / (n + 0.5));
  };
  // 유의어: 단어 -> 같은 그룹의 다른 표현들
  // 변형어(돈, 빨래)로 검색하면 대표어(화폐, 세탁)를 강하게, 나머지 변형어는 약하게 더한다.
  // 대표어로 검색하면 변형어들을 약하게 나눠 더한다. (구체어 하나가 검색을 뒤덮지 않도록)
  const syn = new Map(); // term -> [{term, weight}]
  const add = (t, list) => syn.set(t, [...(syn.get(t) || []), ...list]);
  for (const g of synonyms) {
    const canon = normalize(g.canonical);
    const vars = (g.variants || []).map(normalize).filter((v) => v && v !== canon);
    add(canon, vars.map((v) => ({ term: v, weight: Math.max(0.15, 0.7 / vars.length) })));
    for (const v of vars) {
      const sib = vars.filter((x) => x !== v);
      add(v, [{ term: canon, weight: 0.7 },
              ...sib.map((x) => ({ term: x, weight: Math.max(0.1, 0.3 / Math.max(1, sib.length)) }))]);
    }
  }
  return { docs, avg, idf, syn };
}

// 검색어 -> [{token, weight, source}]
// query 는 문자열, 또는 { topic: 수업 주제, app: 앱 설명 } 객체.
// 수업 주제는 배우는 내용을 말하므로 앱 설명(조작 방법이 섞임)보다 무겁게 본다.
export const TOPIC_WEIGHT = 1.5;

function rawTokens(text) {
  const out = [];
  for (const w of normalize(text).split(" ").filter(Boolean)) {
    if (STOP_WORDS.has(w)) continue;
    const t = stripParticle(w);
    if (!t || STOP_WORDS.has(t)) continue;
    const isFormat = FORMAT_WORDS.has(w) || FORMAT_WORDS.has(t);
    const isGeneric = GENERIC_WORDS.has(w) || GENERIC_WORDS.has(t);
    out.push({ token: t, base: isFormat ? 0.1 : isGeneric ? 0.3 : 1.0 });
  }
  return out;
}

export function parseQuery(query, index) {
  const parts = typeof query === "string"
    ? [{ text: query, mult: 1.0, from: "app" }]
    : [{ text: query.topic || "", mult: TOPIC_WEIGHT, from: "topic" },
       { text: query.app || "", mult: 1.0, from: "app" }];
  const byToken = new Map();
  const push = (token, weight, source, from, core) => {
    if (!token) return;
    const prev = byToken.get(token);
    if (!prev || weight > prev.weight) byToken.set(token, { token, weight, source, from, core });
  };
  for (const p of parts) {
    for (const r of rawTokens(p.text)) push(r.token, r.base * p.mult, "query", p.from, r.base >= 1);
  }
  // 유의어 확장 (핵심어만)
  for (const q of [...byToken.values()]) {
    if (!q.core) continue;
    const mult = q.from === "topic" ? TOPIC_WEIGHT : 1.0;
    for (const [term, others] of index.syn) {
      const hit = q.token === term || (term.length >= 2 && q.token.startsWith(term) && q.token.length - term.length <= 2);
      if (!hit) continue;
      for (const { term: o, weight } of others) {
        const ps = o.split(" ").map(stripParticle).filter(Boolean);
        // 한 글자 표현(비, 눈, 차, 자 등)은 엉뚱한 단어 첫머리에 걸리므로 확장하지 않는다
        for (const x of ps) if (x.length >= 2 && !byToken.has(x)) push(x, (weight / ps.length) * mult, `유의어(${q.token})`, q.from, false);
      }
    }
  }
  return [...byToken.values()];
}

function tokenScore(doc, tok, index) {
  const feats = queryFeatures(tok);
  let total = 0;
  const fieldsHit = new Set();
  for (const k of feats) {
    const w = index.idf(k);
    for (const [f, fw] of Object.entries(FIELD_WEIGHTS)) {
      const tf = doc.tf[f].get(k) || 0;
      if (!tf) continue;
      const norm = tf * (K1 + 1) / (tf + K1 * (1 - B_FIELD[f] + B_FIELD[f] * doc.len[f] / index.avg[f]));
      total += fw * w * norm;
      fieldsHit.add(f);
    }
  }
  // 조각 평균: 긴 단어가 조각 수만큼 부풀지 않게. 모든 조각이 맞으면 가산점
  const has = (k) => Object.keys(FIELD_WEIGHTS).some((f) => doc.tf[f].has(k));
  const hits = feats.filter(has).length;
  const allHit = hits === feats.length;
  // 어간 일치: 세 글자 이상 단어에서 첫 조각이 맞고 절반 이상 맞으면 (움직이 ~ 움직임, 고르 ~ 고른다)
  const stemHit = !allHit && feats.length >= 2 && has(feats[0]) && hits / feats.length >= 0.5;
  const factor = allHit ? 1.3 : stemHit ? 1.0 : 0.4;
  const score = (total / Math.sqrt(feats.length)) * factor;
  return { score, fieldsHit, allHit: allHit || stemHit };
}

// 연관 강도: 맞은 '드문 핵심어'(교사가 쓴 말 중 소수 성취기준에만 맞는 말) 수로 판정한다.
//   강함: 드문 핵심어 2개 이상, 또는 드문 핵심어 1개 + (수업 주제의 드문 말 또는 드문 유의어) 일치
//   보통: 드문 핵심어 1개, 또는 드문 유의어 일치, 또는 흔한 핵심어 3개 이상
//   약함: 흔한 말·조작어로만 일치
export function strengthOf(r, top, bothParts = true) {
  const coreRare = new Set(r.matched.filter((m) => m.source === "query" && m.core && m.rare).map((m) => m.word));
  const coreAll = new Set(r.matched.filter((m) => m.source === "query" && m.core).map((m) => m.word));
  const synRare = new Set(r.matched.filter((m) => m.source !== "query" && m.rare).map((m) => m.word));
  // 수업 주제 가산은 주제·앱 설명을 모두 입력했을 때만 (한 칸만 쓰면 모든 결과가 '강함'이 되므로)
  const topicRare = bothParts && r.matched.some((m) => m.from === "topic" && m.rare && (m.core || m.source !== "query"));
  if (coreRare.size >= 2 || (coreRare.size >= 1 && (topicRare || synRare.size >= 1))) return "강함";
  if (coreRare.size === 1 || synRare.size >= 1 || coreAll.size >= 3) return "보통";
  return "약함";
}

export function search(query, index, opts = {}) {
  const {
    limit = 15,          // 최종 결과 수
    perSubject = 8,      // 교과별 최대 개수 (안전장치)
    diversity = 0.95,    // 같은 교과가 반복될 때 곱하는 감쇠 (테스트 세트 기준 0.95가 손실 최소)
    minRatio = 0.25,     // 1위 점수 대비 최소 비율
    schoolLevels = null, // ["초등학교", ...] 필터
    subjects = null,     // ["실과", ...] 필터
  } = opts;
  const terms = parseQuery(query, index);
  const bothParts = typeof query !== "string" && !!(query.topic || "").trim() && !!(query.app || "").trim();
  if (!terms.length) return { terms, results: [], grouped: [] };

  // 1차: 성취기준마다 검색어별 일치 계산
  const rows = [];
  const df = new Map(); // 검색어 -> 일치한 성취기준 수 (전체 688개 기준)
  for (const d of index.docs) {
    const per = terms.map((t) => tokenScore(d, t.token, index));
    per.forEach((r, i) => { if (r.score > 0 && r.allHit) df.set(terms[i].token, (df.get(terms[i].token) || 0) + 1); });
    if (schoolLevels && !schoolLevels.includes(d.s.school_level)) continue;
    if (subjects && !subjects.includes(d.s.subject)) continue;
    rows.push({ d, per });
  }
  // 드문 말: 전체의 3%(약 20개) 이하 성취기준에서만 맞는 말. '스스로, 이용, 이동'처럼 두루 맞는 말은 제외
  const rareLimit = Math.max(15, Math.round(index.docs.length * 0.03));
  const isRare = (w) => (df.get(w) || 0) <= rareLimit;

  const scored = [];
  for (const { d, per } of rows) {
    let score = 0;
    const matched = [];
    per.forEach((r, i) => {
      const t = terms[i];
      if (r.score > 0 && r.allHit) {
        score += r.score * t.weight;
        matched.push({ word: t.token, source: t.source, core: t.core, from: t.from, rare: isRare(t.token), fields: [...r.fieldsHit] });
      } else if (r.score > 0) {
        score += r.score * t.weight * 0.5;
      }
    });
    // 서로 다른 '드문 핵심어'가 여러 개 맞을수록 가산 (흔한 말끼리의 우연 일치 억제)
    const distinct = new Set(matched.filter((m) => m.source === "query" && m.core && m.rare).map((m) => m.word)).size;
    score *= 1 + 0.25 * Math.max(0, distinct - 1);
    if (score > 0) scored.push({ standard: d.s, score, matched });
  }
  scored.sort((a, b) => b.score - a.score);
  const top = scored[0]?.score || 0;

  // 교과 다양성: 같은 교과가 이미 n개 뽑혔으면 점수에 decay^n 을 곱해 다음 후보를 고른다.
  // (딱 자르는 상한 대신 부드럽게 — 한 교과에 몰리는 게 맞는 앱은 그대로 몰린다)
  const pool = scored.filter((r) => r.score >= top * minRatio).slice(0, 200);
  const results = [];
  const perSubj = new Map();
  const used = new Set();
  while (results.length < limit) {
    let best = null, bestAdj = -1;
    for (const r of pool) {
      if (used.has(r)) continue;
      const n = perSubj.get(r.standard.subject) || 0;
      if (n >= perSubject) continue;
      const adj = r.score * Math.pow(diversity, n);
      if (adj > bestAdj) { bestAdj = adj; best = r; }
    }
    if (!best) break;
    used.add(best);
    perSubj.set(best.standard.subject, (perSubj.get(best.standard.subject) || 0) + 1);
    results.push({ ...best, relevance: best.score / top, strength: strengthOf(best, top, bothParts) });
  }

  // 학교급 -> 교과 순으로 정리 (각 묶음 안은 점수순)
  const levelOrder = ["초등학교", "중학교", "고등학교"];
  const grouped = levelOrder
    .map((lv) => {
      const rs = results.filter((r) => r.standard.school_level === lv);
      const bySubj = new Map();
      for (const r of rs) {
        if (!bySubj.has(r.standard.subject)) bySubj.set(r.standard.subject, []);
        bySubj.get(r.standard.subject).push(r);
      }
      return { school_level: lv, subjects: [...bySubj].map(([subject, items]) => ({ subject, items })) };
    })
    .filter((g) => g.subjects.length);

  return { terms, results, grouped, ranked: scored };
}

// 교사가 자기 AI 채팅에 붙여넣을 프롬프트
export function buildPrompt(query, results, allStandards = null) {
  const list = (allStandards || results.map((r) => r.standard))
    .map((s) => `${s.code} (${s.school_level} ${s.grade_band} ${s.subject}) ${s.text}`)
    .join("\n");
  return [
    "당신은 2022 개정 특수교육 기본 교육과정 전문가입니다.",
    "아래 [앱 설명]을 읽고, [성취기준 목록]에서 이 앱과 연관된 성취기준을 고르세요.",
    "규칙:",
    "- 목록에 있는 코드만 사용하고, 성취기준 문장은 목록 그대로 인용하세요.",
    "- 학생이 앱에서 실제로 하는 행동(조작, 선택, 판단, 표현)과 성취기준을 연결하세요.",
    "- 각 성취기준마다 연관 강도(직접/간접)와 이유를 한 문장으로 쓰세요.",
    "- 학교급 → 교과 순으로 정리하세요.",
    "",
    "[앱 설명]",
    query,
    "",
    allStandards ? "[성취기준 목록: 전체]" : "[성취기준 목록: 검색 상위 후보]",
    list,
  ].join("\n");
}
