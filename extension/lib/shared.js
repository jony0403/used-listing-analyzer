/** @file 공통 UI·유틸·어댑터 레지스트리 */
(() => {
  const Root = globalThis.MarketScrape || (globalThis.MarketScrape = {});
  const adapters = (Root.adapters = Root.adapters || []);
  const INSTANCE_ID = `${Date.now()}:${Math.random().toString(36).slice(2)}`;
  Root.__activeInstanceId = INSTANCE_ID;

  Root.register = (adapter) => {
    if (adapter?.id) adapters.push(adapter);
  };

  Root.getAdapter = () => {
    const { hostname, href } = location;
    return adapters.find((a) => a.matches(hostname, href)) || null;
  };

  Root.formatWon = (n) => {
    const x = Number(String(n).replace(/,/g, ''));
    if (!Number.isFinite(x)) return String(n ?? '');
    if (x === 0) return '나눔';
    return `${x.toLocaleString('ko-KR')}원`;
  };

  Root.formatSellerLine = (seller, platform) => {
    if (!seller) return '';
    const bits = [];
    const name = seller.name || seller.shopName || seller.nickname || '';
    if (name) bits.push(name);
    if (seller.isProshop) bits.push('프로상점');
    if (platform === 'daangn' && Number.isFinite(seller.mannerScore))
      bits.push(`매너온도 ${seller.mannerScore}°C`);
    if (platform !== 'daangn' && Number.isFinite(seller.reviewRating))
      bits.push(`평점 ${seller.reviewRating}`);
    if (Number.isFinite(seller.reviewCount) && seller.reviewCount >= 0)
      bits.push(`리뷰 ${seller.reviewCount.toLocaleString('ko-KR')}개`);
    if (Number.isFinite(seller.salesCount) && seller.salesCount >= 0)
      bits.push(`판매·거래 ${seller.salesCount.toLocaleString('ko-KR')}건`);
    if (seller.location) bits.push(seller.location);
    return bits.join(' · ');
  };

  Root.mergeUnique = (a = [], b = []) => {
    const seen = new Set();
    const out = [];
    for (const xs of [a, b]) {
      for (const u of xs || []) {
        if (!u || seen.has(u)) continue;
        seen.add(u);
        out.push(u);
      }
    }
    return out;
  };

  Root.textFromHtml = (raw) => {
    const s = String(raw || '').trim();
    if (!s) return '';
    if (!/<[^>]{1,120}>/.test(s)) return s;
    try {
      const tpl = document.createElement('template');
      tpl.innerHTML = s;
      return (tpl.textContent || '')
        .replace(/\u00a0/g, ' ')
        .replace(/\s+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    } catch {
      return s.replace(/<[^>]{0,200}>/g, ' ').replace(/\s+/g, ' ').trim();
    }
  };

  let latest = null;
  let host = null;
  let shadow = null;
  let open = false;
  let analyzerOpenTimer = null;

  function setPanelOpen(nextOpen) {
    open = Boolean(nextOpen);
    shadow?.getElementById('msPanel')?.classList.toggle('open', open);
  }

  function updateFloatingVisibility() {
    const ad = Root.getAdapter();
    const supported = Boolean(ad);
    const onDetail = supported && typeof ad.isDetailPage === 'function' ? ad.isDetailPage() : false;
    const launcher = shadow?.getElementById('msLauncher');
    if (launcher) launcher.style.display = supported ? '' : 'none';
    launcher?.classList.toggle('daangn', ad?.id === 'daangn');
    if (!supported) setPanelOpen(false);
    return { ad, supported, onDetail };
  }

  function ensureHost() {
    if (host && document.documentElement.contains(host)) return;
    document.getElementById('market-scrape-root')?.remove();
    host = document.createElement('div');
    host.id = 'market-scrape-root';
    Object.assign(host.style, {
      all: 'initial',
      position: 'fixed',
      right: '24px',
      bottom: '24px',
      zIndex: '2147483646',
      fontFamily: 'Pretendard, system-ui, -apple-system, sans-serif',
    });
    document.documentElement.appendChild(host);
    shadow = host.attachShadow({ mode: 'open' });
    const iconUrl = chrome.runtime.getURL('icons/icon32.png');
    shadow.innerHTML = `
<style>
*{box-sizing:border-box}
.dock{position:fixed;right:24px;bottom:24px;display:flex;align-items:center;gap:8px}
.launch{width:48px;height:48px;border-radius:999px;border:1px solid rgba(0,0,0,.08);background:#fff;box-shadow:0 8px 28px rgba(0,0,0,.24);cursor:pointer;display:grid;place-items:center;padding:0;transition:transform .16s ease,box-shadow .16s ease}
.launch.daangn{border-color:rgba(255,111,15,.32);box-shadow:0 8px 28px rgba(255,111,15,.26)}
.launch img{width:32px;height:32px;display:block}
.launch:hover{transform:translateY(-2px);box-shadow:0 12px 34px rgba(0,0,0,.28)}
.panel{position:fixed;right:24px;bottom:84px;width:min(420px,calc(100vw - 48px));max-height:min(78vh,640px);overflow:auto;background:#fff;color:#1a1a1a;border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,.18);border:1px solid #e5e8ed;padding:14px;opacity:0;visibility:hidden;pointer-events:none;transform:translateY(12px) scale(.96);transform-origin:right bottom;transition:opacity .18s ease,transform .18s ease,visibility .18s ease}
.panel.open{opacity:1;visibility:visible;pointer-events:auto;transform:translateY(0) scale(1)}
.head{font-weight:800;font-size:14px;margin-bottom:10px;display:flex;align-items:center;justify-content:space-between;gap:8px}
.badge{font-size:11px;font-weight:600;color:#5c6470;background:#f4f5f7;padding:3px 8px;border-radius:999px}
.price{font-size:18px;font-weight:800;margin:6px 0 8px}
.ttl{font-size:13px;line-height:1.45;font-weight:700;margin-bottom:8px;word-break:break-word}
.seller{font-size:12px;line-height:1.5;color:#2b3038;background:#f4f5f7;border-radius:10px;padding:10px;margin-bottom:4px;word-break:break-word}
.sec-title{font-size:11px;font-weight:700;color:#5c6470;margin:10px 0 6px}
.body{font-size:12px;line-height:1.55;white-space:pre-wrap;word-break:break-word;color:#2b3038;background:#f9fafb;border-radius:10px;padding:10px;max-height:200px;overflow:auto}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(72px,1fr));gap:6px}
.grid img{width:100%;height:76px;object-fit:cover;border-radius:8px;border:1px solid #eef1f6;cursor:zoom-in}
.actions{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px}
.btn{flex:1;min-width:120px;border:none;border-radius:10px;padding:8px 10px;font-weight:700;font-size:12px;cursor:pointer}
.btn-dark{background:#111;color:#fff}
.btn-light{background:#eef1f6;color:#111}
.btn-accent{background:#3b6cff;color:#fff}
.keywords{display:none;gap:6px;flex-wrap:wrap;margin-top:8px}
.keywords.open{display:flex}
.kw{border:1px solid #d9dee8;background:#fff;color:#111;border-radius:999px;padding:7px 10px;font-size:12px;font-weight:700;cursor:pointer}
.kw:hover{border-color:#3b6cff;color:#2f5fff;background:#f4f7ff}
.hint{margin-top:8px;font-size:11px;color:#8f96a3;line-height:1.45}
.err{color:#b42318;font-size:12px;margin-top:6px}
.toast{position:fixed;right:82px;bottom:29px;min-width:184px;max-width:min(300px,calc(100vw - 112px));padding:10px 12px;border-radius:999px;background:#111;color:#fff;font-size:12px;font-weight:800;box-shadow:0 10px 26px rgba(0,0,0,.2);opacity:0;visibility:hidden;transform:translateY(8px);transition:opacity .18s ease,transform .18s ease,visibility .18s ease;white-space:nowrap;text-align:center}
.toast.open{opacity:1;visibility:visible;transform:translateY(0)}
</style>
<div class="dock">
  <button class="launch" type="button" id="msLauncher" title="중고 매물 스크랩 열기" aria-label="중고 매물 스크랩 열기">
    <img src="${iconUrl}" alt="" />
  </button>
  <div class="toast" id="msToast" role="status" aria-live="polite"></div>
</div>
<div class="panel" id="msPanel">
  <div class="head"><span id="msHead">중고 매물</span><span class="badge" id="msSrc">—</span></div>
  <div class="price" id="msPrice">—</div>
  <div class="ttl" id="msTitle"></div>
  <div class="sec-title">판매자</div>
  <div class="seller" id="msSeller">—</div>
  <div class="sec-title">사진</div>
  <div class="grid" id="msImgs"></div>
  <div class="sec-title">본문</div>
  <div class="body" id="msBody"></div>
  <div class="actions">
    <button class="btn btn-accent" type="button" id="msSendWeb">분석 웹으로 보내기</button>
    <button class="btn btn-dark" type="button" id="msSearchComps">키워드 후보 만들기</button>
  </div>
  <div class="keywords" id="msKeywords"></div>
  <p class="hint">번개장터·당근 <strong>상세 페이지</strong>에서 동작합니다.</p>
  <div class="err" id="msErr"></div>
</div>`;

    shadow.getElementById('msLauncher')?.addEventListener('click', () => {
      void sendListingAndOpenAnalyzer();
    });
    shadow.getElementById('msSendWeb')?.addEventListener('click', async () => {
      const err = shadow.getElementById('msErr');
      try {
        if (err) err.textContent = '분석 웹으로 전송 중...';
        const r = await refresh({ openOnSuccess: false, save: true });
        if (!r?.ok) throw new Error(r?.error || '매물 데이터 저장 실패');
        const opened = await chrome.runtime.sendMessage({ type: 'OPEN_ANALYZER_TAB' });
        if (!opened?.ok) throw new Error(opened?.error || '분석 웹 열기 실패');
        if (err) err.textContent = '분석 웹으로 보냈습니다.';
      } catch (e) {
        if (err) err.textContent = e instanceof Error ? e.message : String(e);
      }
    });
    shadow.getElementById('msSearchComps')?.addEventListener('click', () => {
      void buildKeywordChoicesFromPanel();
    });
    shadow.getElementById('msImgs')?.addEventListener('click', (ev) => {
      const t = ev.target;
      if (t?.tagName === 'IMG' && t.src) window.open(t.src, '_blank', 'noopener,noreferrer');
    });
  }

  function toMarkdown(u) {
    if (!u) return '';
    const lines = [
      `# ${u.title}`,
      '',
      `**플랫폼:** ${u.platformLabel}`,
      `**가격:** ${u.priceLabel}`,
      '',
    ];
    const sline = Root.formatSellerLine(u.seller, u.platform);
    if (sline) lines.push('**판매자:**', sline, '');
    lines.push(
      '**본문:**',
      '',
      u.body,
      '',
      '**사진:**',
      ...(u.imageUrls || []).map((x) => `- ![img](${x})`),
      '',
      `_${u.platform} · ${u.itemId} · ${u.source}_`
    );
    return lines.join('\n');
  }

  function showToast(message) {
    const toast = shadow?.getElementById('msToast');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('open');
  }

  function hideToast() {
    const toast = shadow?.getElementById('msToast');
    if (!toast) return;
    toast.classList.remove('open');
  }

  async function sendListingAndOpenAnalyzer() {
    setPanelOpen(false);
    if (analyzerOpenTimer) {
      clearTimeout(analyzerOpenTimer);
      analyzerOpenTimer = null;
    }
    try {
      showToast('분석 웹으로 전송 중...');
      const r = await refresh({ openOnSuccess: false, save: true });
      if (!r?.ok) throw new Error(r?.error || '매물 데이터 저장 실패');
      showToast('전송됐습니다. 3초 뒤 분석 웹으로 이동합니다.');
      analyzerOpenTimer = setTimeout(() => {
        analyzerOpenTimer = null;
        hideToast();
        void chrome.runtime.sendMessage({ type: 'OPEN_ANALYZER_TAB' });
      }, 3000);
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e));
    }
  }

  async function ensureListingForPanel() {
    if (latest?.title) return latest;
    const r = await refresh({ openOnSuccess: false, save: false });
    if (!r?.ok || !latest?.title) throw new Error(r?.error || '매물 정보를 불러올 수 없습니다.');
    return latest;
  }

  async function getPanelSearchQueries(listing) {
    const st = await chrome.storage.local.get(['ulsaGeminiApiKey', 'ulsaGeminiModel']);
    const apiKey = typeof st.ulsaGeminiApiKey === 'string' ? st.ulsaGeminiApiKey.trim() : '';
    if (!apiKey) {
      throw new Error('분석 웹에서 Gemini API 키를 먼저 저장하세요.');
    }

    const model = st.ulsaGeminiModel || 'gemini-2.5-flash';
    const res = await fetch('http://127.0.0.1:3920/api/search-query', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Gemini-Key': apiKey,
        'X-Gemini-Model': model,
      },
      body: JSON.stringify({
        title: listing.title,
        body: listing.body || '',
        imageUrls: Array.isArray(listing.imageUrls) ? listing.imageUrls : [],
        maxQueries: 3,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `검색어 생성 실패 HTTP ${res.status}`);
    const rawQueries = Array.isArray(data.queries)
      ? data.queries
      : [String(data.query || '').trim()].filter(Boolean);
    const queries = [];
    const seen = new Set();
    const noiseWords =
      '새상품|미개봉|단순\\s*개봉|개봉만|개봉|급처|네고|택포|직거래|택배|배송|교환|환불|판매|팝니다|팔아요|구매|구입|인증|가능|불가|원하시면|원하신다면|찾는다면|좋습니다|드립니다|드려요|상태|컨디션|외관|기스|찍힘|하자|사용감|사용|실사용|시착|착용|보관|구성품|구성|포함|더스트|관련텍|부속|부분가죽|색상|사이즈|저렴|깨끗|오늘|방금';
    for (const item of rawQueries) {
      const q = String(item || '')
        .replace(/```(?:json)?/gi, ' ')
        .replace(/[`{}[\]"]/g, ' ')
        .replace(new RegExp(`\\([^)]*(?:${noiseWords})[^)]*\\)`, 'gi'), ' ')
        .replace(new RegExp(`\\s*(?:${noiseWords}).*`, 'i'), '')
        .replace(/\s+/g, ' ')
        .trim();
      if (!q || /^json$/i.test(q) || /queries\s*:/.test(q) || /검색결과|사진과|판매자/.test(q)) continue;
      const key = q.replace(/\s+/g, '').toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      queries.push(q);
      if (queries.length >= 3) break;
    }
    if (!queries.length) throw new Error('검색어 후보가 비었습니다.');
    return queries;
  }

  async function openSearchAndCollect(query) {
    const err = shadow?.getElementById('msErr');
    const opened = await chrome.runtime.sendMessage({ type: 'OPEN_SEARCH_TABS', query });
    if (!opened?.ok) throw new Error(opened?.error || '검색 탭 열기 실패');
    if (err) err.textContent = `검색어 「${query}」로 번개·당근 탭을 열었습니다. 수집 후 자동으로 닫힙니다.`;
  }

  function renderKeywordChoices(queries) {
    const box = shadow?.getElementById('msKeywords');
    if (!box) return;
    box.innerHTML = '';
    for (const q of queries.slice(0, 3)) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'kw';
      btn.textContent = q;
      btn.addEventListener('click', () => {
        void (async () => {
          try {
            await openSearchAndCollect(q);
          } catch (e) {
            const err = shadow?.getElementById('msErr');
            if (err) err.textContent = e instanceof Error ? e.message : String(e);
          }
        })();
      });
      box.appendChild(btn);
    }
    box.classList.toggle('open', box.childElementCount > 0);
  }

  async function buildKeywordChoicesFromPanel() {
    const err = shadow?.getElementById('msErr');
    try {
      if (err) err.textContent = 'AI가 키워드 후보를 만드는 중...';
      const listing = await ensureListingForPanel();
      const queries = await getPanelSearchQueries(listing);
      renderKeywordChoices(queries);
      if (err) err.textContent = '후보 생성 완료. 테스트할 키워드를 누르면 자동 수집합니다.';
    } catch (e) {
      if (err) err.textContent = e instanceof Error ? e.message : String(e);
    }
  }

  function render(data, errMsg) {
    ensureHost();
    latest = data;
    const launcher = shadow.getElementById('msLauncher');
    shadow.getElementById('msErr').textContent = errMsg || '';
    launcher?.classList.toggle('daangn', data?.platform === 'daangn');

    if (!data) {
      shadow.getElementById('msPrice').textContent = '—';
      shadow.getElementById('msTitle').textContent = errMsg ? '데이터를 가져오지 못했습니다.' : '';
      shadow.getElementById('msSeller').textContent = '—';
      shadow.getElementById('msBody').textContent = '';
      shadow.getElementById('msImgs').innerHTML = '';
      shadow.getElementById('msSrc').textContent = '—';
      return;
    }

    shadow.getElementById('msPrice').textContent = data.priceLabel;
    shadow.getElementById('msTitle').textContent = data.title;
    shadow.getElementById('msSeller').textContent =
      Root.formatSellerLine(data.seller, data.platform) || '(판매자 정보 없음)';
    shadow.getElementById('msBody').textContent = data.body;
    shadow.getElementById('msSrc').textContent = data.sourceLabel || data.source;
    const imgsEl = shadow.getElementById('msImgs');
    imgsEl.innerHTML = '';
    for (const src of data.imageUrls || []) {
      const im = document.createElement('img');
      im.loading = 'lazy';
      im.decoding = 'async';
      im.src = src;
      im.alt = '상품';
      imgsEl.appendChild(im);
    }
  }

  async function refresh(opts = {}) {
    const { openOnSuccess = false, save = false } = opts;
    ensureHost();
    const adapter = Root.getAdapter();
    if (!adapter) {
      render(null, '번개장터·당근마켓 상세 페이지에서만 동작합니다.');
      latest = null;
      return { ok: false, error: '지원하지 않는 사이트' };
    }

    if (typeof adapter.isDetailPage === 'function' && !adapter.isDetailPage()) {
      render(null, `${adapter.label} 매물 상세 페이지에서만 동작합니다.`);
      latest = null;
      return { ok: false, error: '매물 상세 페이지가 아닙니다' };
    }

    const itemId = adapter.guessItemId();
    if (!itemId) {
      render(null, `${adapter.label} 매물 상세 페이지를 연 뒤 다시 시도하세요.`);
      latest = null;
      return { ok: false, error: '매물 상세 아님' };
    }

    shadow.getElementById('msHead').textContent = `${adapter.label} (${itemId})`;

    try {
      const data = await adapter.fetchListing(itemId);
      if (!data) throw new Error('매물 데이터가 비어 있습니다.');
      render(data, data._warn || '');
      if (save && typeof Root.saveListing === 'function') await Root.saveListing(data);
      if (openOnSuccess) setPanelOpen(true);
      return { ok: true, imageCount: data.imageUrls?.length ?? 0, platform: adapter.id };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      render(null, msg);
      latest = null;
      return { ok: false, error: msg };
    }
  }

  Root.boot = () => {
    if (Root.__routeTimer) clearInterval(Root.__routeTimer);
    if (Root.__hostWatchTimer) clearInterval(Root.__hostWatchTimer);

    ensureHost();
    updateFloatingVisibility();

    chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
      if (!msg?.type) return undefined;
      (async () => {
        switch (msg.type) {
          case 'TOGGLE_PANEL':
            setPanelOpen(!open);
            sendResponse({ ok: true });
            break;
          case 'REFRESH':
            sendResponse(await refresh({ openOnSuccess: true, save: false }));
            break;
          case 'GET_LISTING': {
            const r = await refresh({ openOnSuccess: false, save: false });
            if (!r?.ok || !latest) {
              sendResponse({ ok: false, error: r?.error || '매물 데이터 없음' });
              break;
            }
            sendResponse({
              ok: true,
              listing: {
                platform: latest.platform,
                platformLabel: latest.platformLabel,
                title: latest.title,
                priceLabel: latest.priceLabel,
                body: latest.body,
                imageUrls: latest.imageUrls || [],
                imageCount: latest.imageUrls?.length ?? 0,
              },
            });
            break;
          }
          case 'REFRESH_AND_SAVE':
            sendResponse(await refresh({ openOnSuccess: false, save: true }));
            break;
          case 'SEND_TO_ANALYZER':
            void sendListingAndOpenAnalyzer();
            sendResponse({ ok: true });
            break;
          case 'COLLECT_SEARCH': {
            const ad = Root.getAdapter();
            if (!ad?.isSearchPage?.()) {
              sendResponse({ ok: false, error: '검색 결과 페이지가 아닙니다.' });
              break;
            }
            const items = ad.harvestSearchListings?.() || [];
            const q =
              new URL(location.href).searchParams.get('q') ||
              new URL(location.href).searchParams.get('search') ||
              '';
            await Root.saveComps(ad.id, items, { searchUrl: location.href, query: q });
            sendResponse({ ok: true, count: items.length, platform: ad.id });
            break;
          }
          case 'GET_JSON':
            if (!latest) {
              sendResponse({ ok: false, error: '먼저 «데이터 다시 불러오기»를 실행하세요.' });
              break;
            }
            const sellerClean = latest.seller
              ? Object.fromEntries(Object.entries(latest.seller).filter(([k]) => !k.startsWith('_')))
              : null;
            sendResponse({
              ok: true,
              json: JSON.stringify(
                {
                  platform: latest.platform,
                  platformLabel: latest.platformLabel,
                  itemId: latest.itemId,
                  title: latest.title,
                  price: latest.price,
                  priceLabel: latest.priceLabel,
                  body: latest.body,
                  imageUrls: latest.imageUrls,
                  seller: sellerClean,
                  source: latest.source,
                  pageUrl: location.href,
                  exportedAt: new Date().toISOString(),
                },
                null,
                2
              ),
            });
            break;
          default:
            sendResponse({ ok: false });
        }
      })();
      return true;
    });

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes.marketScrapeAutoCollect) return;
      void Root.tryAutoCollectSearch?.();
    });

    let lastHref = location.href;
    Root.__routeTimer = setInterval(() => {
      if (Root.__activeInstanceId !== INSTANCE_ID) return;
      if (location.href === lastHref) return;
      lastHref = location.href;
      setPanelOpen(false);
      const { ad: a, onDetail } = updateFloatingVisibility();
      if (onDetail && a?.isDetailPage?.()) void refresh({ openOnSuccess: false, save: false });
    }, 1000);

    Root.__hostWatchTimer = setInterval(() => {
      if (Root.__activeInstanceId !== INSTANCE_ID) return;
      const missing = !host || !document.documentElement.contains(host) || !shadow;
      if (missing) {
        host = null;
        shadow = null;
        ensureHost();
      }
      updateFloatingVisibility();
    }, 1200);

    if (Root.getAdapter()?.isDetailPage?.()) void refresh({ openOnSuccess: false, save: false });

    void Root.tryAutoCollectSearch?.();
  };

  Root.tryAutoCollectSearch = async () => {
    const ad = Root.getAdapter();
    if (!ad?.isSearchPage?.() || typeof ad.harvestSearchListings !== 'function') return;

    const res = await chrome.storage.local.get(['marketScrapeAutoCollect']);
    const flags = res.marketScrapeAutoCollect;
    if (!flags?.[ad.id]) return;
    if (flags.at && Date.now() - flags.at > 3 * 60 * 1000) return;

    let items = [];
    for (let i = 0; i < 4; i += 1) {
      await new Promise((r) => setTimeout(r, i === 0 ? 2000 : 1500));
      items = ad.harvestSearchListings();
      if (items.length) break;
    }
    const q =
      new URL(location.href).searchParams.get('q') ||
      new URL(location.href).searchParams.get('search') ||
      '';
    await Root.saveComps(ad.id, items, { searchUrl: location.href, query: q });
    const next = { ...flags, [ad.id]: false };
    await chrome.storage.local.set({ marketScrapeAutoCollect: next });
  };
})();
