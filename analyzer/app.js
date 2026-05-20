const $current = document.getElementById('current');
const $history = document.getElementById('history');
const $status = document.getElementById('status');
const $btnRefresh = document.getElementById('btnRefresh');
const $btnHistory = document.getElementById('btnHistory');
const $btnHistoryClose = document.getElementById('btnHistoryClose');
const $btnHistoryClear = document.getElementById('btnHistoryClear');
const $recentDrawer = document.getElementById('recentDrawer');
const $drawerBackdrop = document.getElementById('drawerBackdrop');
const $lightbox = document.getElementById('lightbox');
const $lightboxImg = document.getElementById('lightboxImg');
const $lightboxClose = document.getElementById('lightboxClose');

let latest = null;
let history = [];
let comps = null;
let selectedKey = null;
const productSummaries = new Map();
const photoIndexes = new Map();
const photoDirections = new Map();
const relatedRequestedKeys = new Set();
const productImageSearches = new Set();
const stageTwoActiveKeys = new Set();

function itemKey(item) {
  return `${item.platform}:${item.itemId}`;
}

function formatTime(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

function sellerLine(seller, platform) {
  if (!seller) return '—';
  const bits = [];
  const name = seller.nickname || seller.shopName || '';
  if (name) bits.push(name);
  if (platform === 'daangn' && seller.mannerScore != null) bits.push(`${seller.mannerScore}°C`);
  if (platform !== 'daangn' && seller.reviewRating != null) bits.push(`평점 ${seller.reviewRating}`);
  if (seller.reviewCount != null) bits.push(`리뷰 ${seller.reviewCount}`);
  if (seller.salesCount != null) bits.push(`판매 ${seller.salesCount}`);
  if (seller.location) bits.push(seller.location);
  return bits.join(' · ') || '—';
}

function compStats(items) {
  const prices = (items || []).map((i) => i.price).filter((p) => typeof p === 'number' && p > 0);
  prices.sort((a, b) => a - b);
  if (!prices.length) return null;
  const median = prices[Math.floor(prices.length / 2)];
  return {
    n: prices.length,
    min: prices[0],
    max: prices[prices.length - 1],
    median,
  };
}

function formatWon(n) {
  return `${Number(n).toLocaleString('ko-KR')}원`;
}

function getAiApiKey() {
  const keyName = globalThis.UlsaAi?.STORAGE_KEY_API;
  return keyName ? localStorage.getItem(keyName)?.trim() || '' : '';
}

function summaryKey(item) {
  return item ? itemKey(item) : '';
}

function fallbackSearchQuery(item) {
  return String(item?.title || '')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/[|｜]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getProductSummaryState(item) {
  const key = summaryKey(item);
  return key ? productSummaries.get(key) || null : null;
}

function productSummaryDescription(summary, item) {
  if (summary?.description) return summary.description;
  return '제품 상세 정보가 비어 있습니다. 제품 정리 다시 시도를 눌러 정보 조회를 다시 실행하세요.';
}

function productSummaryImage(summary, item) {
  return summary?.productImageUrl || '';
}

function displayImageUrl(src) {
  const raw = String(src || '').trim();
  if (!raw || raw.startsWith('/api/image-proxy')) return raw;
  if (/^https?:\/\//i.test(raw)) return `/api/image-proxy?url=${encodeURIComponent(raw)}`;
  return raw;
}

function imageUrlKey(src) {
  const raw = String(src || '').trim();
  if (!raw) return '';
  try {
    const u = new URL(raw, location.href);
    if (u.pathname === '/api/image-proxy') return u.searchParams.get('url') || u.href;
    return u.href;
  } catch {
    return raw;
  }
}

function uniqueImageList(urls) {
  const out = [];
  const seen = new Set();
  for (const raw of urls || []) {
    const url = displayImageUrl(raw);
    const key = imageUrlKey(url);
    if (!url || seen.has(key)) continue;
    seen.add(key);
    out.push(url);
  }
  return out;
}

function nextProductImageUrl(urls, current) {
  const list = uniqueImageList(urls);
  if (!list.length) return '';
  const currentKey = imageUrlKey(displayImageUrl(current));
  const idx = list.findIndex((url) => imageUrlKey(url) === currentKey);
  return list[idx >= 0 ? (idx + 1) % list.length : 0];
}

function splitSearchQueries(value) {
  if (Array.isArray(value)) {
    return splitSearchQueries(value.filter(Boolean).join('\n'));
  }
  const raw = String(value || '').trim();
  if (!raw) return [];
  const parts = raw
    .split(/\s*(?:[,，;；]|\s\/\s|\s\|\s|\n)\s*/g)
    .map((x) => x.replace(/^검색어\s*[:：]\s*/i, '').trim())
    .filter(Boolean);
  const out = [];
  const seen = new Set();
  for (const part of parts.length ? parts : [raw]) {
    const q = part
      .replace(/(^|\s)중고(?=\s|$)/g, ' ')
      .replace(/중고$/g, '')
      .replace(/(^|\s)가격(?=\s|$)/g, ' ')
      .replace(/가격$/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    const key = q.replace(/\s+/g, '').toLowerCase();
    if (!q || seen.has(key) || !/[\uAC00-\uD7A3]/.test(q)) continue;
    seen.add(key);
    out.push(q);
    if (out.length >= 4) break;
  }
  return out;
}

function renderScrollableText(text, className, id, maxHeight) {
  const value = String(text || '').trim();
  if (!value) return '';
  return `<div class="scroll-text ${escapeAttr(className || '')}" id="${escapeAttr(id || '')}" data-scroll-max="${Number(maxHeight) || 0}" title="${escapeAttr(value)}">${escapeHtml(value)}</div>`;
}

function productSummaryQueries(summary, item) {
  return splitSearchQueries(summary?.searchQueries || summary?.searchQuery || fallbackSearchQuery(item));
}

function danawaPriceUrl(summary) {
  const query = summary?.productName || summary?.searchQuery || '';
  if (!query) return '';
  return `https://search.danawa.com/dsearch.php?query=${encodeURIComponent(query)}`;
}

function productSummaryImages(summary, item) {
  return uniqueImageList([summary?.productImageUrl]).slice(0, 1);
}

function stepTwoProductName(item) {
  const state = getProductSummaryState(item);
  return state?.summary?.productName || fallbackSearchQuery(item) || '식별된 제품';
}

function renderStageTwoMini(title, desc) {
  return `
    <div class="stage-two-mini is-disabled">
      <strong>${escapeHtml(title)}</strong>
      <span>${escapeHtml(desc)}</span>
    </div>
  `;
}

function renderStageTwoGroup(title, items) {
  return `
    <article class="stage-two-card stage-two-card--stack is-disabled" aria-disabled="true">
      <div class="stage-two-card-head">
        <p class="stage-two-card-label">AI 기능 추가 예정</p>
        <h3>${escapeHtml(title)}</h3>
      </div>
      <div class="stage-two-mini-list">
        ${items.map((item) => renderStageTwoMini(item.title, item.desc)).join('')}
      </div>
    </article>
  `;
}

function renderStageTwoSimple(title, desc) {
  return `
    <article class="stage-two-card is-disabled" aria-disabled="true">
      <div>
        <p class="stage-two-card-label">AI 기능 추가 예정</p>
        <h3>${escapeHtml(title)}</h3>
        <p>${escapeHtml(desc)}</p>
      </div>
    </article>
  `;
}

function renderStageTwoSection(item) {
  if (!item) return '';
  const productName = stepTwoProductName(item);
  const key = summaryKey(item);
  const state = getProductSummaryState(item);
  if (state?.status !== 'done') return '';
  const active = key && stageTwoActiveKeys.has(key);

  return `
    <section class="stage-two-panel${active ? ' is-active' : ''}" data-stage-two-panel aria-label="2단계 제품 리스크 분석">
      <div class="stage-two-head">
        <div>
          <p class="stage-kicker">2단계</p>
          <h2>제품 리스크 확인</h2>
        </div>
        <p class="stage-note">1단계 제품 정리와 분리된 다음 분석 영역입니다.</p>
      </div>
      ${
        active
          ? `<div class="stage-two-grid">
              ${renderStageTwoGroup('관련 이슈', [
                { title: '최근 이슈', desc: `${productName} 관련 뉴스/커뮤니티 이슈 확인` },
                { title: 'AS·유통', desc: '국내 유통사, 보증, 수리 가능성 확인' },
                { title: '가격 영향', desc: '이슈가 중고가에 미치는 영향 정리' },
              ])}
              ${renderStageTwoGroup('고질병 조사', [
                { title: '자주 나는 고장', desc: '사용자들이 반복 보고한 고장 유형 확인' },
                { title: '확인 질문', desc: '판매자에게 물어볼 체크 질문 생성' },
                { title: '감가 요인', desc: '고질병 가능성에 따른 가격 조정 포인트' },
              ])}
              ${renderStageTwoSimple('판매자 본문 분석', '판매글의 표현, 거래 조건, 보증/환불 문구, 사기 의심 신호를 분석할 영역입니다.')}
              ${renderStageTwoSimple('이미지 하자 조사', '매물 사진에서 외관 하자, 구성품 누락, 추가 사진 요청 포인트를 확인할 영역입니다.')}
            </div>`
          : `<div class="stage-two-ready">
              <button type="button" class="btn btn-small stage-two-start-btn" data-stage-two-start="${escapeAttr(key)}">다음 단계로 넘어가기</button>
            </div>`
      }
    </section>
  `;
}

function activeCompsForItem(item, rawComps) {
  if (!item || !rawComps?.forItemKey) return null;
  if (rawComps.forItemKey !== itemKey(item)) return null;
  return rawComps.bunjang || rawComps.daangn ? rawComps : null;
}

function renderProductSummaryBlock(item) {
  const state = getProductSummaryState(item);
  const summary = state?.summary;
  const queries = productSummaryQueries(summary, item);
  const images = productSummaryImages(summary, item);
  const disabled = queries.length ? '' : ' disabled';

  if (state?.status === 'loading') {
    return `
      <article class="mini-card mini-card--product mini-card--compact mini-card--loading" data-product-summary>
        <div class="summary-loading">
          <span class="spinner" aria-hidden="true"></span>
          <div>
            <p class="mini-value">AI가 제품 정보를 정리하는 중...</p>
            <p class="mini-muted">본문과 사진을 기반으로 제품명·신품 시세·대표 이미지를 준비합니다.</p>
          </div>
        </div>
      </article>
    `;
  }

  if (state?.status === 'error') {
    return `
      <article class="mini-card mini-card--product mini-card--compact" data-product-summary>
        <p class="mini-value">제품 정리를 만들지 못했습니다.</p>
        <p class="mini-muted">${escapeHtml(state.error || 'API 설정 또는 서버 상태를 확인하세요.')}</p>
        <button type="button" class="btn btn-small retry-product-summary-btn">제품 정리 다시 시도</button>
        <button type="button" class="btn btn-small related-search-btn"${disabled}>비슷한 매물 찾기</button>
      </article>
    `;
  }

  return `
    <article class="mini-card mini-card--product mini-card--compact" data-product-summary>
      <div class="summary-actions">
        ${
          queries.length
            ? `<div class="search-query-list" aria-label="검색어">${queries
                .map(
                  (q) =>
                    `<button type="button" class="search-query-chip related-query-btn" data-query="${escapeAttr(q)}" title="이 검색어로 비슷한 매물 찾기">${escapeHtml(q)}</button>`
                )
                .join('')}</div>`
            : ''
        }
        <button type="button" class="btn btn-small related-search-btn"${disabled}>비슷한 매물 찾기</button>
      </div>
      <div class="product-summary-layout">
        <div class="product-image-strip">
          ${
            images.length
              ? images
                  .map(
                    (src) =>
                      `<img class="zoomable product-summary-img" src="${escapeAttr(src)}" data-full="${escapeAttr(src)}" alt="" loading="lazy" />`
                  )
                  .join('')
              : '<div class="product-image-placeholder">이미지 없음</div>'
          }
          <button type="button" class="image-refresh-btn product-image-btn" title="제품 이미지 갱신" aria-label="제품 이미지 갱신">↻</button>
        </div>
        <div class="product-summary-text">
          <h2 class="hover-full" title="${escapeAttr(summary?.productName || '제품 정리 대기')}">${escapeHtml(summary?.productName || '제품 정리 대기')}</h2>
          ${
            summary?.newPrice
              ? `<p class="mini-value">AI 추정 신품 시세: ${escapeHtml(summary.newPrice)}${
                  danawaPriceUrl(summary)
                    ? ` <a class="price-source-link" href="${escapeAttr(danawaPriceUrl(summary))}" target="_blank" rel="noopener">다나와 검색 ↗</a>`
                    : ''
                }</p>`
              : ''
          }
          ${summary?.makerOrSeller ? `<p class="mini-muted">제조사/판매처: ${escapeHtml(summary.makerOrSeller)}</p>` : ''}
          ${renderScrollableText(productSummaryDescription(summary, item), 'product-desc', `summary-desc-${summaryKey(item)}`, 58)}
        </div>
      </div>
    </article>
  `;
}

function renderCompsBlock(comps) {
  const clearButton = '<button type="button" class="icon-btn clear-comps-btn" title="비교 매물 삭제">삭제</button>';
  if (!comps) {
    return `<div class="block-head"><p class="block-label">비슷한 매물</p></div><p class="meta empty">제품 정리 후 버튼을 누르면 번개·당근 검색 결과를 수집합니다.</p>`;
  }
  const all = [...(comps.bunjang?.items || []), ...(comps.daangn?.items || [])];
  if (!all.length) {
    return `<div class="block-head"><p class="block-label">비교 매물 (시세 근거)</p>${clearButton}</div><p class="meta empty">아직 없음 — 비슷한 매물 찾기 버튼을 누르세요.</p>`;
  }
  const st = compStats(all);
  const statsTxt = st
    ? `${st.n}건 · 중앙 ${formatWon(st.median)} · ${formatWon(st.min)} ~ ${formatWon(st.max)}`
    : `${all.length}건`;
  const rows = all
    .slice(0, 6)
    .map(
      (c) =>
        `<li title="${escapeAttr(`[${c.platformLabel || c.platform}] ${c.title || ''} ${c.priceLabel || ''}`)}"><a href="${escapeAttr(c.url)}" target="_blank" rel="noopener">[${escapeHtml(c.platformLabel || c.platform)}] ${escapeHtml(c.title || '')}</a> <span class="hist-meta">${escapeHtml(c.priceLabel || '')}</span></li>`
    )
    .join('');
  const more = all.length > 6 ? `<p class="meta">외 ${all.length - 6}건</p>` : '';
  return `
    <div class="block-head"><p class="block-label">비교 매물 (시세 근거)</p>${clearButton}</div>
    <p class="meta"><strong>${escapeHtml(statsTxt)}</strong> · 설정 지역·검색 결과 기준</p>
    <ul class="comp-list">${rows}</ul>
    ${more}
  `;
}

function renderPhotoSlider(item) {
  const urls = item.imageUrls || [];
  if (!urls.length) return '<span class="empty">없음</span>';
  const key = itemKey(item);
  const idx = Math.min(Math.max(photoIndexes.get(key) || 0, 0), urls.length - 1);
  const dir = photoDirections.get(key) || 0;
  const animClass = dir > 0 ? ' slide-next' : dir < 0 ? ' slide-prev' : '';
  const src = urls[idx];
  const dots = urls
    .map((_, i) => `<span class="photo-dot${i === idx ? ' active' : ''}" aria-label="${i + 1}/${urls.length}"></span>`)
    .join('');
  return `
    <div class="photo-slider" data-photo-slider>
      <button type="button" class="photo-nav prev" data-photo-dir="-1" ${urls.length < 2 ? 'disabled' : ''}>‹</button>
      <img class="photo-main${animClass}" src="${escapeAttr(src)}" alt="" loading="lazy" />
      <button type="button" class="photo-nav next" data-photo-dir="1" ${urls.length < 2 ? 'disabled' : ''}>›</button>
      <div class="photo-count">${idx + 1}/${urls.length}</div>
      <div class="photo-dots">${dots}</div>
    </div>
  `;
}

function renderItem(item, comps) {
  if (!item) {
    $current.innerHTML = `
      <article class="mini-card mini-card--empty">
        <h2>매물 대기</h2>
        <p class="empty">확장 프로그램에서 매물을 분석 웹으로 보내면 카드가 생성됩니다.</p>
      </article>
    `;
    return;
  }
  const plat = item.platform === 'daangn' ? 'daangn' : 'bunjang';
  const seller = sellerLine(item.seller, item.platform);
  $current.innerHTML = `
    <article class="mini-card mini-card--hero">
      <div class="listing-head">
        <span class="badge ${plat}">${escapeHtml(item.platformLabel || item.platform)}</span>
        ${item.pageUrl ? `<a class="link" href="${escapeAttr(item.pageUrl)}" target="_blank" rel="noopener">판매글 열기</a>` : ''}
      </div>
      <div>
        <h3 class="item-title hover-full" title="${escapeAttr(item.title || '(제목 없음)')}">${escapeHtml(item.title || '(제목 없음)')}</h3>
        <p class="price">${escapeHtml(item.priceLabel || '—')}</p>
        <p class="listing-mini-meta">${escapeHtml(seller)} · ${formatTime(item.exportedAt)}</p>
      </div>
    </article>

    <article class="mini-card mini-card--text">
      <p class="block-label">본문</p>
      ${renderScrollableText(item.body || '', 'body-text', `body-${itemKey(item)}`, 0)}
    </article>

    <article class="mini-card mini-card--photos">
      <div class="mini-card-head">
        <p class="block-label">매물 사진</p>
      </div>
      ${renderPhotoSlider(item)}
    </article>

    ${renderProductSummaryBlock(item)}

    ${comps ? `<article class="mini-card mini-card--related">${renderCompsBlock(comps)}</article>` : ''}
    ${renderStageTwoSection(item)}
  `;
  bindImageZoom($current);
  bindPhotoSlider($current, item);
  bindScrollText($current);
  bindStageTwoFlow($current, item);
  bindProductSummaryRetry($current, item);
  bindProductImageSearch($current, item);
  bindRelatedSearch($current, item);
  bindCompsActions($current);
}

function setHistoryOpen(open) {
  $recentDrawer?.classList.toggle('open', open);
  $recentDrawer?.setAttribute('aria-hidden', open ? 'false' : 'true');
  if ($drawerBackdrop) $drawerBackdrop.hidden = !open;
}

function openLightbox(src) {
  if (!$lightbox || !$lightboxImg || !src) return;
  $lightboxImg.src = src;
  $lightbox.hidden = false;
  $lightbox.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
}

function closeLightbox() {
  if (!$lightbox || !$lightboxImg) return;
  $lightbox.hidden = true;
  $lightbox.setAttribute('aria-hidden', 'true');
  $lightboxImg.removeAttribute('src');
  document.body.style.overflow = '';
}

function bindImageZoom(root) {
  root?.querySelectorAll('img.zoomable').forEach((img) => {
    img.addEventListener('error', () => {
      img.closest('.product-image-strip')?.remove();
    });
    const open = () => openLightbox(img.getAttribute('data-full') || img.src);
    img.addEventListener('click', open);
    img.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        open();
      }
    });
  });
}

function bindPhotoSlider(root, item) {
  root?.querySelectorAll('[data-photo-dir]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const urls = item.imageUrls || [];
      if (urls.length < 2) return;
      const key = itemKey(item);
      const dir = Number(btn.getAttribute('data-photo-dir')) || 0;
      const current = photoIndexes.get(key) || 0;
      photoIndexes.set(key, (current + dir + urls.length) % urls.length);
      photoDirections.set(key, dir);
      refreshPhotoSlider(item);
    });
  });
}

