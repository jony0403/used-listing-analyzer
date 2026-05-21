#!/usr/bin/env node
/** 로컬 가격 분석 페이지 + Gemini API 프록시 (API 키는 클라이언트가 헤더로 전달) */
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.ANALYZER_PORT) || 3920;
const ANALYZER_DIR = path.join(__dirname, 'analyzer');
const EXTENSION_ICONS_DIR = path.join(__dirname, 'extension', 'icons');
const PROMPTS_DIR = path.join(__dirname, 'prompts');

/** 번개·당근 검색창 쿼리 상한(한글 제품명+세대); clamp 시 한 어절·한 낱말 중간 절단 방지 로직과 함께 사용 */
const MAX_SEARCH_QUERY_CHARS = 96;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
};

async function loadPrompt(name) {
  return fs.readFile(path.join(PROMPTS_DIR, name), 'utf8');
}

const PROMPTS = {
  searchQuerySingle: await loadPrompt('search-query-single.txt'),
  searchQueryCandidates: await loadPrompt('search-query-candidates.txt'),
  productIdentify: await loadPrompt('product-identify.txt'),
  productSummary: await loadPrompt('product-summary.txt'),
  productRisk: await loadPrompt('product-risk.txt'),
  productRiskJson: await loadPrompt('product-risk-json.txt'),
};

function renderPrompt(template, vars) {
  return String(template).replace(/\{\{(\w+)\}\}/g, (_, key) => String(vars[key] ?? ''));
}

function corsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, X-Gemini-Key, X-Gemini-Model, Authorization'
  );
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function json(res, status, obj) {
  corsHeaders(res);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

/** Google Search 연동 + 사진·글 — 제품 파악 후 번개·당근용 검색어 한 줄 (브랜드/제품 예시 없음) */
function buildWebGroundedSearchQueryPrompt(title, body, imageCount) {
  const t = String(title || '').slice(0, 500);
  const b = String(body || '').replace(/\s+/g, ' ').trim().slice(0, 1200);
  const n = Number(imageCount) || 0;
  const media =
    n > 0
      ? `상품 사진 ${n}장이 이 메시지에 첨부되어 있습니다.\n`
      : '사진이 없습니다. 제목·본문과 웹 검색으로 판단하세요.\n';
  return renderPrompt(PROMPTS.searchQuerySingle, {
    media,
    title: t,
    body: b || '(없음)',
    MAX_SEARCH_QUERY_CHARS,
  });
}

/** Google Search 연동 + 사진·글 — 품질 확인/자동 선택용 검색 후보 최대 3개 */
function buildWebGroundedSearchCandidatesPrompt(title, body, imageCount, maxQueries = 3) {
  const t = String(title || '').slice(0, 500);
  const b = String(body || '').replace(/\s+/g, ' ').trim().slice(0, 1200);
  const n = Number(imageCount) || 0;
  const max = Math.min(Math.max(Number(maxQueries) || 3, 1), 3);
  const media =
    n > 0
      ? `상품 사진 ${n}장이 이 메시지에 첨부되어 있습니다.\n`
      : '사진이 없습니다. 제목·본문과 웹 검색으로 판단하세요.\n';
  return renderPrompt(PROMPTS.searchQueryCandidates, {
    media,
    max,
    title: t,
    body: b || '(없음)',
    MAX_SEARCH_QUERY_CHARS,
  });
}

function buildProductSummaryPrompt(title, body, imageCount) {
  const t = String(title || '').slice(0, 500);
  const b = String(body || '').replace(/\s+/g, ' ').trim().slice(0, 1600);
  const n = Number(imageCount) || 0;
  const media =
    n > 0
      ? `상품 사진 ${n}장이 이 메시지에 첨부되어 있습니다.\n`
      : '사진이 없습니다. 제목·본문과 웹 검색으로 판단하세요.\n';
  return renderPrompt(PROMPTS.productSummary, {
    media,
    title: t,
    body: b || '(없음)',
  });
}

function buildProductIdentifyPrompt(title, body, imageCount) {
  const t = String(title || '').slice(0, 500);
  const b = String(body || '').replace(/\s+/g, ' ').trim().slice(0, 1200);
  const n = Number(imageCount) || 0;
  const media =
    n > 0
      ? `상품 사진 ${n}장이 이 메시지에 첨부되어 있습니다.\n`
      : '사진이 없습니다. 제목·본문으로 판단하세요.\n';
  return renderPrompt(PROMPTS.productIdentify, {
    media,
    title: t,
    body: b || '(없음)',
  });
}

function buildProductRiskPrompt({ productName, summary, title, body }) {
  const name = String(productName || summary?.productName || '')
    .replace(/\s+/g, ' ')
    .trim();
  return renderPrompt(PROMPTS.productRisk, {
    productName: name || '(불명)',
    description: String(summary?.description || '').replace(/\s+/g, ' ').trim() || '(없음)',
    makerOrSeller: String(summary?.makerOrSeller || '').replace(/\s+/g, ' ').trim() || '(없음)',
    newPrice: String(summary?.newPrice || '').replace(/\s+/g, ' ').trim() || '(없음)',
    title: String(title || '').replace(/\s+/g, ' ').trim().slice(0, 500) || '(없음)',
    body: String(body || '').replace(/\s+/g, ' ').trim().slice(0, 1800) || '(없음)',
  });
}

function buildProductRiskJsonPrompt({ productName, researchText }) {
  const name = String(productName || '').replace(/\s+/g, ' ').trim();
  return renderPrompt(PROMPTS.productRiskJson, {
    productName: name || '(불명)',
    researchText: String(researchText || '').trim() || '(조사 메모 없음)',
  });
}

/** AI 검색어가 제목 앞부분만 잘린 것 같으면 제목 기반으로 보정 */
function sanitizeQueryFromListing(query, title) {
  const q = String(query || '').trim();
  const t = String(title || '')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!q || !t || q.length >= t.length) return q;
  if (t.startsWith(q) && t.length > q.length + 2) {
    const compactTitle = stripSellerNoiseFromQuery(t);
    if (compactTitle && compactTitle.length > q.length && compactTitle.startsWith(q)) return compactTitle;
  }
  return q;
}

function stripUsedMarketWord(raw) {
  return String(raw || '')
    .replace(/(^|\s)중고(?=\s|$)/g, ' ')
    .replace(/중고$/g, '')
    .replace(/(^|\s)가격(?=\s|$)/g, ' ')
    .replace(/가격$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripSellerNoiseFromQuery(raw) {
  let s = String(raw || '');
  const noiseWords =
    '새상품|미개봉|단순\\s*개봉|개봉만|개봉|급처|네고|택포|직거래|택배|배송|교환|환불|판매|팝니다|팔아요|구매|구입|인증|가능|불가|원하시면|원하신다면|찾는다면|좋습니다|드립니다|드려요|상태|컨디션|외관|기스|찍힘|하자|사용감|사용|실사용|시착|착용|보관|구성품|구성|포함|더스트|관련텍|부속|부분가죽|색상|사이즈|가격|저렴|깨끗|오늘|방금';
  s = s
    .replace(new RegExp(`\\([^)]*(?:${noiseWords})[^)]*\\)`, 'gi'), ' ')
    .replace(new RegExp(`（[^）]*(?:${noiseWords})[^）]*）`, 'gi'), ' ');
  s = s
    .replace(new RegExp(`\\s*(?:${noiseWords}).*`, 'i'), '')
    .replace(/\s+/g, ' ')
    .trim();
  return s;
}

function normalizeQueryCandidate(raw, title) {
  let s = String(raw || '')
    .replace(/```(?:json)?/gi, ' ')
    .replace(/```/g, ' ')
    .replace(/^[-*•\d.]+\s*/, '')
    .replace(/^["'`「」]|["'`「」]$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s || /^json$/i.test(s) || /^[{\[]/.test(s) || /["']?queries["']?\s*:/.test(s)) return '';
  if (/^\]?\}?$/.test(s) || /^[}\]],?$/.test(s)) return '';
  s = stripSellerNoiseFromQuery(s)
    .replace(/(^|\s)중고(?=\s|$)/g, ' ')
    .replace(/중고$/g, '')
    .replace(/\([^)]{4,}\)/g, ' ')
    .replace(/（[^）]{4,}）/g, ' ')
    .replace(/[~!@#]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (title && s === String(title).replace(/\s+/g, ' ').trim()) {
    const compact = stripSellerNoiseFromQuery(s);
    if (compact.length >= 2) s = compact;
  }
  s = sanitizeQueryFromListing(clampQuery(s), title);
  s = stripUsedMarketWord(s);
  s = clampQuery(s);
  if (!s || s === '중고') return '';
  if (!/[\uAC00-\uD7A3]/.test(s)) return '';
  if (/[.!?。]|입니다|검색결과|검색 결과|사진과|판매자/.test(s)) return '';
  if (s.length < 2) return '';
  return s;
}

