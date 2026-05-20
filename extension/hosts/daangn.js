/** @file 당근마켓 (daangn.com) 어댑터 */
(() => {
  const { register, formatWon, textFromHtml } = globalThis.MarketScrape;

  function parseRemixContextFromString(html, marker = 'window.__remixContext = ') {
    const start = html.indexOf(marker);
    if (start < 0) return null;
    const jsonStart = start + marker.length;
    let depth = 0;
    let end = -1;
    for (let i = jsonStart; i < html.length; i += 1) {
      if (html[i] === '{') depth += 1;
      else if (html[i] === '}') {
        depth -= 1;
        if (depth === 0) {
          end = i + 1;
          break;
        }
      }
    }
    if (end < 0) return null;
    try {
      return JSON.parse(html.slice(jsonStart, end));
    } catch {
      return null;
    }
  }

  function findProductInLoaderData(ld) {
    if (!ld || typeof ld !== 'object') return null;
    for (const [key, val] of Object.entries(ld)) {
      if (!val?.product?.title) continue;
      if (/buy[._-]?sell|buy_sell/i.test(key)) return val.product;
    }
    for (const val of Object.values(ld)) {
      if (val?.product?.title) return val.product;
    }
    return null;
  }

  function getProductFromStaticHtml() {
    const ctx =
      parseRemixContextFromString(document.documentElement.innerHTML) ||
      (() => {
        for (const script of document.querySelectorAll('script:not([src])')) {
          const t = script.textContent || '';
          if (!t.includes('__remixContext')) continue;
          const c = parseRemixContextFromString(t);
          if (c?.state?.loaderData) return c;
        }
        return null;
      })();
    return findProductInLoaderData(ctx?.state?.loaderData);
  }

  const DETAIL_PATH_RE = /\/(?:kr\/)?buy-sell\/[^/?#]+-([a-z0-9]+)\/?$/i;

  function extractItemIdFromUrl(url = location.href) {
    try {
      const m = new URL(url, location.origin).pathname.match(DETAIL_PATH_RE);
      return m?.[1] || null;
    } catch {
      return null;
    }
  }

  function isDetailPage(url = location.href) {
    if (extractItemIdFromUrl(url)) return true;
    const canonical = document.querySelector('link[rel="canonical"]')?.href || '';
    const ogUrl = document.querySelector('meta[property="og:url"]')?.getAttribute('content') || '';
    return Boolean(extractItemIdFromUrl(canonical) || extractItemIdFromUrl(ogUrl));
  }

  function isListingImageUrl(url) {
    const u = String(url || '').split(/[?#]/)[0];
    if (!/^https?:\/\//i.test(u)) return false;
    if (
      !/img\.kr\.gcp-karroter\.net|images\.daangn\.com|image\.daangn\.com|karrot-market|dnvefa72aowie\.cloudfront\.net|daangncdn/i.test(
        u
      )
    )
      return false;
    if (
      /profile|avatar|user_profile|\/users\/|manner|emoji|static\/|icon|logo|banner|advert|thumbnail_seller|seller/i.test(
        u
      )
    )
      return false;
    return /\.(webp|jpg|jpeg|png)/i.test(u);
  }

  function mapImages(images) {
    if (!Array.isArray(images)) return [];
    const out = [];
    for (const it of images) {
      const raw =
        typeof it === 'string' ? it : it?.url || it?.thumbnail || it?.imageUrl || it?.src || '';
      if (raw && isListingImageUrl(raw)) out.push(String(raw).split(/[?#]/)[0]);
    }
    return [...new Set(out)];
  }

  function findDaangnGalleryRoot() {
    const scoped =
      document.querySelector(
        '[class*="ArticleImage" i], [class*="article-image" i], [class*="ImageCarousel" i], [class*="carousel" i][class*="Image" i], [data-testid*="article-image" i]'
      ) || null;
    if (scoped && !globalThis.MarketScrape.isInsideNoiseSection(scoped)) return scoped;
    return globalThis.MarketScrape.findDetailRootNearTitle();
  }

  function harvestImagesFromDom() {
    const root = findDaangnGalleryRoot();
    return globalThis.MarketScrape.collectImgUrlsInRoot(root, isListingImageUrl);
  }

  const BODY_STOP_RE =
    /(?:비슷한\s*매물|이\s*글과\s*함께|다른\s*매물|판매자의?\s*다른|인기\s*매물|최근\s*본|댓글\s*\d|채팅하기|거래\s*후기|더보기\s*$)/;

  function sanitizeDaangnBody(raw) {
    let t = String(raw || '')
      .replace(/\u00a0/g, ' ')
      .replace(/\r\n/g, '\n')
      .trim();
    if (!t) return '';

    const viewCut = t.match(/조회\s*[\d,]+\s*/u);
    if (viewCut && viewCut.index != null && viewCut.index < 120) {
      t = t.slice(viewCut.index + viewCut[0].length).trim();
    }

    const stop = t.search(BODY_STOP_RE);
    if (stop > 20) t = t.slice(0, stop).trim();

    for (const kw of ['비슷한 매물', '이 글과 함께', '판매자의 다른', '인기 매물']) {
      const i = t.indexOf(kw);
      if (i > 20) {
        t = t.slice(0, i).trim();
        break;
      }
    }

    const lines = t
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => {
        if (!line) return false;
        if (/^\d{1,3}(?:\.\d+)?\s*°?\s*C$/i.test(line)) return false;
        if (/^조회\s*[\d,]+$/.test(line)) return false;
        if (/^(채팅|찜|매너|공유|신고)\b/.test(line)) return false;
        if (/^\d{1,2}:\d{2}$/.test(line)) return false;
        if (/^[\d,]+\s*원\s*$/.test(line)) return false;
        if (/시\s*$|구\s*$|동\s*$/.test(line) && line.length < 24 && !/[.!?]/.test(line)) return false;
        return true;
      });

    t = lines.join('\n').trim();
    if (t.length > 4000) t = t.slice(0, 4000).trim();
    return t;
  }

  function harvestBodyFromDom() {
    const MS = globalThis.MarketScrape;
    const selectors = [
      '[data-testid*="article-description" i]',
      '[class*="ArticleDescription" i]',
      '[class*="article-description" i]',
      '[class*="ProductDescription" i]',
      'main [class*="Description" i]',
    ];
    const candidates = [];

    for (const sel of selectors) {
      for (const el of document.querySelectorAll(sel)) {
        if (MS.isInsideNoiseSection(el)) continue;
        const t = (el.innerText || '').trim();
        if (t.length < 4 || t.length > 3500) continue;
        candidates.push(t);
      }
    }

    candidates.sort((a, b) => a.length - b.length);
    for (const raw of candidates) {
      const clean = sanitizeDaangnBody(raw);
      if (clean.length >= 4) return clean;
    }

    const ogDesc = document.querySelector('meta[property="og:description"]')?.getAttribute('content')?.trim();
    if (ogDesc) {
      const clean = sanitizeDaangnBody(ogDesc);
      if (clean.length >= 4) return clean;
    }
    return '';
  }

  function pickBodyFromProduct(p) {
    const domBody = harvestBodyFromDom();
    let best = domBody;

    for (const key of ['content', 'description', 'contentText', 'body', 'memo']) {
      const t = sanitizeDaangnBody(textFromHtml(p?.[key]));
      if (t.length < 4) continue;
      if (!best || (t.length < best.length && t.length >= 4)) best = t;
      else if (!best) best = t;
    }

    if (best && domBody) {
      if (domBody.length >= 4 && domBody.length <= best.length * 0.85) return domBody;
    }
    return best || domBody || '';
  }

  function scrapeProductFromDom() {
    const itemId =
      extractItemIdFromUrl() ||
      extractItemIdFromUrl(document.querySelector('link[rel="canonical"]')?.href || '') ||
      extractItemIdFromUrl(document.querySelector('meta[property="og:url"]')?.getAttribute('content') || '');
    const rawOgTitle = document.querySelector('meta[property="og:title"]')?.getAttribute('content')?.trim() || '';
    const title =
      document.querySelector('h1')?.textContent?.trim() ||
      rawOgTitle.replace(/\s*[|｜].*$/, '').trim() ||
      document.title?.split('|')[0]?.trim() ||
      '';

    let body = harvestBodyFromDom();

    const txt = document.body?.innerText || '';
    const priceM = txt.match(/([\d,]+)\s*원/);
    const mannerM = txt.match(/(\d{2,3}(?:\.\d+)?)\s*°?\s*C/i);
    const reviewM = txt.match(/후기\s*([\d,]+)/);

    const nick =
      document.querySelector('a[href*="/users/"]')?.textContent?.trim() ||
      document.querySelector('[class*="nickname" i]')?.textContent?.trim() ||
      '';

    let imgs = harvestImagesFromDom();
    const ogImg = document.querySelector('meta[property="og:image"]')?.getAttribute('content');
    if (!imgs.length && ogImg && isListingImageUrl(ogImg)) imgs = [ogImg.split(/[?#]/)[0]];

    if (!title && !body && !imgs.length) return null;

    return {
      id: itemId,
      title,
      content: body,
      price: priceM ? priceM[1].replace(/,/g, '') : '0',
      images: imgs,
      locationName: '',
      user: {
        nickname: nick,
        score: mannerM ? Number(mannerM[1]) : null,
        reviewCount: reviewM ? Number(reviewM[1].replace(/,/g, '')) : null,
      },
      _fromDom: true,
    };
  }

  function productToListing(p, itemId) {
    const u = p.user || {};
    const priceRaw = String(p.price ?? '').replace(/,/g, '');
    const priceNum = Number(priceRaw);
    const isFree = priceRaw === '0' || p.price === 0;

    let imageUrls = mapImages(p.images);
    if (!imageUrls.length && p._fromDom) imageUrls = harvestImagesFromDom();

    return {
      platform: 'daangn',
      platformLabel: '당근마켓',
      itemId: String(p.id || itemId),
      title: String(p.title || '').trim(),
      price: Number.isFinite(priceNum) ? priceNum : p.price,
      priceLabel: isFree || p.price === '나눔' ? '나눔' : formatWon(priceNum),
      body: pickBodyFromProduct(p),
      imageUrls,
      seller: {
        nickname: u.nickname || '',
        mannerScore: u.score != null ? Number(u.score) : null,
        reviewCount: u.reviewCount != null ? Number(u.reviewCount) : null,
        location: u.region?.name || p.locationName || '',
      },
      source: p._fromDom ? 'dom' : 'remix',
      sourceLabel: p._fromDom ? 'DOM' : 'Remix',
    };
  }

  async function getProductFromPage() {
    let p = getProductFromStaticHtml();
    if (p) return p;

    return scrapeProductFromDom();
  }

  function isSearchPage(url = location.href) {
    return globalThis.MarketScrape.isDaangnSearchUrl(url);
  }

  function harvestSearchListings() {
    const MS = globalThis.MarketScrape;
    const items = [];
    const seen = new Set();
    const query = MS.getSearchQueryFromUrl?.(location.href) || '';

    for (const a of document.querySelectorAll('a[href*="/kr/buy-sell/"]')) {
      if (MS.isInsideNoiseSection(a)) continue;
      let path;
      try {
        path = new URL(a.href, location.origin).pathname;
      } catch {
        continue;
      }
      const m = path.match(DETAIL_PATH_RE);
      if (!m || seen.has(m[1])) continue;

      const card = a.closest('article, li, div') || a;
      const text = (card.innerText || '').trim();
      const title = (a.getAttribute('aria-label') || text.split('\n')[0] || '').trim().slice(0, 120);
      if (!MS.listingTitleMatchesSearchQuery?.(title, query)) continue;

      const statusM = text.match(/판매완료|예약중|거래완료/);
      const saleStatus = statusM ? statusM[0] : '';

      seen.add(m[1]);
      const priceM = text.match(/([\d,]+)\s*원/);
      const price = MS.parsePriceNumber(priceM?.[1]);

      items.push({
        platform: 'daangn',
        platformLabel: '당근마켓',
        itemId: m[1],
        title: title || `매물 ${m[1]}`,
        price,
        priceLabel: price != null ? formatWon(price) : priceM?.[0] || '—',
        url: a.href.split('?')[0],
        ...(saleStatus ? { saleStatus } : {}),
      });
    }
    return items;
  }

  register({
    id: 'daangn',
    label: '당근마켓',
    matches: (host) => host === 'www.daangn.com' || host.endsWith('.daangn.com'),
    isDetailPage,
    isSearchPage,
    harvestSearchListings,
    guessItemId: () => extractItemIdFromUrl(),
    async fetchListing(itemId) {
      const p = await getProductFromPage();
      if (!p?.title && !(p?.images?.length)) {
        throw new Error(
          '매물 데이터를 찾지 못했습니다. 페이지를 F5로 새로고침한 뒤 «데이터 다시 불러오기»를 눌러 주세요.'
        );
      }
      return productToListing(p, itemId);
    },
  });
})();