function bindScrollText(root) {
  root?.querySelectorAll('.scroll-text').forEach((el) => {
    el.classList.remove('is-scrollable');
    el.style.maxHeight = '';
    requestAnimationFrame(() => {
      let max = Number(el.getAttribute('data-scroll-max')) || 0;
      if (!max && el.classList.contains('body-text')) {
        const card = el.closest('.mini-card');
        if (card) {
          const cardRect = card.getBoundingClientRect();
          const elRect = el.getBoundingClientRect();
          max = Math.max(92, Math.floor(cardRect.bottom - elRect.top - 14));
        }
      }
      if (!max) return;
      if (el.scrollHeight > max + 2) {
        el.style.maxHeight = `${max}px`;
        el.classList.add('is-scrollable');
      }
    });
  });
}

function bindStageTwoFlow(root, item) {
  root?.querySelectorAll('.stage-two-start-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.getAttribute('data-stage-two-start') || summaryKey(item);
      if (!key) return;
      stageTwoActiveKeys.add(key);
      const panel = root.querySelector('[data-stage-two-panel]');
      if (panel) {
        panel.outerHTML = renderStageTwoSection(item);
        bindStageTwoFlow(root, item);
      }
    });
  });
}

function refreshPhotoSlider(item) {
  const current = $current.querySelector('[data-photo-slider]');
  if (!current) return;
  current.outerHTML = renderPhotoSlider(item);
  const updated = $current.querySelector('[data-photo-slider]');
  bindImageZoom(updated);
  bindPhotoSlider(updated, item);
  setTimeout(() => photoDirections.delete(itemKey(item)), 260);
}