function parseQueryCandidates(text, title, maxQueries = 3) {
  const max = Math.min(Math.max(Number(maxQueries) || 3, 1), 3);
  const raw = String(text || '').trim();
  const candidates = [];

  let jsonText = raw
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
  const objMatch = jsonText.match(/\{[\s\S]*\}/);
  if (objMatch) jsonText = objMatch[0];
  try {
    const parsed = JSON.parse(jsonText);
    const arr = Array.isArray(parsed) ? parsed : parsed?.queries;
    if (Array.isArray(arr)) candidates.push(...arr);
  } catch {
    const queryArrayMatch = raw.match(/["']?queries["']?\s*:\s*\[([\s\S]*?)\]/i);
    if (queryArrayMatch) {
      const inner = queryArrayMatch[1];
      const quoted = [...inner.matchAll(/["']([^"']{2,120})["']/g)].map((m) => m[1]);
      candidates.push(...quoted);
    }
  }

  if (!candidates.length) {
    const lines = raw
      .replace(/```(?:json)?/gi, '\n')
      .replace(/[{}\[\]"]/g, ' ')
      .split(/\r?\n|[,，]/)
      .map((x) => x.trim())
      .filter(Boolean);
    candidates.push(...lines);
  }

  const out = [];
  const seen = new Set();
  for (const item of candidates) {
    const q = normalizeQueryCandidate(item, title);
    const key = q.replace(/\s+/g, '').toLowerCase();
    if (!q || seen.has(key)) continue;
    seen.add(key);
    out.push(q);
    if (out.length >= max) break;
  }

  const fallback = normalizeQueryCandidate(title, title);
  if (!out.length && fallback) out.push(fallback);
  return out;
}

const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';

function clampQuery(q) {
  const max = MAX_SEARCH_QUERY_CHARS;
  const OVER = 48; // max 경계가 한글 낱말·모델명 중간일 때 끝까지 보완(상한 초과 허용폭)
  const H = /[\uAC00-\uD7A3]/;

  let s = String(q || '')
    .split(/\r?\n/)[0]
    .replace(/^["'`「」]|["'`「」]$/g, '')
    .trim();
  if (!s) return '중고';
  if (s.length <= max) return s;

  /** slice(max) 직후 글자부터 공백 전까지 한 덩어리(한글 연속·숫자 등)면 끝까지 포함 */
  let end = max;
  while (end < s.length && end < max + OVER) {
    const prev = s[end - 1];
    const curr = s[end];
    if (!curr) break;
    if (/\s/.test(curr)) break;
    const pH = H.test(prev);
    const cH = H.test(curr);
    if (pH && cH) {
      end += 1;
      continue;
    }
    if (pH && /\d/.test(curr)) {
      end += 1;
      continue;
    }
    if (/\d/.test(prev) && /\d/.test(curr)) {
      end += 1;
      continue;
    }
    if (/[A-Za-z]/.test(prev) && /[A-Za-z]/.test(curr)) {
      end += 1;
      continue;
    }
    break;
  }

  let out = s.slice(0, end).trim();

  if (out.length > max + OVER) {
    let hard = s.slice(0, max);
    const sp = hard.lastIndexOf(' ');
    if (sp > max * 0.35) hard = hard.slice(0, sp);
    out = hard.replace(/\s+\S*$/, '').trim() || hard.trim();
  }

  return out || '중고';
}

const MAX_INLINE_IMAGES = 3;
const LISTING_IMAGE_ANALYSIS_BATCH_SIZE = 10;
const MAX_IMAGE_BYTES = 1.2 * 1024 * 1024;
const IMAGE_FETCH_TIMEOUT_MS = 6_000;
const IMAGE_SEARCH_TIMEOUT_MS = 8_000;
const PRODUCT_IMAGE_VALIDATE_TIMEOUT_MS = 5_000;
const GEMINI_FAST_TIMEOUT_MS = 30_000;
const GEMINI_GROUNDED_TIMEOUT_MS = 75_000;
const GEMINI_PRODUCT_TIMEOUT_MS = 90_000;

function isAllowedListingImageUrl(u) {
  try {
    const x = new URL(String(u).trim());
    if (x.protocol !== 'https:' && x.protocol !== 'http:') return false;
    const host = x.hostname.toLowerCase();
    if (host === 'localhost' || host === '0.0.0.0') return false;
    if (/^(127\.|10\.|192\.168\.)/.test(host)) return false;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return false;
    return true;
  } catch {
    return false;
  }
}

function refererForImageUrl(u) {
  try {
    const h = new URL(u).hostname.toLowerCase();
    if (h.includes('bunjang')) return 'https://m.bunjang.co.kr/';
    if (h.includes('daangn') || h.includes('karrot') || h.includes('gcp-karroter')) return 'https://www.daangn.com/';
    return 'https://m.bunjang.co.kr/';
  } catch {
    return 'https://m.bunjang.co.kr/';
  }
}

function optimizeImageUrlForAi(url) {
  let s = String(url || '').trim();
  // 번개 이미지는 파일명에 폭이 들어오는 경우가 많아, 제품 식별에는 충분한 400px급으로 낮춘다.
  s = s.replace(/_w\d+\.(webp|jpg|jpeg|png)(?=$|[?#])/i, '_w400.$1');
  s = s.replace(/([?&](?:w|width|size)=)\d+/i, '$1400');
  return s;
}

/** Gemini REST: { inline_data: { mime_type, data: base64 } } */
async function fetchImageUrlToInlinePart(url) {
  const imageUrl = optimizeImageUrlForAi(url);
  const res = await fetch(imageUrl, {
    redirect: 'follow',
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0 Safari/537.36',
      Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      Referer: refererForImageUrl(imageUrl),
    },
    signal: AbortSignal.timeout(IMAGE_FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`이미지 HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_IMAGE_BYTES) throw new Error('이미지 용량 초과');
  let mime = res.headers.get('content-type')?.split(';')[0]?.trim() || '';
  if (!mime.startsWith('image/')) {
    const p = String(imageUrl).toLowerCase();
    if (p.includes('.png')) mime = 'image/png';
    else if (p.includes('.webp')) mime = 'image/webp';
    else if (p.includes('.gif')) mime = 'image/gif';
    else mime = 'image/jpeg';
  }
  return {
    inline_data: {
      mime_type: mime,
      data: buf.toString('base64'),
    },
  };
}

function readImageDimensionsFromBuffer(buf) {
  if (!buf || buf.length < 24) return { width: 0, height: 0 };
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    const width = buf.readUInt32BE(16);
    const height = buf.readUInt32BE(20);
    if (width > 0 && height > 0 && width < 20000 && height < 20000) {
      return { width, height };
    }
  }
  for (let i = 2; i < buf.length - 9; i++) {
    if (buf[i] === 0xff && buf[i + 1] === 0xd8) return { width: 0, height: 0 };
    if (buf[i] === 0xff && (buf[i + 1] === 0xc0 || buf[i + 1] === 0xc2 || buf[i + 1] === 0xc1)) {
      const height = buf.readUInt16BE(i + 5);
      const width = buf.readUInt16BE(i + 7);
      if (width > 0 && height > 0 && width < 20000 && height < 20000) {
        return { width, height };
      }
    }
  }
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 && buf[12] === 0x56 && buf[13] === 0x50) {
    const width = buf.readUInt16LE(26) & 0x3fff;
    const height = buf.readUInt16LE(28) & 0x3fff;
    if (width > 0 && height > 0) return { width, height };
  }
  return { width: 0, height: 0 };
}

async function fetchImageUrlToInlineSource(url) {
  const imageUrl = optimizeImageUrlForAi(url);
  const res = await fetch(imageUrl, {
    redirect: 'follow',
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0 Safari/537.36',
      Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      Referer: refererForImageUrl(imageUrl),
    },
    signal: AbortSignal.timeout(IMAGE_FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`이미지 HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_IMAGE_BYTES) throw new Error('이미지 용량 초과');
  let mime = res.headers.get('content-type')?.split(';')[0]?.trim() || '';
  if (!mime.startsWith('image/')) {
    const p = String(imageUrl).toLowerCase();
    if (p.includes('.png')) mime = 'image/png';
    else if (p.includes('.webp')) mime = 'image/webp';
    else if (p.includes('.gif')) mime = 'image/gif';
    else mime = 'image/jpeg';
  }
  const { width, height } = readImageDimensionsFromBuffer(buf);
  return {
    part: {
      inline_data: {
        mime_type: mime,
        data: buf.toString('base64'),
      },
    },
    width,
    height,
  };
}

function listingImageAnalysisBatches(sources) {
  const list = Array.isArray(sources) ? sources : [];
  const batches = [];
  for (let i = 0; i < list.length; i += LISTING_IMAGE_ANALYSIS_BATCH_SIZE) {
    batches.push(list.slice(i, i + LISTING_IMAGE_ANALYSIS_BATCH_SIZE));
  }
  return batches;
}

async function fetchListingImageInlineParts(urls) {
  const list = Array.isArray(urls) ? urls : [];
  const targets = [];
  for (const raw of list) {
    if (targets.length >= MAX_INLINE_IMAGES) break;
    const u = String(raw || '').trim();
    if (!u || !isAllowedListingImageUrl(u)) continue;
    targets.push(u);
  }
  const settled = await Promise.allSettled(targets.map((u) => fetchImageUrlToInlineSource(u)));
  const parts = [];
  for (let i = 0; i < settled.length; i += 1) {
    const r = settled[i];
    if (r.status === 'fulfilled') {
      parts.push(r.value.part);
      continue;
    }
    const u = targets[i] || '';
    console.warn('[search-query] 이미지 로드 생략:', u.slice(0, 80), r.reason instanceof Error ? r.reason.message : r.reason);
  }
  return parts;
}

async function fetchListingImageSources(urls, maxImages = Infinity) {
  const list = Array.isArray(urls) ? urls : [];
  const targets = [];
  const n = Number(maxImages);
  const limit = Number.isFinite(n) ? Math.max(1, n) : Infinity;
  for (let sourceIndex = 0; sourceIndex < list.length; sourceIndex += 1) {
    const raw = list[sourceIndex];
    if (targets.length >= limit) break;
    const u = String(raw || '').trim();
    if (!u || !isAllowedListingImageUrl(u)) continue;
    targets.push({ url: u, index: sourceIndex + 1 });
  }
  const settled = await Promise.allSettled(targets.map((t) => fetchImageUrlToInlineSource(t.url)));
  const sources = [];
  for (let i = 0; i < settled.length; i += 1) {
    const r = settled[i];
    const target = targets[i] || {};
    if (r.status === 'fulfilled') {
      sources.push({ ...r.value, index: target.index, url: target.url });
      continue;
    }
    const u = target.url || '';
    console.warn('[listing-image] 이미지 로드 생략:', u.slice(0, 80), r.reason instanceof Error ? r.reason.message : r.reason);
  }
  return sources;
}

function looksUsableQuery(query, title) {
  const q = normalizeQueryCandidate(query, title);
  if (!q) return false;
  if (q.length > 48) return false;
  if (/\s(?:판매|팝니다|구매|구입|배송|택배|상태|사용|개봉|인증)\b/i.test(q)) return false;
  return true;
}

function looksUsableCandidates(text, title, maxQueries = 3) {
  const queries = parseQueryCandidates(text, title, maxQueries);
  return queries.length > 0 && queries.some((q) => looksUsableQuery(q, title));
}

function extractGeminiText(data) {
  const cand = data?.candidates?.[0];
  if (!cand) return '';
  const parts = cand.content?.parts;
  const text =
    parts?.map((p) => p.text).filter(Boolean).join('') ||
    parts?.[0]?.text ||
    '';
  if (text) return text;
  const reason = cand.finishReason || cand.finish_reason;
  if (reason && reason !== 'STOP') {
    throw new Error(`Gemini 응답 없음 (${reason})`);
  }
  return '';
}

function normalizeProductImageUrl(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  try {
    const u = new URL(s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    return u.href;
  } catch {
    return '';
  }
}

function uniqueImageUrls(urls) {
  const out = [];
  const seen = new Set();
  for (const raw of urls || []) {
    const u = normalizeProductImageUrl(raw);
    if (!u || seen.has(u)) continue;
    seen.add(u);
    out.push(u);
  }
  return out;
}

function productImageProxyUrl(raw) {
  const u = normalizeProductImageUrl(raw);
  return u ? `/api/image-proxy?url=${encodeURIComponent(u)}` : '';
}

function productImageTerms(...values) {
  const stop = new Set([
    '중고',
    '제품',
    '이미지',
    '한글판',
    '한국판',
    '정품',
    '카드',
    '키',
    '닌텐도',
    '스위치',
    'switch',
    'nintendo',
  ]);
  const text = values
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .replace(/[()[\]{}"'`「」:：,，]/g, ' ');
  const words = text.match(/[a-z0-9]{3,}|[\uac00-\ud7a3]{2,}/g) || [];
  const out = [];
  const seen = new Set();
  for (const word of words) {
    if (stop.has(word) || seen.has(word)) continue;
    seen.add(word);
    out.push(word);
    if (out.length >= 4) break;
  }
  return out;
}

function scoreProductImageResult(result, terms) {
  const hay = `${result?.title || ''} ${result?.url || ''} ${result?.image || ''}`.toLowerCase();
  let score = 0;
  for (const term of terms) {
    if (hay.includes(term)) score += 4;
  }
  const w = Number(result?.width) || 0;
  const h = Number(result?.height) || 0;
  if (w >= 300 && h >= 300) score += 2;
  if (w >= 700 && h >= 700) score += 1;
  if (/official|공식|store|shop|nintendo|pokemon|포켓몬/.test(hay)) score += 1;
  if (/adservice|doubleclick|sprite|logo|icon|avatar|profile|banner/i.test(hay)) score -= 5;
  return score;
}

async function isReachableProductImage(raw) {
  const u = normalizeProductImageUrl(raw);
  if (!u) return false;
  try {
    const res = await fetch(u, {
      redirect: 'follow',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0 Safari/537.36',
        Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
        Referer: new URL(u).origin,
      },
      signal: AbortSignal.timeout(PRODUCT_IMAGE_VALIDATE_TIMEOUT_MS),
    });
    if (!res.ok) return false;
    const type = res.headers.get('content-type') || '';
    if (!type.startsWith('image/')) return false;
    const len = Number(res.headers.get('content-length')) || 0;
    if (len && len < 1024) return false;
    return true;
  } catch {
    return false;
  }
}

async function fetchDuckDuckGoImageUrls(query, terms = []) {
  const q = String(query || '').trim();
  if (!q) return [];
  const headers = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0 Safari/537.36',
    Accept: 'text/html,application/json,*/*',
  };
  const searchUrl = `https://duckduckgo.com/?q=${encodeURIComponent(q)}&iax=images&ia=images`;
  const htmlRes = await fetch(searchUrl, {
    headers,
    signal: AbortSignal.timeout(IMAGE_SEARCH_TIMEOUT_MS),
  });
  const html = await htmlRes.text();
  const vqd =
    html.match(/vqd=["']?([\d-]+)["']?/)?.[1] ||
    html.match(/'vqd'\s*:\s*'([\d-]+)'/)?.[1] ||
    '';
  if (!vqd) return [];
  const apiUrl = `https://duckduckgo.com/i.js?l=kr-kr&o=json&q=${encodeURIComponent(q)}&vqd=${encodeURIComponent(vqd)}&f=,,,&p=1`;
  const res = await fetch(apiUrl, {
    headers: { ...headers, Referer: searchUrl },
    signal: AbortSignal.timeout(IMAGE_SEARCH_TIMEOUT_MS),
  });
  if (!res.ok) return [];
  const data = await res.json().catch(() => ({}));
  const results = Array.isArray(data?.results) ? data.results : [];
  const ranked = results
    .map((x) => ({ ...x, imageUrl: normalizeProductImageUrl(x.image || x.thumbnail), score: scoreProductImageResult(x, terms) }))
    .filter((x) => x.imageUrl && (!terms.length || x.score > 0))
    .sort((a, b) => b.score - a.score)
    .slice(0, 12);
  const out = [];
  for (const item of ranked) {
    if (await isReachableProductImage(item.imageUrl)) out.push(item.imageUrl);
    if (out.length >= 4) break;
  }
  return uniqueImageUrls(out);
}

function cleanProductName(raw, fallback = '') {
  let s = String(raw || fallback || '')
    .replace(/```(?:json)?/gi, ' ')
    .replace(/["'`「」]/g, '')
    .replace(/\bproductName\b\s*[:：]\s*/i, '')
    .replace(/\bsearchQuery\b\s*[:：].*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  const openParen = Math.max(s.lastIndexOf('('), s.lastIndexOf('（'), s.lastIndexOf('['), s.lastIndexOf('［'));
  const closeParen = Math.max(s.lastIndexOf(')'), s.lastIndexOf('）'), s.lastIndexOf(']'), s.lastIndexOf('］'));
  if (openParen >= 0 && closeParen < openParen) s = s.slice(0, openParen).trim();
  s = s
    .replace(/[({（［\[]+\s*$/g, '')
    .replace(/\s*[,，:：]\s*$/g, '')
    .trim();
  return preserveVariantTokens(s || String(fallback || '').trim(), fallback);
}

function preserveVariantTokens(productName, fallback = '') {
  let out = String(productName || '').trim();
  const source = String(fallback || '').replace(/\s+/g, ' ').trim();
  if (!out || !source) return out;

  const protectedTokens = [
    { re: /\bOLED\b/i, token: 'OLED' },
    { re: /\bPRO\b/i, token: 'Pro' },
    { re: /\bPLUS\b/i, token: 'Plus' },
    { re: /\bMAX\b/i, token: 'Max' },
    { re: /\bLITE\b/i, token: 'Lite' },
  ];
  for (const { re, token } of protectedTokens) {
    if (re.test(source) && !re.test(out)) {
      out = `${out} ${token}`.replace(/\s+/g, ' ').trim();
    }
  }

  const sourceHasSwitch2 = /(?:스위치|switch)\s*2\b/i.test(source);
  const outputHasSwitch = /(?:스위치|switch)\b/i.test(out);
  const outputHasSwitch2 = /(?:스위치|switch)\s*2\b/i.test(out);
  if (sourceHasSwitch2 && outputHasSwitch && !outputHasSwitch2) {
    out = out
      .replace(/스위치(?!\s*2\b)/i, '스위치 2')
      .replace(/\bSwitch(?!\s*2\b)/i, 'Switch 2')
      .replace(/\s+/g, ' ')
      .trim();
  }

  return out;
}

function parseProductSummary(text, fallbackTitle) {
  const raw = String(text || '').trim();
  let jsonText = raw
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
  const objMatch = jsonText.match(/\{[\s\S]*\}/);
  if (objMatch) jsonText = objMatch[0];

  let parsed = {};
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    parsed = {};
  }

  if (!Object.keys(parsed).length && raw) {
    const keyMap = {
      productName: 'productName',
      newPrice: 'newPrice',
      description: 'description',
      makerOrSeller: 'makerOrSeller',
      searchQuery: 'searchQuery',
      searchQueries: 'searchQueries',
      newPriceSourceUrl: 'newPriceSourceUrl',
      productImageUrl: 'productImageUrl',
    };
    const keyPattern = Object.keys(keyMap).join('|');
    const re = new RegExp(`(?:^|[\\n,])\\s*["']?(${keyPattern})["']?\\s*[:：]\\s*([^\\n]+)`, 'gi');
    for (const match of raw.matchAll(re)) {
      const rawKey = Object.keys(keyMap).find((k) => k.toLowerCase() === String(match[1]).toLowerCase());
      const key = keyMap[rawKey];
      const value = String(match[2] || '')
        .replace(/^["'`「」]+|["'`「」]+$/g, '')
        .replace(/,\s*$/, '')
        .trim();
      if (key && value) parsed[key] = value;
    }
  }

  const productName = cleanProductName(parsed.productName, fallbackTitle);
  const parsedQueries = Array.isArray(parsed.searchQueries)
    ? parsed.searchQueries
    : typeof parsed.searchQueries === 'string'
      ? parsed.searchQueries.split(/\s*(?:[,，;；]|\n)\s*/g)
      : [];
  const rawAsDescription = raw
    .replace(/```(?:json)?/gi, ' ')
    .replace(
      new RegExp(
        `(?:productName|newPrice|description|makerOrSeller|searchQuery|searchQueries|newPriceSourceUrl|productImageUrl)\\s*[:：]`,
        'gi'
      ),
      ' '
    )
    .replace(/[{}[\]"]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const searchQuery =
    (parsedQueries.length ? parseQueryCandidates(JSON.stringify({ queries: parsedQueries }), productName || fallbackTitle, 4)[0] : '') ||
    normalizeQueryCandidate(parsed.searchQuery, productName || fallbackTitle) ||
    normalizeQueryCandidate(productName, fallbackTitle) ||
    normalizeQueryCandidate(fallbackTitle, fallbackTitle);
  const searchQueries = parseQueryCandidates(
    JSON.stringify({ queries: parsedQueries.length ? parsedQueries : [searchQuery] }),
    productName || fallbackTitle,
    4
  );

  return {
    productName,
    newPrice: String(parsed.newPrice || '').trim(),
    description: String(parsed.description || (!parsed.productName && rawAsDescription ? rawAsDescription.slice(0, 220) : '')).trim(),
    makerOrSeller: String(parsed.makerOrSeller || '').trim(),
    searchQuery,
    searchQueries,
    newPriceSourceUrl: normalizeProductImageUrl(parsed.newPriceSourceUrl),
    productImageUrl: normalizeProductImageUrl(parsed.productImageUrl),
  };
}

function normalizeRiskItems(items) {
  const source = Array.isArray(items) ? items : [];
  return source
    .map((item) => {
      if (typeof item === 'string') {
        return { title: item, detail: item, level: 'caution' };
      }
      const title = String(item?.title || '').replace(/\s+/g, ' ').trim();
      const detail = String(item?.detail || item?.desc || '').replace(/\s+/g, ' ').trim();
      const rawLevel = String(item?.level || 'caution').toLowerCase();
      const level = ['safe', 'caution', 'risk'].includes(rawLevel) ? rawLevel : 'caution';
      if (!title || !detail) return null;
      return { title, detail, level };
    })
    .filter(Boolean)
    .slice(0, 3);
}

function parseProductRisk(text, productName = '') {
  const raw = String(text || '').trim();
  const name = String(productName || '제품').replace(/\s+/g, ' ').trim();
  let jsonText = raw
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
  const objMatch = jsonText.match(/\{[\s\S]*\}/);
  if (objMatch) jsonText = objMatch[0];

  let parsed = {};
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    parsed = {};
  }

  const relatedIssues = normalizeRiskItems(parsed.relatedIssues);
  const chronicDefects = normalizeRiskItems(parsed.chronicDefects);
  return {
    relatedIssues,
    chronicDefects,
    verdict: String(parsed.verdict || '').replace(/\s+/g, ' ').trim(),
    parseOk: Boolean(relatedIssues.length || chronicDefects.length || parsed.verdict),
  };
}

function parseJsonObject(text) {
  const raw = String(text || '').trim();
  let jsonText = raw
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
  const objMatch = jsonText.match(/\{[\s\S]*\}/);
  if (objMatch) jsonText = objMatch[0];
  try {
    return JSON.parse(jsonText);
  } catch {
    return {};
  }
}

function normalizeShortList(items, limit = 3) {
  return (Array.isArray(items) ? items : [])
    .map((x) => String(x || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, limit);
}

function recoverJsonStringField(text, key) {
  const match = String(text || '').match(
    new RegExp(`"${key}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`),
  );
  if (!match) return '';
  try {
    return JSON.parse(`"${match[1]}"`).replace(/\s+/g, ' ').trim();
  } catch {
    return match[1].replace(/\\"/g, '"').replace(/\\n/g, ' ').replace(/\s+/g, ' ').trim();
  }
}

function parseListingTextAnalysis(text) {
  const parsed = parseJsonObject(text);
  const sellerVerdict = String(parsed.sellerVerdict || recoverJsonStringField(text, 'sellerVerdict'))
    .replace(/\s+/g, ' ')
    .trim();
  const bodyVerdict = String(
    parsed.bodyVerdict || parsed.body || recoverJsonStringField(text, 'bodyVerdict') || recoverJsonStringField(text, 'body'),
  )
    .replace(/\s+/g, ' ')
    .trim();
  const overall = String(parsed.overall || recoverJsonStringField(text, 'overall') || bodyVerdict)
    .replace(/\s+/g, ' ')
    .trim();
  return {
    sellerVerdict,
    bodyVerdict,
    redFlags: normalizeShortList(parsed.redFlags, 5),
    overall,
    parseOk: Boolean(sellerVerdict || bodyVerdict || overall || parsed.redFlags),
  };
}

function normalizeImageLevel(raw) {
  const level = String(raw || 'neutral').toLowerCase();
  return ['safe', 'caution', 'risk', 'neutral'].includes(level) ? level : 'neutral';
}

function cleanUpstreamErrorText(text, fallback = '외부 AI 서버 오류') {
  const raw = String(text || '').trim();
  if (!raw) return fallback;
  if (/<!doctype|<html|<title>/i.test(raw)) {
    const title = raw.match(/<title>([^<]+)<\/title>/i)?.[1]?.trim();
    return title || fallback;
  }
  return raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 220) || fallback;
}

function normalizeImageLabel(raw, level = 'neutral') {
  const value = String(raw || '').replace(/\s+/g, ' ').trim();
  if (value) return value.slice(0, 14);
  if (level === 'risk') return '주의 사진';
  if (level === 'caution') return '확인 필요';
  if (level === 'safe') return '상태 확인';
  return '사진 근거';
}

function parseListingImageAnalysis(text, imageUrls = [], sourceMeta = []) {
  const parsed = parseJsonObject(text);
  const source = Array.isArray(parsed.images) ? parsed.images : [];
  const images = source
    .map((item, idx) => {
      const index = Math.max(1, Math.min(Number(item?.index) || idx + 1, imageUrls.length || idx + 1));
      const comment = String(item?.comment || item?.detail || '').replace(/\s+/g, ' ').trim();
      if (!comment) return null;
      const meta = sourceMeta[index - 1] || {};
      const imageWidth = Number(item?.width) || Number(meta?.width) || 0;
      const imageHeight = Number(item?.height) || Number(meta?.height) || 0;
      const level = normalizeImageLevel(item?.level);
      return {
        index,
        imageUrl: imageUrls[index - 1] || '',
        imageWidth,
        imageHeight,
        label: normalizeImageLabel(item?.label || item?.role || item?.tag, level),
        comment,
        level,
      };
    })
    .filter(Boolean)
    .slice(0, imageUrls.length || source.length);
  return {
    images,
    overall: String(parsed.overall || '').replace(/\s+/g, ' ').trim(),
    parseOk: Boolean(images.length || parsed.overall),
  };
}

/** @param {object[]} parts Gemini user message parts: { text } 또는 { inline_data } */
async function geminiGenerateFromParts(apiKey, model, parts, opts = {}) {
  const m = String(model || DEFAULT_GEMINI_MODEL).replace(/^\s+|\s+$/g, '');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    m
  )}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const temperature = opts.temperature ?? 0.2;
  const payload = {
    contents: [{ role: 'user', parts }],
    generationConfig: {
      temperature,
    },
  };
  if (opts.maxOutputTokens != null) {
    payload.generationConfig.maxOutputTokens = opts.maxOutputTokens;
  }
  if (opts.responseMimeType) {
    payload.generationConfig.responseMimeType = opts.responseMimeType;
  }
  if (opts.useGoogleSearch) {
    payload.tools = [{ google_search: {} }];
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(opts.timeoutMs || GEMINI_FAST_TIMEOUT_MS),
  });
  const raw = await res.text();
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(cleanUpstreamErrorText(raw, `Gemini HTTP ${res.status}`));
  }
  if (!res.ok) {
    const msg = data?.error?.message || data?.message || JSON.stringify(data).slice(0, 200);
    throw new Error(cleanUpstreamErrorText(msg, `Gemini HTTP ${res.status}`));
  }
  const text = extractGeminiText(data);
  if (!text) throw new Error('Gemini 응답에 텍스트가 없습니다.');
  return text;
}

async function runWebGroundedSearchQuery(apiKey, model, title, body, inlineParts) {
  const prompt = buildWebGroundedSearchQueryPrompt(title, body, inlineParts.length);
  const parts =
    inlineParts.length > 0 ? [{ text: prompt }, ...inlineParts] : [{ text: prompt }];

  try {
    const fastText = await geminiGenerateFromParts(apiKey, model, parts, {
      temperature: 0.2,
      maxOutputTokens: 160,
      timeoutMs: GEMINI_FAST_TIMEOUT_MS,
    });
    if (looksUsableQuery(fastText, title)) return { text: fastText, pipeline: 'multimodal_fast' };
  } catch (e) {
    console.warn('[search-query] 빠른 멀티모달 실패, Google Search 재시도:', e instanceof Error ? e.message : e);
  }

  const text = await geminiGenerateFromParts(apiKey, model, parts, {
    useGoogleSearch: true,
    temperature: 0.2,
    maxOutputTokens: 256,
    timeoutMs: GEMINI_GROUNDED_TIMEOUT_MS,
  });
  return { text, pipeline: 'google_search_fallback' };
}

async function runWebGroundedSearchCandidates(apiKey, model, title, body, inlineParts, maxQueries = 3) {
  const prompt = buildWebGroundedSearchCandidatesPrompt(title, body, inlineParts.length, maxQueries);
  const parts =
    inlineParts.length > 0 ? [{ text: prompt }, ...inlineParts] : [{ text: prompt }];

  try {
    const fastText = await geminiGenerateFromParts(apiKey, model, parts, {
      temperature: 0.25,
      maxOutputTokens: 220,
      timeoutMs: GEMINI_FAST_TIMEOUT_MS,
    });
    if (looksUsableCandidates(fastText, title, maxQueries)) {
      return { text: fastText, pipeline: 'multimodal_candidates_fast' };
    }
  } catch (e) {
    console.warn(
      '[search-query] 빠른 후보 멀티모달 실패, Google Search 재시도:',
      e instanceof Error ? e.message : e
    );
  }

  const text = await geminiGenerateFromParts(apiKey, model, parts, {
    useGoogleSearch: true,
    temperature: 0.25,
    maxOutputTokens: 320,
    timeoutMs: GEMINI_GROUNDED_TIMEOUT_MS,
  });
  return { text, pipeline: 'google_search_candidates_fallback' };
}

async function runProductSummary(apiKey, model, title, body, inlineParts) {
  const prompt = buildProductSummaryPrompt(title, body, inlineParts.length);
  const parts =
    inlineParts.length > 0 ? [{ text: prompt }, ...inlineParts] : [{ text: prompt }];
  const text = await geminiGenerateFromParts(apiKey, model, parts, {
    useGoogleSearch: true,
    temperature: 0.2,
    maxOutputTokens: 520,
    timeoutMs: GEMINI_GROUNDED_TIMEOUT_MS,
  });
  return text;
}

async function runProductIdentify(apiKey, model, title, body, inlineParts) {
  const prompt = buildProductIdentifyPrompt(title, body, inlineParts.length);
  const parts =
    inlineParts.length > 0 ? [{ text: prompt }, ...inlineParts] : [{ text: prompt }];
  return geminiGenerateFromParts(apiKey, model, parts, {
    useGoogleSearch: true,
    temperature: 0.05,
    timeoutMs: GEMINI_PRODUCT_TIMEOUT_MS,
  });
}

async function runProductInfoLookup(apiKey, model, productName) {
  const name = String(productName || '').trim();
  if (!name) return '';
  const prompt = `
제품명 "${name}"을 Google 검색으로 확인해서 구매 판단용 제품 정보를 JSON으로 정리하세요.
이 단계에서는 제품 식별을 다시 하지 말고, 주어진 제품명에 대한 제품 정보만 찾으세요.
모든 가격과 판매처 정보는 한국 기준을 우선합니다. 한국 닌텐도, 국내 공식몰, 국내 쇼핑몰, 국내 기사/판매 페이지를 우선 검색하세요.
newPrice는 정가만 쓰지 말고 다나와, 네이버쇼핑, 국내 쇼핑몰 검색 결과를 참고한 현재 신품 판매 시세/가격대를 우선하세요.
가격 근거가 약하거나 검색 결과가 서로 크게 다르면 단일 가격처럼 확정하지 말고 "약 n원대", "약 n~m원대", "국내 시세 확인 필요"처럼 보수적으로 적으세요.
가능하면 다나와 상품/검색 결과 URL을 newPriceSourceUrl에 넣으세요.

반드시 JSON만 출력하세요:
{
  "productName": "공식 또는 통용 제품명",
  "newPrice": "한국 기준 신품 정가/판매가/가격대",
  "newPriceSourceUrl": "다나와 상품/검색 결과 URL 또는 빈 문자열",
  "description": "제품 장르·용도·특징을 1~2문장으로 설명",
  "makerOrSeller": "한국 기준 제조사·퍼블리셔·공식 판매처·대표 국내 판매처",
  "searchQuery": "같은 제품을 찾기 좋은 제품명 중심 검색어",
  "searchQueries": ["검색어1", "검색어2"],
  "productImageUrl": "빈 문자열"
}

빈 값을 최소화하세요. 정확한 가격을 모르더라도 국내 검색 결과 기반의 가격대나 정가를 적으세요.
newPrice는 출시 정가보다 현재 국내 신품 판매 시세/최저가/가격대를 우선하세요.
검색 결과의 가격 신뢰도가 낮으면 단일 가격 대신 가격대 또는 확인 필요 문구로 적으세요.
다나와에서 가격을 확인했거나 다나와 검색 결과가 있으면 newPriceSourceUrl에 넣으세요.
해외 가격은 newPrice에 쓰지 마세요. 국내 가격을 못 찾으면 "국내 가격 확인 어려움"이라고 쓰세요.
description에는 "식별했습니다" 같은 처리 결과 문구를 쓰지 말고, 제품 자체의 장르·용도·특징을 쓰세요.
searchQuery/searchQueries에는 "중고", "가격", 상태, 지역, 거래조건을 넣지 말고 브랜드·라인·모델·품목 중심으로만 쓰세요.
searchQueries는 쉼표로 이어 붙이지 말고 배열 항목으로 분리하세요.
검색어는 한국어 표기를 우선하고, 영문명만 단독으로 쓰지 마세요.
`;
  return geminiGenerateFromParts(apiKey, model, [{ text: prompt }], {
    useGoogleSearch: true,
    temperature: 0.15,
    timeoutMs: GEMINI_PRODUCT_TIMEOUT_MS,
  });
}

async function runProductRiskAnalysis(apiKey, model, payload) {
  const researchPrompt = buildProductRiskPrompt(payload);
  const researchText = await geminiGenerateFromParts(apiKey, model, [{ text: researchPrompt }], {
    useGoogleSearch: true,
    temperature: 0.35,
    maxOutputTokens: 2200,
    timeoutMs: GEMINI_GROUNDED_TIMEOUT_MS,
  });
  const jsonPrompt = buildProductRiskJsonPrompt({
    productName: payload.productName,
    researchText,
  });
  const jsonText = await geminiGenerateFromParts(apiKey, model, [{ text: jsonPrompt }], {
    responseMimeType: 'application/json',
    temperature: 0.05,
    maxOutputTokens: 1400,
    timeoutMs: GEMINI_FAST_TIMEOUT_MS,
  });
  return { researchText, jsonText };
}

async function runListingTextAnalysis(apiKey, model, payload) {
  const prompt = `
중고 매물의 판매자 정보와 판매글 본문을, 앞 단계에서 식별한 제품 정보와 관련 이슈/고질병 분석 결과까지 종합해서 분석하세요.
이 단계의 목적은 질문 생성이 아니라 "판매글이 중요한 리스크를 언급했는지/빠뜨렸는지/말하지 않은 부분 때문에 판단이 흐려지는지"를 논리적으로 추론하는 것입니다.
예: 구성품이 필요한 제품인데 본문에 구성품 언급이 없으면 구성품 설명 누락, 특정 고질병이 있는데 판매자가 해당 상태를 언급하지 않으면 리스크 대응 설명 누락, 가격이 신품가 대비 애매하면 가격 근거 불충분처럼 판단하세요.
과장하지 말고, 본문에 근거가 없으면 단정 대신 "언급 없음", "확인 필요"로 표현하세요.
뻔한 일반론(직거래 권장, 사기 조심, 구성품 확인 같은 단독 문장)은 피하고, 반드시 이 매물의 제품명·본문 표현·앞 단계 이슈 중 최소 하나에 연결해 쓰세요.
현재 날짜, 출시일, 미래 시점, 예약/출시 예정 여부를 임의로 만들지 마세요. 본문이나 앞 단계 요약에 명시되지 않은 "2026년", "향후", "출시 전", "미래 시점" 같은 표현은 쓰지 마세요.
제품 세대·모델명도 임의로 바꾸지 마세요. 주어진 제품명과 판매글 제목/본문의 표기를 그대로 기준으로 삼으세요.
sellerVerdict는 평점/판매건수를 칭찬하는 데서 끝내지 말고, 그 지표가 본문 신뢰도 판단에 어떤 한계가 있는지도 함께 보세요.
판매자 정보가 평점·리뷰·판매건수처럼 화면에서 이미 보이는 지표뿐이어도 숫자를 반복하지 말고, 판매자 성격(전문 판매자/일반 판매자 추정)과 본문 설명 품질 사이의 불일치나 신뢰 한계를 AI 판단으로 짧게 쓰세요.
bodyVerdict는 본문에 실제로 있는 표현을 1개 이상 근거로 삼고, 앞 단계 리스크 중 본문이 다루지 않은 항목을 구체적으로 짚으세요.
각 문장은 화면에 그대로 보여줄 수 있도록 핵심 근거와 판단을 함께 적으세요.

제품명: ${String(payload.productName || '')}
제품 요약(JSON): ${JSON.stringify(payload.summary || null)}
앞 단계 제품 이슈/고질병(JSON): ${JSON.stringify(payload.riskAnalysis || null)}
제목: ${String(payload.title || '')}
가격: ${String(payload.priceLabel || '')}
판매자 정보(JSON): ${JSON.stringify(payload.seller || null)}
본문:
${String(payload.body || '').slice(0, 6000)}

반드시 JSON만 출력하세요:
{
  "sellerVerdict": "판매자 지표와 본문 신뢰도를 연결한 짧은 판단 1문장",
  "bodyVerdict": "본문에서 실제로 말한 내용과 말하지 않은 내용을 제품 이슈/고질병과 대조한 판단 1~2문장",
  "redFlags": ["이 매물 본문에서 빠진 핵심 설명 또는 애매한 표현"],
  "overall": "본문·판매자·제품 리스크를 합친 전체 판단 1문장"
}
`;
  return geminiGenerateFromParts(apiKey, model, [{ text: prompt }], {
    responseMimeType: 'application/json',
    temperature: 0.18,
    maxOutputTokens: 1600,
    timeoutMs: GEMINI_GROUNDED_TIMEOUT_MS,
  });
}

async function runListingImageAnalysis(apiKey, model, payload, sources) {
  const list = Array.isArray(sources) ? sources : [];
  const inlineParts = list.map((s) => s?.part).filter(Boolean);
  const imageCount = inlineParts.length;
  const sizeLines = list
    .map((s, i) => {
      const w = Number(s?.width) || 0;
      const h = Number(s?.height) || 0;
      const index = Number(s?.index) || i + 1;
      if (w > 0 && h > 0) return `${index}번 사진: ${w}×${h}px (첨부 순서 ${i + 1}번째 이미지)`;
      return `${index}번 사진: 해상도 미확인 (첨부 순서 ${i + 1}번째 이미지)`;
    })
    .join('\n');
  const prompt = `
중고 매물 사진 ${imageCount}장을 순서대로 확인하고, 각 사진에 대해 짧은 구매 판단 코멘트를 작성하세요.
제품명: ${String(payload.productName || '')}
제목: ${String(payload.title || '')}
본문 참고:
${String(payload.body || '').slice(0, 1800)}

사진 해상도 (첨부 이미지와 동일 순서):
${sizeLines}

규칙:
- images[].index는 위에 적힌 사진 번호를 그대로 쓰세요. 묶음 안 순번이 아니라 전체 매물 사진 번호입니다.
- 가장 먼저 "이 사진이 중고 판매자가 직접 찍은 실물 근거인가?"를 판별하세요. 이 판별이 하자 판단보다 우선입니다.
- 사진 안에 가격, 원가 취소선, 할인율, 쿠폰, 쿠폰보기, 장바구니, 구매하기, 리뷰, 별점, 상품명/가격 카드, 쇼핑몰 상세 UI가 보이면 실제 상품이 함께 보여도 반드시 홍보용·쇼핑몰 스크랩 이미지로 분류하세요.
- 위 경우에는 label을 "홍보 이미지" 또는 "실물 확인 불가"로 쓰고, level은 "caution"으로 쓰세요.
- 홍보용·쇼핑몰 스크랩 이미지에서는 "깨끗해 보입니다", "양호합니다", "오염이나 파손이 없습니다", "구성품이 잘 갖춰져 있습니다", "본문 설명과 일치합니다"처럼 실물 상태를 확인한 듯한 표현을 절대 쓰지 마세요.
- 홍보용·쇼핑몰 스크랩 이미지의 comment는 반드시 "쇼핑몰/홍보용 캡처로 보여 이 사진만으로는 실제 박스·본체·구성품 상태를 확인할 수 없습니다."와 같은 취지로 작성하세요.
- 가격/쿠폰 UI가 없더라도 지나치게 깨끗한 스튜디오/카탈로그 구도, 제품만 단독으로 완벽하게 보이는 공식 렌더·패키지 아트, 손·책상·바닥·주변 배경·실사용 흔적 부재, 본문과 사진 맥락 불일치가 있으면 홍보용·스크랩 가능성을 우선 의심하세요.
- 판매자가 직접 찍은 실물 사진으로 명확할 때만 찍힘/스크래치/오염/구성품 누락/박스 상태를 구체적으로 판단하세요.
- 각 이미지별로 "문제 없어 보입니다", "모서리 찍힘이 의심됩니다", "구성품 확인이 필요합니다"처럼 짧고 구체적으로 작성합니다.
- 확실하지 않으면 단정하지 말고 "의심", "확인 필요"라고 씁니다.
- 사진에서 보이는 하자/오염/찍힘/스크래치/구성품 누락 가능성/박스 상태를 우선 봅니다.
- 사진에서만 알 수 있는 "근거"를 comment에 포함하세요. 예: 구성품이 실제로 보이는지, 박스/케이스 모서리 상태, 광택·오염·흠집 의심, 본문과 사진의 불일치 가능성.
- label은 사진 위 배지로 표시할 짧은 AI 요약명입니다. 사진 내용을 보고 4~10자 한국어로 직접 만드세요. 예: "전면 상태", "구성품 확인", "흠집 의심", "작동 근거", "박스 상태", "사진 부족", "홍보 이미지", "실물 확인 불가", "주의 사진".
- level은 실물 사진에서 상태가 양호하면 safe, 추가 확인이 필요하거나 홍보용·스크랩 이미지라 실물 상태를 알 수 없으면 caution, 실제 하자·불일치가 강하게 보이면 risk, 판단 근거가 거의 없으면 neutral로 쓰세요.
- overall에는 홍보용·스크랩 이미지가 많아 실물 근거가 부족한 경우 그 점을 직접 요약하세요.
- 사진 위치 좌표나 오버레이용 boxes는 만들지 마세요.
- 토큰 절약을 위해 comment는 사진당 1문장으로 쓰세요.

반드시 JSON만 출력하세요:
{
  "images": [
    { "index": 1, "width": 1200, "height": 900, "label": "홍보 이미지", "comment": "쇼핑몰/홍보용 캡처로 보여 이 사진만으로는 실제 박스·본체·구성품 상태를 확인할 수 없습니다.", "level": "safe|caution|risk|neutral" }
  ],
  "overall": "사진 전체 기준 요약 1문장"
}
`;
  return geminiGenerateFromParts(apiKey, model, [{ text: prompt }, ...inlineParts], {
    responseMimeType: 'application/json',
    temperature: 0.15,
    maxOutputTokens: 4096,
    timeoutMs: GEMINI_GROUNDED_TIMEOUT_MS,
  });
}

async function runDirectAiChat(apiKey, model, prompt) {
  const plainTextPrompt = `
사용자 질문에 답하세요.
답변은 일반 텍스트로만 작성하세요. 마크다운 문법을 쓰지 마세요.
특히 **굵게**, # 제목, 글머리표 마크다운, 코드펜스, 백틱을 사용하지 마세요.

사용자 질문:
${String(prompt || '')}
`;
  return geminiGenerateFromParts(apiKey, model, [{ text: plainTextPrompt }], {
    useGoogleSearch: true,
    temperature: 0.35,
    timeoutMs: GEMINI_GROUNDED_TIMEOUT_MS,
  });
}

/** API 키 유효성 + 선택 모델 사용 가능 여부 (REST models 목록) */
async function verifyGeminiApiKey(apiKey, modelId) {
  const key = String(apiKey || '').trim();
  if (!key) throw new Error('API 키가 비었습니다.');
  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`;
  const res = await fetch(url);
  const raw = await res.text();
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(raw.slice(0, 200) || `HTTP ${res.status}`);
  }
  if (!res.ok) {
    const msg = data?.error?.message || data?.message || JSON.stringify(data).slice(0, 200);
    throw new Error(msg);
  }
  const models = data?.models || [];
  if (!models.length) throw new Error('모델 목록을 가져오지 못했습니다. API 키를 확인하세요.');
  const mid = String(modelId || DEFAULT_GEMINI_MODEL).trim();
  const okModel = models.some((m) => {
    const name = m?.name || '';
    return name === `models/${mid}` || name.endsWith(`/${mid}`);
  });
  if (!okModel) {
    const sample = models
      .slice(0, 8)
      .map((m) => m.name?.replace(/^models\//, ''))
      .filter(Boolean)
      .join(', ');
    throw new Error(
      `선택한 모델「${mid}」을(를) 이 API 키로 사용할 수 없습니다. 목록에 있는지 확인하세요. (예: ${sample || '—'})`
    );
  }
  return { ok: true, model: mid };
}

const server = http.createServer(async (req, res) => {
  const host = req.headers.host || `127.0.0.1:${PORT}`;
  const url = new URL(req.url || '/', `http://${host}`);

  if (req.method === 'OPTIONS') {
    corsHeaders(res);
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/verify-gemini') {
    try {
      const apiKey =
        req.headers['x-gemini-key'] ||
        (req.headers.authorization && req.headers.authorization.replace(/^Bearer\s+/i, '')) ||
        '';
      const model = req.headers['x-gemini-model'] || DEFAULT_GEMINI_MODEL;
      if (!String(apiKey).trim()) {
        json(res, 400, { ok: false, error: 'X-Gemini-Key 헤더가 필요합니다.' });
        return;
      }
      const result = await verifyGeminiApiKey(apiKey, model);
      json(res, 200, { ok: true, model: result.model });
    } catch (e) {
      json(res, 401, { ok: false, error: e instanceof Error ? e.message : String(e) });
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/search-query') {
    try {
      const apiKey =
        req.headers['x-gemini-key'] ||
        (req.headers.authorization && req.headers.authorization.replace(/^Bearer\s+/i, '')) ||
        '';
      const model = req.headers['x-gemini-model'] || DEFAULT_GEMINI_MODEL;
      if (!String(apiKey).trim()) {
        json(res, 400, { error: 'X-Gemini-Key 헤더 또는 Authorization: Bearer 가 필요합니다.' });
        return;
      }
      const bodyRaw = await readBody(req);
      let body;
      try {
        body = JSON.parse(bodyRaw || '{}');
      } catch {
        json(res, 400, { error: 'JSON 본문이 올바르지 않습니다.' });
        return;
      }
      const imageUrls = body.imageUrls;
      const inlineParts = await fetchListingImageInlineParts(imageUrls);

      const maxQueries = Math.min(Math.max(Number(body.maxQueries) || 1, 1), 3);
      if (maxQueries > 1) {
        const { text: rawCandidates, pipeline } = await runWebGroundedSearchCandidates(
          apiKey,
          model,
          body.title,
          body.body || '',
          inlineParts,
          maxQueries
        );
        const queries = parseQueryCandidates(rawCandidates, body.title, maxQueries);
        json(res, 200, {
          query: queries[0] || '',
          queries,
          model,
          usedImages: inlineParts.length,
          pipeline,
        });
        return;
      }

      const { text: rawOut, pipeline } = await runWebGroundedSearchQuery(
        apiKey,
        model,
        body.title,
        body.body || '',
        inlineParts
      );
      let query = normalizeQueryCandidate(rawOut, body.title) || clampQuery(rawOut);
      query = sanitizeQueryFromListing(query, body.title);
      query = normalizeQueryCandidate(query, body.title) || clampQuery(query);

      json(res, 200, {
        query,
        model,
        usedImages: inlineParts.length,
        pipeline,
      });
    } catch (e) {
      json(res, 502, { error: e instanceof Error ? e.message : String(e) });
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/product-summary') {
    try {
      const apiKey =
        req.headers['x-gemini-key'] ||
        (req.headers.authorization && req.headers.authorization.replace(/^Bearer\s+/i, '')) ||
        '';
      const model = req.headers['x-gemini-model'] || DEFAULT_GEMINI_MODEL;
      if (!String(apiKey).trim()) {
        json(res, 400, { error: 'X-Gemini-Key 헤더 또는 Authorization: Bearer 가 필요합니다.' });
        return;
      }
      const bodyRaw = await readBody(req);
      let body;
      try {
        body = JSON.parse(bodyRaw || '{}');
      } catch {
        json(res, 400, { error: 'JSON 본문이 올바르지 않습니다.' });
        return;
      }
      const inlineParts = await fetchListingImageInlineParts(body.imageUrls);
      const rawIdentify = await runProductIdentify(
        apiKey,
        model,
        body.title,
        body.body || '',
        inlineParts
      );
      const identity = parseProductSummary(rawIdentify, body.title);
      let summary = {
        productName: cleanProductName(identity.productName, body.title),
        newPrice: '',
        newPriceSourceUrl: '',
        description: '',
        makerOrSeller: '',
        searchQuery: identity.searchQuery || normalizeQueryCandidate(identity.productName, body.title),
        searchQueries: parseQueryCandidates(
          JSON.stringify({ queries: [identity.searchQuery || identity.productName] }),
          body.title,
          4
        ),
        productImageUrl: '',
      };
      try {
        const detailOut = await runProductInfoLookup(apiKey, model, summary.productName);
        const detail = parseProductSummary(detailOut, summary.productName);
        summary = {
          productName: cleanProductName(detail.productName, summary.productName),
          newPrice: detail.newPrice || '',
          newPriceSourceUrl: detail.newPriceSourceUrl || summary.newPriceSourceUrl || '',
          description: detail.description || '',
          makerOrSeller: detail.makerOrSeller || '',
          searchQuery: detail.searchQuery || summary.searchQuery,
          searchQueries: detail.searchQueries?.length ? detail.searchQueries : summary.searchQueries,
          productImageUrl: '',
        };
      } catch (e) {
        throw new Error(`제품 식별은 됐지만 상세 정보 조회에 실패했습니다: ${e instanceof Error ? e.message : e}`);
      }
      json(res, 200, {
        summary,
        model,
        usedImages: inlineParts.length,
        pipeline: 'identify_then_google_search_lookup',
      });
    } catch (e) {
      json(res, 502, { error: e instanceof Error ? e.message : String(e) });
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/product-risk') {
    try {
      const apiKey =
        req.headers['x-gemini-key'] ||
        (req.headers.authorization && req.headers.authorization.replace(/^Bearer\s+/i, '')) ||
        '';
      const model = req.headers['x-gemini-model'] || DEFAULT_GEMINI_MODEL;
      if (!String(apiKey).trim()) {
        json(res, 400, { error: 'X-Gemini-Key 헤더 또는 Authorization: Bearer 가 필요합니다.' });
        return;
      }
      const bodyRaw = await readBody(req);
      let body;
      try {
        body = JSON.parse(bodyRaw || '{}');
      } catch {
        json(res, 400, { error: 'JSON 본문이 올바르지 않습니다.' });
        return;
      }
      const productName = cleanProductName(body.productName || body.summary?.productName, body.title);
      const rawOut = await runProductRiskAnalysis(apiKey, model, {
        productName,
        summary: body.summary || null,
        title: body.title || '',
        body: body.body || '',
      });
      json(res, 200, {
        analysis: parseProductRisk(rawOut.jsonText, productName),
        researchText: rawOut.researchText,
        model,
        pipeline: 'gemini_google_search_product_risk_research_then_json',
      });
    } catch (e) {
      json(res, 502, { error: e instanceof Error ? e.message : String(e) });
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/listing-text-analysis') {
    try {
      const apiKey =
        req.headers['x-gemini-key'] ||
        (req.headers.authorization && req.headers.authorization.replace(/^Bearer\s+/i, '')) ||
        '';
      const model = req.headers['x-gemini-model'] || DEFAULT_GEMINI_MODEL;
      if (!String(apiKey).trim()) {
        json(res, 400, { error: 'X-Gemini-Key 헤더 또는 Authorization: Bearer 가 필요합니다.' });
        return;
      }
      const bodyRaw = await readBody(req);
      let body;
      try {
        body = JSON.parse(bodyRaw || '{}');
      } catch {
        json(res, 400, { error: 'JSON 본문이 올바르지 않습니다.' });
        return;
      }
      const productName = cleanProductName(body.productName || body.summary?.productName, body.title);
      const rawOut = await runListingTextAnalysis(apiKey, model, {
        productName,
        title: body.title || '',
        body: body.body || '',
        priceLabel: body.priceLabel || '',
        seller: body.seller || null,
        summary: body.summary || null,
        riskAnalysis: body.riskAnalysis || null,
      });
      json(res, 200, {
        analysis: parseListingTextAnalysis(rawOut),
        rawText: rawOut,
        model,
        pipeline: 'gemini_listing_text_analysis_json',
      });
    } catch (e) {
      json(res, 502, { error: e instanceof Error ? e.message : String(e) });
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/listing-image-analysis') {
    try {
      const apiKey =
        req.headers['x-gemini-key'] ||
        (req.headers.authorization && req.headers.authorization.replace(/^Bearer\s+/i, '')) ||
        '';
      const model = req.headers['x-gemini-model'] || DEFAULT_GEMINI_MODEL;
      if (!String(apiKey).trim()) {
        json(res, 400, { error: 'X-Gemini-Key 헤더 또는 Authorization: Bearer 가 필요합니다.' });
        return;
      }
      const bodyRaw = await readBody(req);
      let body;
      try {
        body = JSON.parse(bodyRaw || '{}');
      } catch {
        json(res, 400, { error: 'JSON 본문이 올바르지 않습니다.' });
        return;
      }
      const imageUrls = Array.isArray(body.imageUrls) ? body.imageUrls : [];
      const imageSources = await fetchListingImageSources(imageUrls);
      const inlineParts = imageSources.map((s) => s.part);
      if (!inlineParts.length) {
        json(res, 200, {
          analysis: {
            images: [],
            overall: '분석할 수 있는 매물 사진을 불러오지 못했습니다.',
            parseOk: true,
          },
          model,
          usedImages: 0,
          pipeline: 'gemini_listing_image_analysis_json',
        });
        return;
      }
      const productName = cleanProductName(body.productName, body.title);
      const payloadForImageAnalysis = {
        productName,
        title: body.title || '',
        body: body.body || '',
      };
      const batches = listingImageAnalysisBatches(imageSources);
      const rawOutputs = await Promise.all(
        batches.map((batch) => runListingImageAnalysis(apiKey, model, payloadForImageAnalysis, batch))
      );
      const sourceMeta = [];
      for (const s of imageSources) {
        if (Number(s?.index) > 0) sourceMeta[Number(s.index) - 1] = { width: s.width, height: s.height };
      }
      const parsedBatches = rawOutputs.map((rawOut) => parseListingImageAnalysis(rawOut, imageUrls, sourceMeta));
      const images = parsedBatches
        .flatMap((p) => (Array.isArray(p.images) ? p.images : []))
        .sort((a, b) => (Number(a.index) || 0) - (Number(b.index) || 0));
      const overall =
        parsedBatches
          .map((p) => String(p.overall || '').trim())
          .filter(Boolean)
          .join(' ') || '사진별 상태 코멘트';
      json(res, 200, {
        analysis: {
          images,
          overall,
          parseOk: Boolean(images.length || overall),
        },
        rawText: rawOutputs.join('\n\n--- batch ---\n\n'),
        model,
        usedImages: inlineParts.length,
        batches: batches.length,
        pipeline: 'gemini_listing_image_analysis_json_batches',
      });
    } catch (e) {
      json(res, 502, { error: e instanceof Error ? e.message : String(e) });
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/ai-chat') {
    try {
      const apiKey =
        req.headers['x-gemini-key'] ||
        (req.headers.authorization && req.headers.authorization.replace(/^Bearer\s+/i, '')) ||
        '';
      const model = req.headers['x-gemini-model'] || DEFAULT_GEMINI_MODEL;
      if (!String(apiKey).trim()) {
        json(res, 400, { error: 'X-Gemini-Key 헤더 또는 Authorization: Bearer 가 필요합니다.' });
        return;
      }
      const bodyRaw = await readBody(req);
      let body;
      try {
        body = JSON.parse(bodyRaw || '{}');
      } catch {
        json(res, 400, { error: 'JSON 본문이 올바르지 않습니다.' });
        return;
      }
      const prompt = String(body.prompt || '').trim();
      if (!prompt) {
        json(res, 400, { error: '프롬프트를 입력하세요.' });
        return;
      }
      const answer = await runDirectAiChat(apiKey, model, prompt);
      json(res, 200, {
        answer,
        model,
        pipeline: 'gemini_google_search_direct_chat',
      });
    } catch (e) {
      json(res, 502, { error: e instanceof Error ? e.message : String(e) });
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/product-image') {
    try {
      const bodyRaw = await readBody(req);
      let body;
      try {
        body = JSON.parse(bodyRaw || '{}');
      } catch {
        json(res, 400, { error: 'JSON 본문이 올바르지 않습니다.' });
        return;
      }
      const productName = String(body.productName || '').trim();
      const searchQuery = String(body.searchQuery || '').trim();
      const query = productName || searchQuery;
      if (!query) {
        json(res, 400, { error: '제품명 또는 검색어가 필요합니다.' });
        return;
      }
      const terms = productImageTerms(productName, searchQuery);
      const searchText = `${query} 공식 제품 이미지`;
      const directUrls = await fetchDuckDuckGoImageUrls(searchText, terms);
      const imageUrls = directUrls.map(productImageProxyUrl).filter(Boolean);
      json(res, 200, {
        imageUrls,
        source: imageUrls.length ? 'duckduckgo_images' : 'none',
      });
    } catch (e) {
      json(res, 502, { error: e instanceof Error ? e.message : String(e) });
    }
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/image-proxy') {
    const target = normalizeProductImageUrl(url.searchParams.get('url'));
    if (!target) {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('이미지 URL이 올바르지 않습니다.');
      return;
    }
    try {
      const upstream = await fetch(target, {
        redirect: 'follow',
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0 Safari/537.36',
          Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
          Referer: new URL(target).origin,
        },
        signal: AbortSignal.timeout(IMAGE_FETCH_TIMEOUT_MS),
      });
      const type = upstream.headers.get('content-type')?.split(';')[0]?.trim() || 'image/jpeg';
      if (!upstream.ok || !type.startsWith('image/')) {
        res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('이미지를 가져오지 못했습니다.');
        return;
      }
      const buf = Buffer.from(await upstream.arrayBuffer());
      res.writeHead(200, {
        'Content-Type': type,
        'Cache-Control': 'public, max-age=86400',
      });
      res.end(buf);
    } catch (e) {
      res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(e instanceof Error ? e.message : String(e));
    }
    return;
  }

  if (req.method === 'GET' && /^\/icons\/icon(?:16|32|48|128)\.png$/.test(url.pathname)) {
    const iconName = path.basename(url.pathname);
    try {
      const buf = await fs.readFile(path.join(EXTENSION_ICONS_DIR, iconName));
      res.writeHead(200, {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=3600',
      });
      res.end(buf);
    } catch {
      res.writeHead(404);
      res.end('Not Found');
    }
    return;
  }

  /* 정적 파일 */
  let filePath = url.pathname === '/' ? '/index.html' : url.pathname;
  filePath = path.normalize(filePath).replace(/^(\.\.(\/|\\|$))+/, '');
  const abs = path.join(ANALYZER_DIR, filePath);
  if (!abs.startsWith(ANALYZER_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  try {
    const buf = await fs.readFile(abs);
    const ext = path.extname(abs);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(buf);
  } catch {
    res.writeHead(404);
    res.end('Not Found');
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`가격 분석 페이지: http://127.0.0.1:${PORT}/`);
  console.log('종료: Ctrl+C');
});