function bindRelatedSearch(root, item) {
  const openRelatedSearch = (query, btn) => {
    const key = summaryKey(item);
    if (!query) {
    $status.textContent = '비슷한 매물을 찾을 검색어가 아직 없습니다.';
      return;
    }
    relatedRequestedKeys.add(key);
    comps = null;
    $current.querySelector('.mini-card--related')?.remove();
    if (btn) btn.disabled = true;
    $status.textContent = `비슷한 매물 검색 탭 여는 중: ${query}`;
    window.postMessage({ type: 'MARKET_SCRAPE_CLEAR_COMPS' }, '*');
    window.postMessage({ type: 'MARKET_SCRAPE_OPEN_SEARCH_TABS', query }, '*');
    if (btn) {
      setTimeout(() => {
        btn.disabled = false;
      }, 2500);
    }
  };

  root?.querySelectorAll('.related-search-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const key = summaryKey(item);
      const state = key ? productSummaries.get(key) : null;
      const query = productSummaryQueries(state?.summary, item)[0] || '';
      openRelatedSearch(query, btn);
    });
  });

  root?.querySelectorAll('.related-query-btn').forEach((btn) => {
    btn.addEventListener('click', () => openRelatedSearch(btn.getAttribute('data-query') || '', btn));
  });
}

function bindProductImageSearch(root, item) {
  root?.querySelectorAll('.product-image-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const key = summaryKey(item);
      const state = key ? productSummaries.get(key) : null;
      const summary = state?.summary || {};
      const productName = summary.productName || fallbackSearchQuery(item);
      const searchQuery = productSummaryQueries(summary, item)[0] || productName;
      if (!productName || typeof globalThis.UlsaAi?.fetchProductImage !== 'function') return;

      btn.disabled = true;
      btn.classList.add('is-loading');
      btn.setAttribute('aria-busy', 'true');
      try {
        const cachedUrls = uniqueImageList([...(summary.productImageUrls || []), summary.productImageUrl]);
        if (cachedUrls.length > 1) {
          const nextUrl = nextProductImageUrl(cachedUrls, summary.productImageUrl);
          productSummaries.set(key, {
            ...(state || {}),
            status: 'done',
            summary: {
              ...summary,
              productImageUrl: nextUrl,
              productImageUrls: cachedUrls,
            },
          });
          refreshProductSummaryBlock(item);
          $status.textContent = '다음 제품 이미지로 바꿨습니다.';
          return;
        }

        const data = await globalThis.UlsaAi.fetchProductImage({ productName, searchQuery });
        const imageUrls = uniqueImageList(data.imageUrls);
        if (!imageUrls.length) {
          $status.textContent = '제품 이미지를 찾지 못했습니다.';
          return;
        }
        const nextUrl = nextProductImageUrl(imageUrls, summary.productImageUrl) || imageUrls[0];
        const nextSummary = {
          ...summary,
          productImageUrl: nextUrl,
          productImageUrls: imageUrls,
        };
        productSummaries.set(key, { ...(state || {}), status: 'done', summary: nextSummary });
        refreshProductSummaryBlock(item);
        $status.textContent = `제품 이미지 ${imageUrls.length}장을 찾았습니다.`;
      } catch (e) {
        $status.textContent = e instanceof Error ? e.message : String(e);
      } finally {
        btn.disabled = false;
        btn.classList.remove('is-loading');
        btn.removeAttribute('aria-busy');
      }
    });
  });
}

async function ensureProductImage(item) {
  const key = summaryKey(item);
  const state = key ? productSummaries.get(key) : null;
  const summary = state?.summary;
  if (!key || !summary || summary.productImageUrl || productImageSearches.has(key)) return;
  if (typeof globalThis.UlsaAi?.fetchProductImage !== 'function') return;
  const productName = summary.productName || fallbackSearchQuery(item);
  const searchQuery = productSummaryQueries(summary, item)[0] || productName;
  if (!productName) return;

  productImageSearches.add(key);
  try {
    const data = await globalThis.UlsaAi.fetchProductImage({ productName, searchQuery });
    const imageUrls = uniqueImageList(data.imageUrls);
    if (!imageUrls.length) return;
    productSummaries.set(key, {
      ...state,
      status: 'done',
      summary: {
        ...summary,
        productImageUrl: imageUrls[0],
        productImageUrls: imageUrls,
      },
    });
    if (selectedKey === key) refreshProductSummaryBlock(item);
  } catch (e) {
    console.warn('제품 이미지 자동 검색 실패:', e);
  }
}

async function enrichSummaryWithProductImage(summary, item) {
  if (!summary || typeof globalThis.UlsaAi?.fetchProductImage !== 'function') return summary;
  const productName = summary.productName || fallbackSearchQuery(item);
  const searchQuery = productSummaryQueries(summary, item)[0] || productName;
  if (!productName) return summary;
  try {
    const data = await globalThis.UlsaAi.fetchProductImage({ productName, searchQuery });
    const imageUrls = uniqueImageList(data.imageUrls);
    if (!imageUrls.length) return summary;
    return {
      ...summary,
      productImageUrl: summary.productImageUrl || imageUrls[0],
      productImageUrls: imageUrls,
    };
  } catch (e) {
    console.warn('제품 이미지 포함 요약 준비 실패:', e);
    return summary;
  }
}

function bindProductSummaryRetry(root, item) {
  root?.querySelectorAll('.retry-product-summary-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = summaryKey(item);
      if (key) productSummaries.delete(key);
      void ensureProductSummary(item);
    });
  });
}

function bindCompsActions(root) {
  root?.querySelectorAll('.clear-comps-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = selectedKey;
      comps = null;
      if (key) relatedRequestedKeys.delete(key);
      const related = $current.querySelector('.mini-card--related');
      if (related) related.remove();
      window.postMessage({ type: 'MARKET_SCRAPE_CLEAR_COMPS' }, '*');
      $status.textContent = '비교 매물을 삭제했습니다.';
    });
  });
}

function refreshProductSummaryBlock(item) {
  const current = $current.querySelector('[data-product-summary]');
  if (!current) {
    renderItem(item, comps);
    return;
  }
  current.outerHTML = renderProductSummaryBlock(item);
  const updated = $current.querySelector('[data-product-summary]');
  bindImageZoom(updated);
  bindScrollText(updated);
  bindProductSummaryRetry(updated, item);
  bindProductImageSearch(updated, item);
  bindRelatedSearch(updated, item);
  const stageTwo = $current.querySelector('[data-stage-two-panel]');
  if (stageTwo) {
    stageTwo.outerHTML = renderStageTwoSection(item);
    bindStageTwoFlow($current, item);
  } else {
    const related = $current.querySelector('.mini-card--related');
    const product = $current.querySelector('[data-product-summary]');
    const html = renderStageTwoSection(item);
    if (html && related) related.insertAdjacentHTML('afterend', html);
    else if (html && product) product.insertAdjacentHTML('afterend', html);
    bindStageTwoFlow($current, item);
  }
}

window.addEventListener('message', (ev) => {
  if (ev.source !== window || ev.data?.type !== 'MARKET_SCRAPE_SEARCH_TABS_RESULT') return;
  if (ev.data.ok) {
    $status.textContent = `비슷한 매물 수집 중: ${ev.data.query || ''}`;
  } else {
    $status.textContent = ev.data.error || '비슷한 매물 검색 탭을 열지 못했습니다.';
  }
});

window.addEventListener('message', (ev) => {
  if (ev.source !== window || ev.data?.type !== 'MARKET_SCRAPE_MUTATION_RESULT') return;
  if (!ev.data.ok && ev.data.error) $status.textContent = ev.data.error;
});

$lightbox?.addEventListener('click', (e) => {
  if (e.target === $lightbox) closeLightbox();
});
$lightboxClose?.addEventListener('click', closeLightbox);
$btnHistory?.addEventListener('click', () => setHistoryOpen(true));
$btnHistoryClose?.addEventListener('click', () => setHistoryOpen(false));
$btnHistoryClear?.addEventListener('click', () => {
  history = [];
  latest = null;
  selectedKey = null;
  comps = null;
  productSummaries.clear();
  relatedRequestedKeys.clear();
  productImageSearches.clear();
  renderItem(null);
  renderHistoryList();
  setHistoryOpen(false);
  $status.textContent = '최근 매물을 모두 삭제했습니다.';
  window.postMessage({ type: 'MARKET_SCRAPE_CLEAR_HISTORY' }, '*');
});
$drawerBackdrop?.addEventListener('click', () => setHistoryOpen(false));
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && $lightbox && !$lightbox.hidden) closeLightbox();
  if (e.key === 'Escape') setHistoryOpen(false);
});

function renderHistoryList() {
  if (!history.length) {
    $history.innerHTML = '<li class="empty-item">비어 있음</li>';
    return;
  }
  $history.innerHTML = history
    .map((item) => {
      const key = itemKey(item);
      const active = key === selectedKey ? ' active' : '';
      return `<li class="history-row">
        <button type="button" data-key="${escapeAttr(key)}" class="${active.trim()}">
          <span class="hist-title">[${escapeHtml(item.platformLabel || item.platform)}] ${escapeHtml(item.title || '')}</span>
          <span class="hist-meta">${escapeHtml(item.priceLabel || '')} · ${formatTime(item.exportedAt)}</span>
        </button>
        <button type="button" class="history-delete" data-delete-key="${escapeAttr(key)}" aria-label="최근 매물 삭제">×</button>
      </li>`;
    })
    .join('');

  $history.querySelectorAll('button[data-key]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.getAttribute('data-key');
      const found = history.find((h) => itemKey(h) === key);
      if (found) {
        selectedKey = key;
        renderItem(found, activeCompsForItem(found, comps));
        void ensureProductSummary(found);
        renderHistoryList();
      }
    });
  });

  $history.querySelectorAll('button[data-delete-key]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.getAttribute('data-delete-key');
      history = history.filter((h) => itemKey(h) !== key);
      productSummaries.delete(key);
      relatedRequestedKeys.delete(key);
      productImageSearches.delete(key);
    stageTwoActiveKeys.delete(key);
      if (selectedKey === key) {
        latest = history[0] || null;
        selectedKey = latest ? itemKey(latest) : null;
        comps = null;
        renderItem(latest, comps);
      }
      renderHistoryList();
      window.postMessage({ type: 'MARKET_SCRAPE_DELETE_HISTORY', key }, '*');
    });
  });
}

async function ensureProductSummary(item) {
  const key = summaryKey(item);
  if (!key) return;
  if (productSummaries.has(key)) {
    void ensureProductImage(item);
    return;
  }
  const apiKey = getAiApiKey();
  if (!apiKey || typeof globalThis.UlsaAi?.fetchProductSummary !== 'function') {
    productSummaries.set(key, { status: 'error', error: 'AI 설정이 필요합니다.' });
    if (selectedKey === key) refreshProductSummaryBlock(item);
    return;
  }

  productSummaries.set(key, { status: 'loading' });
  if (selectedKey === key) refreshProductSummaryBlock(item);

  try {
    const data = await globalThis.UlsaAi.fetchProductSummary({
      title: item.title || '',
      body: item.body || '',
      imageUrls: item.imageUrls || [],
      apiKey,
    });
    const summary = await enrichSummaryWithProductImage(data.summary || null, item);
    productSummaries.set(key, { status: 'done', summary });
  } catch (e) {
    productSummaries.set(key, {
      status: 'error',
      error: e instanceof Error ? e.message : String(e),
    });
  }

  if (selectedKey === key) refreshProductSummaryBlock(item);
}

function applyPayload(payload) {
  latest = payload?.latest ?? latest;
  history = Array.isArray(payload?.history) ? payload.history : history;
  const rawComps = payload?.comps ?? latest?.comps ?? null;
  const latestKey = latest ? itemKey(latest) : '';
  comps = latestKey && relatedRequestedKeys.has(latestKey) ? activeCompsForItem(latest, rawComps) : null;

  if (latest) {
    selectedKey = itemKey(latest);
    renderItem(latest, comps);
    void ensureProductSummary(latest);
    const bn = comps?.bunjang?.count ?? 0;
    const dn = comps?.daangn?.count ?? 0;
    const compTxt = bn + dn > 0 ? ` · 비교 ${bn + dn}건` : '';
    $status.textContent = `최신: ${latest.platformLabel}${compTxt} · ${formatTime(latest.exportedAt)}`;
  } else if (!history.length) {
    $status.textContent = '데이터 없음 — 확장에서 매물을 «분석 웹으로 보내기» 하세요.';
    renderItem(null);
  }

  renderHistoryList();
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(s) {
  return escapeHtml(s);
}

let __appStarted = false;
function initMain() {
  if (__appStarted) return;
  __appStarted = true;

  window.addEventListener('message', (ev) => {
    if (ev.source !== window) return;
    const d = ev.data;
    if (!d || d.type !== 'MARKET_SCRAPE_BRIDGE') return;
    applyPayload({ latest: d.latest, history: d.history });
  });

  $btnRefresh.addEventListener('click', () => {
    window.postMessage({ type: 'MARKET_SCRAPE_REQUEST' }, '*');
    $status.textContent = '불러오는 중…';
  });

  window.postMessage({ type: 'MARKET_SCRAPE_REQUEST' }, '*');
}

function bootstrapApp() {
  window.addEventListener('ulsa:ai-ready', () => initMain(), { once: true });
  if (globalThis.__ulsaAiReady) initMain();
}
bootstrapApp();
