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

  function bodyLooksTruncated(text) {
    return /(?:\.{3}|…)\s*$/.test(String(text || '').trim());
  }

  function collectBodyCandidatesFromObject(value, out = [], path = '') {
    if (!value || out.length > 80) return out;
    if (typeof value === 'string') {
      const keyHint = /content|description|body|text|article|detail|memo/i.test(path);
      if (!keyHint) return out;
      const clean = sanitizeDaangnBody(textFromHtml(value));
      if (clean.length >= 8) out.push(clean);
      return out;
    }
    if (Array.isArray(value)) {
      value.slice(0, 80).forEach((item, idx) => collectBodyCandidatesFromObject(item, out, `${path}.${idx}`));
      return out;
    }
    if (typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) {
        if (/image|photo|thumbnail|avatar|profile|url|href|price|count|id$/i.test(key)) continue;
        collectBodyCandidatesFromObject(child, out, path ? `${path}.${key}` : key);
      }
    }
    return out;
  }

  function pickBestBodyCandidate(candidates) {
    const unique = [...new Set(candidates.map((text) => sanitizeDaangnBody(text)).filter((text) => text.length >= 4))];
    unique.sort((a, b) => {
      const ta = bodyLooksTruncated(a) ? 1 : 0;
      const tb = bodyLooksTruncated(b) ? 1 : 0;
      if (ta !== tb) return ta - tb;
      return b.length - a.length;
    });
    return unique[0] || '';
  }

  function findProductInLoaderData(ld) {
    if (!ld || typeof ld !== 'object') return null;
    const bodyCandidates = collectBodyCandidatesFromObject(ld);
    for (const [key, val] of Object.entries(ld)) {
      if (!val?.product?.title) continue;
      if (/buy[._-]?sell|buy_sell/i.test(key)) return { ...val.product, _bodyCandidates: bodyCandidates };
    }
    for (const val of Object.values(ld)) {
      if (val?.product?.title) return { ...val.product, _bodyCandidates: bodyCandidates };
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

  function decodedImageHint(url) {
    let parsed;
    try {
      parsed = new URL(String(url || '').trim(), location.href);
    } catch {
      return String(url || '').toLowerCase();
    }
    let hint = `${parsed.hostname}${parsed.pathname}${parsed.search}`.toLowerCase();
    for (let i = 0; i < 2; i += 1) {
      try {
        const next = decodeURIComponent(hint);
        if (next === hint) break;
        hint = next;
      } catch {
        break;
      }
    }
    return hint;
  }

  function isDaangnArticleImageUrl(url) {
    const hint = decodedImageHint(url);
    return (
      /karrotmarket\.com|gcp-karroter\.net|daangncdn|daangn\.com|cloudfront\.net/i.test(hint) &&
      /\/origin\/article\//i.test(hint)
    );
  }

  function isListingImageUrl(url) {
    if (isDaangnArticleImageUrl(url)) return true;
    let parsed;
    try {
      parsed = new URL(String(url || '').trim(), location.href);
    } catch {
      return false;
    }
    if (!/^https?:$/i.test(parsed.protocol)) return false;
    const host = parsed.hostname.toLowerCase();
    const path = `${parsed.pathname}${parsed.search}`.toLowerCase();
    let decodedPath = path;
    for (let i = 0; i < 2; i += 1) {
      try {
        const next = decodeURIComponent(decodedPath);
        if (next === decodedPath) break;
        decodedPath = next;
      } catch {
        break;
      }
    }
    const imageHint = `${host}${decodedPath}`;
    if (!/daangn|karrot|karroter|karrotmarket|cloudfront|daangncdn/i.test(host)) return false;
    if (
      /profile|avatar|user_profile|\/users\/|manner|emoji|\/static\/|\/icon|\/logo|\/banner|\/advert|thumbnail_seller|seller_profile/i.test(
        decodedPath
      )
    )
      return false;
    if (
      /app[\s._-]*store|google[\s._-]*play|play[\s._-]*store|store[\s._-]*badge|play[\s._-]*badge|apple[\s._-]*badge|download[\s._-]*app|app[\s._-]*download/i.test(
        imageHint
      )
    )
      return false;
    if (/\.svg(?:$|[?#&])/i.test(decodedPath)) return false;
    if (/download|badge/i.test(decodedPath) && !/article|product|media|thumbnail|listing|buy-sell/i.test(decodedPath)) {
      return false;
    }
    return true;
  }

  function isDaangnPromoImageUrl(url) {
    if (isDaangnArticleImageUrl(url)) return false;
    const hint = decodedImageHint(url);
    return (
      /app[\s._-]*store|google[\s._-]*play|play[\s._-]*store|store[\s._-]*badge|play[\s._-]*badge|apple[\s._-]*badge|download[\s._-]*app|app[\s._-]*download/i.test(
        hint
      ) ||
      /\.svg(?:$|[?#&])/i.test(hint) ||
      /\/_next\/static\/|\/static\/media\/|open[\s._-]*graph|opengraph|og[\s._-]*image|share[\s._-]*image|(?:^|[\/_.-])landing(?:[\/_.-]|$)|home[\s._-]*banner|(?:^|[\/_.-])intro(?:[\/_.-]|$)|(?:^|[\/_.-])brand(?:[\/_.-]|$)|(?:^|[\/_.-])marketing(?:[\/_.-]|$)|(?:^|[\/_.-])promotion(?:[\/_.-]|$)|(?:^|[\/_.-])promo(?:[\/_.-]|$)|(?:^|[\/_.-])download(?:[\/_.-]|$)|(?:^|[\/_.-])advert(?:[\/_.-]|$)|(?:^|[\/_.-])banner(?:[\/_.-]|$)/i.test(
        hint
      )
    );
  }

  function mapImages(images) {
    if (!Array.isArray(images)) return [];
    const out = [];
    for (const it of images) {
      const raw =
        typeof it === 'string' ? it : it?.url || it?.thumbnail || it?.imageUrl || it?.src || '';
      if (raw && isListingImageUrl(raw)) out.push(String(raw));
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

    const bestDom = pickBestBodyCandidate(candidates);
    if (bestDom && !bodyLooksTruncated(bestDom)) return bestDom;

    const fallbackCandidates = [bestDom];
    const ogDesc = document.querySelector('meta[property="og:description"]')?.getAttribute('content')?.trim();
    if (ogDesc) fallbackCandidates.push(ogDesc);
    const metaDesc = document.querySelector('meta[name="description"]')?.getAttribute('content')?.trim();
    if (metaDesc) fallbackCandidates.push(metaDesc);
    for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const parsed = JSON.parse(script.textContent || '{}');
        fallbackCandidates.push(...collectBodyCandidatesFromObject(parsed));
      } catch {
        /* ignore invalid structured data */
      }
    }
    return pickBestBodyCandidate(fallbackCandidates);
  }

  function pickBodyFromProduct(p) {
    const domBody = harvestBodyFromDom();
    let best = domBody;

    const candidates = [domBody, ...(Array.isArray(p?._bodyCandidates) ? p._bodyCandidates : [])];
    for (const key of ['content', 'description', 'contentText', 'body', 'memo']) {
      const t = sanitizeDaangnBody(textFromHtml(p?.[key]));
      if (t.length < 4) continue;
      candidates.push(t);
    }

    best = pickBestBodyCandidate(candidates);
    return best || domBody || '';
  }

  function cleanDaangnSellerLine(raw) {
    return String(raw || '')
      .replace(/\u00a0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function looksDaangnLocationLine(line) {
    const t = cleanDaangnSellerLine(line);
    if (!t || t.length > 40 || /[.!?]|원|조회|채팅|찜|신고|공유/.test(t)) return false;
    return /^(?:서울|부산|대구|인천|광주|대전|울산|세종|경기|경기도|강원|강원도|충북|충청북도|충남|충청남도|전북|전라북도|전남|전라남도|경북|경상북도|경남|경상남도|제주|제주도)\s+.+(?:시|군|구|동|읍|면|리)$/u.test(
      t
    );
  }

  function looksDaangnSellerNameLine(line) {
    const t = cleanDaangnSellerLine(line);
    if (!t || t.length > 30) return false;
    if (looksDaangnLocationLine(t)) return false;
    if (/^(?:판매자|본문|사진|가격|상품|매너온도|후기|채팅|찜|조회|공유|신고|더보기)$/u.test(t)) return false;
    if (/[\d,]+\s*원|°\s*C|판매완료|예약중|거래완료/.test(t)) return false;
    return /[가-힣A-Za-z0-9]/.test(t);
  }

  function parseSellerFromPageText() {
    const lines = (document.body?.innerText || '')
      .split('\n')
      .map(cleanDaangnSellerLine)
      .filter(Boolean);

    for (let i = 0; i < lines.length; i += 1) {
      if (!/\d{2,3}(?:\.\d+)?\s*°?\s*C/i.test(lines[i])) continue;
      for (let j = i - 1; j >= Math.max(0, i - 5); j -= 1) {
        if (!looksDaangnLocationLine(lines[j])) continue;
        for (let k = j - 1; k >= Math.max(0, j - 4); k -= 1) {
          if (looksDaangnSellerNameLine(lines[k])) {
            return { nickname: lines[k], location: lines[j] };
          }
        }
        return { nickname: '', location: lines[j] };
      }
    }

    const location = lines.find(looksDaangnLocationLine) || '';
    if (!location) return { nickname: '', location: '' };
    const idx = lines.indexOf(location);
    const nickname =
      idx > 0
        ? lines
            .slice(Math.max(0, idx - 4), idx)
            .reverse()
            .find(looksDaangnSellerNameLine) || ''
        : '';
    return { nickname, location };
  }

  function pickFirstString(value, keys) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (!value || typeof value !== 'object') return '';
    for (const key of keys) {
      const raw = value[key];
      if (typeof raw === 'string' && raw.trim()) return raw.trim();
      if (raw && typeof raw === 'object') {
        const nested = pickFirstString(raw, ['name', 'displayName', 'text']);
        if (nested) return nested;
      }
    }
    return '';
  }

  function pickDaangnUserFromProduct(p) {
    const u = p?.user || p?.seller || p?.author || p?.profile || {};
    const region = u.region || p?.region || p?.location || {};
    const domSeller = parseSellerFromPageText();
    return {
      nickname:
        pickFirstString(u, ['nickname', 'nickName', 'name', 'displayName', 'username']) ||
        pickFirstString(p, ['nickname', 'sellerName', 'userName', 'displayName']) ||
        domSeller.nickname,
      location:
        pickFirstString(region, ['name', 'fullName', 'displayName']) ||
        pickFirstString(p, ['locationName', 'regionName', 'townName', 'addressName']) ||
        domSeller.location,
      score: u.score ?? u.mannerScore ?? p?.mannerScore ?? null,
      reviewCount: u.reviewCount ?? p?.reviewCount ?? null,
    };
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
    const isFree = !priceM && txt.split('\n').some((line) => line.trim() === '나눔');
    const mannerM = txt.match(/(\d{2,3}(?:\.\d+)?)\s*°?\s*C/i);
    const reviewM = txt.match(/후기\s*([\d,]+)/);

    const domSeller = parseSellerFromPageText();
    const nick =
      document.querySelector('a[href*="/users/"]')?.textContent?.trim() ||
      document.querySelector('[class*="nickname" i]')?.textContent?.trim() ||
      domSeller.nickname ||
      '';

    let imgs = harvestImagesFromDom();
    const ogImg = document.querySelector('meta[property="og:image"]')?.getAttribute('content');
    if (!imgs.length && ogImg && isListingImageUrl(ogImg)) imgs = [ogImg.split(/[?#]/)[0]];

    if (!title && !body && !imgs.length) return null;

    return {
      id: itemId,
      title,
      content: body,
      price: isFree ? '나눔' : priceM ? priceM[1].replace(/,/g, '') : '',
      images: imgs,
      locationName: domSeller.location || '',
      user: {
        nickname: nick,
        score: mannerM ? Number(mannerM[1]) : null,
        reviewCount: reviewM ? Number(reviewM[1].replace(/,/g, '')) : null,
      },
      _fromDom: true,
    };
  }

  function productToListing(p, itemId) {
    const u = pickDaangnUserFromProduct(p);
    const domPriceM = (document.body?.innerText || '').match(/([\d,]+)\s*원/);
    const rawPrice = p.price === 0 && domPriceM ? domPriceM[1] : p.price;
    const priceRaw = String(rawPrice ?? '').replace(/,/g, '');
    const hasPriceRaw = priceRaw !== '';
    const priceNum = hasPriceRaw ? Number(priceRaw) : NaN;
    const isFree = ((hasPriceRaw && priceRaw === '0') || rawPrice === 0 || rawPrice === '나눔') && !domPriceM;
    const body = pickBodyFromProduct(p);
    const shipping = globalThis.MarketScrape.parseShippingInfo?.(
      p.shippingFee,
      p.shipping_fee,
      p.deliveryFee,
      p.delivery_fee,
      p.shippingPrice,
      p.deliveryPrice,
      p.shippingFeeText,
      p.deliveryFeeText,
      body,
      document.body?.innerText || ''
    );

    let imageUrls = mapImages(p.images);
    if (!imageUrls.length && p._fromDom) imageUrls = harvestImagesFromDom();

    return {
      platform: 'daangn',
      platformLabel: '당근마켓',
      itemId: String(p.id || itemId),
      title: String(p.title || '').trim(),
      price: Number.isFinite(priceNum) ? priceNum : rawPrice,
      priceLabel: isFree || rawPrice === '나눔' ? '나눔' : Number.isFinite(priceNum) ? formatWon(priceNum) : '—',
      ...(shipping || {}),
      body,
      imageUrls,
      seller: {
        nickname: u.nickname || '',
        mannerScore: u.score != null ? Number(u.score) : null,
        reviewCount: u.reviewCount != null ? Number(u.reviewCount) : null,
        location: u.location || p.locationName || '',
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

  function firstSearchSrcsetUrl(srcset) {
    return (
      String(srcset || '')
        .split(',')
        .map((part) => part.trim().split(/\s+/)[0])
        .filter(Boolean)
        .at(-1) || ''
    );
  }

  function usableSearchImageUrl(raw) {
    const value = String(raw || '').trim();
    if (!value || /^data:/i.test(value) || /^blob:/i.test(value)) return '';
    try {
      const parsed = new URL(value, location.href);
      const nested = parsed.searchParams.get('url') || parsed.searchParams.get('src');
      if (nested && /daangn|karrot|karroter|karrotmarket|gcp-karroter|cloudfront|daangncdn/i.test(nested)) {
        return new URL(nested, location.href).href;
      }
      return parsed.href;
    } catch {
      return value;
    }
  }

  function collectSearchImgCandidates(img) {
    if (!img) return [];
    const out = [];
    const push = (raw) => {
      const value = String(raw || '').trim();
      if (value) out.push(value);
    };
    for (const part of String(img.getAttribute('srcset') || '').split(',')) {
      push(part.trim().split(/\s+/)[0]);
    }
    push(img.getAttribute('data-src'));
    push(img.getAttribute('data-lazy'));
    push(img.getAttribute('src'));
    push(img.currentSrc);
    push(img.src);
    return out;
  }

  function pickArticleImageFromCandidates(candidates) {
    for (const candidate of candidates) {
      const url = usableSearchImageUrl(candidate);
      if (isDaangnArticleImageUrl(url)) return url;
    }
    return '';
  }

  function imageFromSearchArticleRoot(root) {
    if (!root?.querySelectorAll) return '';
    const directThumbnail = root.querySelector('img[alt="thumbnail"]') || root.querySelector('img');
    const thumbUrl = pickArticleImageFromCandidates(collectSearchImgCandidates(directThumbnail));
    if (thumbUrl) return thumbUrl;

    for (const img of root.querySelectorAll('img')) {
      const url = pickArticleImageFromCandidates(collectSearchImgCandidates(img));
      if (url) return url;
    }

    for (const source of root.querySelectorAll('source[srcset]')) {
      const url = usableSearchImageUrl(firstSearchSrcsetUrl(source.getAttribute('srcset')));
      if (isDaangnArticleImageUrl(url)) return url;
    }
    return '';
  }

  function imageFromRemixHtml(html, baseUrl = location.href) {
    let ctx = parseRemixContextFromString(String(html || ''));
    if (!ctx?.state?.loaderData) {
      try {
        const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
        for (const script of doc.querySelectorAll('script:not([src])')) {
          const text = script.textContent || '';
          if (!text.includes('__remixContext')) continue;
          ctx = parseRemixContextFromString(text);
          if (ctx?.state?.loaderData) break;
        }
      } catch {
        return '';
      }
    }
    const product = findProductInLoaderData(ctx?.state?.loaderData);
    const imgs = mapImages(product?.images);
    return imgs.find((url) => isDaangnArticleImageUrl(url)) || imgs[0] || '';
  }

  function imageFromHtmlText(html, baseUrl = location.href) {
    const text = String(html || '');
    const candidates = new Set();
    const take = (raw) => {
      const value = String(raw || '').replace(/\\u0026/g, '&').replace(/\\\//g, '/');
      try {
        candidates.add(new URL(value, baseUrl).href);
      } catch {
        candidates.add(value);
      }
    };

    for (const match of text.matchAll(/https?:\\?\/\\?\/[^"'<>\\\s]+\/origin\/article\/[^"'<>\\\s]+/gi)) {
      take(match[0]);
    }
    for (const match of text.matchAll(/(?:https?:)?\/\/[^"'<>\s]+\/origin\/article\/[^"'<>\s]+/gi)) {
      take(match[0]);
    }
    for (const candidate of candidates) {
      const url = usableSearchImageUrl(candidate);
      if (isDaangnArticleImageUrl(url)) return url;
    }
    return '';
  }

  function isDaangnCategoryPath(pathname) {
    return /\/buy-sell\/s\/?$/i.test(String(pathname || ''));
  }

  function extractSearchItemIdFromPath(pathname) {
    const m = String(pathname || '').match(DETAIL_PATH_RE);
    return m?.[1] || null;
  }

  function liveSearchImageForItem(item) {
    const itemId = String(item?.itemId || '').trim();
    const itemUrl = String(item?.url || '').split('?')[0];
    if (!itemId && !itemUrl) return '';

    for (const card of document.querySelectorAll('[data-gtm="search_article"]')) {
      const link =
        (card.matches?.('a[href*="/buy-sell/"]') ? card : null) ||
        card.querySelector?.('a[href*="/buy-sell/"]');
      if (!link) continue;
      let href = '';
      let path = '';
      try {
        href = new URL(link.href, location.origin).href.split('?')[0];
        path = new URL(link.href, location.origin).pathname;
      } catch {
        continue;
      }
      if (isDaangnCategoryPath(path)) continue;
      const cardItemId = extractSearchItemIdFromPath(path);
      const matchesItem =
        (itemUrl && href === itemUrl) || (itemId && (cardItemId === itemId || href.includes(itemId)));
      if (!matchesItem) continue;
      const url = imageFromSearchArticleRoot(card) || imageFromSearchArticleRoot(link);
      if (url) return url;
    }
    return '';
  }

  function imageFromSearchHtml(html, baseUrl = location.href) {
    const absoluteImageUrl = (raw) => {
      try {
        return new URL(String(raw || '').trim(), baseUrl).href;
      } catch {
        return String(raw || '').trim();
      }
    };
    try {
      const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
      for (const img of doc.querySelectorAll('img')) {
        for (const part of String(img.getAttribute('srcset') || '').split(',')) {
          const raw = part.trim().split(/\s+/)[0];
          const url = absoluteImageUrl(raw);
          if (raw && isDaangnArticleImageUrl(url)) return url;
        }
        for (const raw of [img.getAttribute('data-src'), img.getAttribute('src')]) {
          const url = absoluteImageUrl(raw);
          if (raw && isDaangnArticleImageUrl(url)) return url;
        }
      }
    } catch {
      /* ignore malformed detail html */
    }
    return '';
  }

  async function fetchSearchListingImage(url) {
    try {
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) return '';
      const html = await res.text();
      const imageUrl = imageFromSearchHtml(html, url) || imageFromRemixHtml(html, url) || imageFromHtmlText(html, url);
      return imageUrl ? new URL(imageUrl, url).href : '';
    } catch {
      return '';
    }
  }

  function notifyCompsImagePatch() {
    try {
      chrome.runtime.sendMessage({ type: 'COMPS_IMAGES_PATCHED', platform: 'daangn' }, () => {
        void chrome.runtime.lastError;
      });
    } catch {
      /* extension reloaded */
    }
  }

  async function fillMissingSearchImages(items) {
    const targets = items.filter((item) => !item.imageUrl && item.url).slice(0, 12);
    if (!targets.length) return items;

    for (const delay of [0, 1200, 2800]) {
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      for (const item of targets) {
        if (item.imageUrl) continue;
        const live = liveSearchImageForItem(item);
        if (live) item.imageUrl = live;
      }
    }

    await Promise.all(
      targets.map(async (item) => {
        if (item.imageUrl) return;
        const imageUrl = await fetchSearchListingImage(item.url);
        if (imageUrl && isDaangnArticleImageUrl(imageUrl)) item.imageUrl = imageUrl;
      })
    );

    return items;
  }

  function enhanceMissingSearchImages(items, meta = {}) {
    if (!items.some((item) => !item.imageUrl && item.url) || !globalThis.MarketScrape?.saveComps) return;

    window.setTimeout(() => {
      void fillMissingSearchImages(items).then((nextItems) => {
        if (!nextItems.some((item) => item.imageUrl)) return;
        void globalThis.MarketScrape.saveComps('daangn', nextItems, meta).then(() => {
          notifyCompsImagePatch();
        });
      });
    }, 0);
  }

  function harvestSearchListings() {
    const MS = globalThis.MarketScrape;
    const items = [];
    const seen = new Set();
    const query = MS.getSearchQueryFromUrl?.(location.href) || '';
    const imageFromSearchArticle = imageFromSearchArticleRoot;
    const usableImageUrl = usableSearchImageUrl;
    const firstSrcsetUrl = firstSearchSrcsetUrl;
    const imageUrlLooksLikeAppBadge = (url = '') => {
      return isDaangnPromoImageUrl(url);
    };
    const imageLooksLikeAppBadge = (img, url = '') => {
      const label = [
        url,
        img?.alt,
        img?.title,
        img?.getAttribute?.('aria-label'),
        img?.getAttribute?.('data-testid'),
        img?.className,
      ]
        .filter(Boolean)
        .join(' ');
      if (imageUrlLooksLikeAppBadge(label)) return true;
      if (/app\s*store|google\s*play|play\s*store|download|앱\s*다운로드|앱스토어|구글플레이/i.test(label)) {
        return true;
      }
      const width = img?.naturalWidth || img?.width || 0;
      const height = img?.naturalHeight || img?.height || 0;
      return width > 0 && height > 0 && width / height > 2.15;
    };
    const imageFromImg = (img, opts = {}) => {
      const candidates = [
        firstSrcsetUrl(img?.srcset),
        img?.currentSrc,
        img?.src,
        img?.getAttribute?.('data-src'),
        img?.getAttribute?.('data-lazy'),
        img?.getAttribute?.('data-original'),
      ];
      for (const candidate of candidates) {
        const url = usableImageUrl(candidate);
        if (!url || !isListingImageUrl(url)) continue;
        if (!opts.relaxed && imageLooksLikeAppBadge(img, url)) continue;
        if (opts.relaxed && (imageLooksLikeAppBadge(img, url) || imageUrlLooksLikeAppBadge(url))) continue;
        return url;
      }
      return '';
    };
    const listingCardForAnchor = (a) => {
      let node = a;
      let fallback = a.closest('article, li, div') || a;
      for (let i = 0; i < 9 && node; i += 1) {
        const text = (node.innerText || '').trim();
        const hasPrice = /[\d,]+\s*원|(^|\s)나눔(\s|$)/.test(text);
        const hasImage =
          Boolean(node.querySelector?.('img, source[srcset], [style*="background-image"]')) ||
          /url\(/i.test(String(node.getAttribute?.('style') || ''));
        if (hasImage) fallback = node;
        if (hasPrice && hasImage) return node;
        node = node.parentElement;
      }
      return fallback;
    };
    const nearbyImageForAnchor = (a) => {
      const rect = a.getBoundingClientRect?.();
      if (!rect) return '';
      const ax = rect.left + rect.width / 2;
      const ay = rect.top + rect.height / 2;
      let best = null;
      for (const img of document.querySelectorAll('img')) {
        const url = imageFromImg(img, { relaxed: true });
        if (!url || !isDaangnArticleImageUrl(url)) continue;
        const r = img.getBoundingClientRect?.();
        if (!r || r.width < 32 || r.height < 32) continue;
        const ix = r.left + r.width / 2;
        const iy = r.top + r.height / 2;
        const distance = Math.abs(ix - ax) + Math.abs(iy - ay);
        const verticalOverlap = Math.max(0, Math.min(rect.bottom, r.bottom) - Math.max(rect.top, r.top));
        if (distance > 520 && verticalOverlap <= 0) continue;
        if (!best || distance < best.distance) best = { url, distance };
      }
      return best?.url || '';
    };
    const searchImageRoot = (a) => {
      let node = a;
      for (let i = 0; i < 7 && node; i += 1) {
        const text = (node.innerText || '').trim();
        const hasImage =
          Boolean(node.querySelector?.('img, source[srcset], [style*="background-image"]')) ||
          /url\(/i.test(String(node.getAttribute?.('style') || ''));
        if (hasImage) return node;
        node = node.parentElement;
      }
      return a.closest('article, li, div') || a;
    };
    const searchTextRoot = (a) => {
      let node = a;
      for (let i = 0; i < 7 && node; i += 1) {
        const text = (node.innerText || '').trim();
        if (text && (text.includes('원') || /(^|\s)나눔(\s|$)/.test(text) || /판매완료|예약중|거래완료/.test(text))) return node;
        node = node.parentElement;
      }
      return a.closest('article, li, div') || a;
    };
    const searchImageScore = (url, img) => {
      if (!url || !isListingImageUrl(url) || isDaangnPromoImageUrl(url)) return -1;
      let score = 0;
      const hint = decodedImageHint(url);
      if (isDaangnArticleImageUrl(url)) score += 140;
      else if (/\/origin\/article\//i.test(hint)) score += 120;
      if (/karrotmarket\.com/i.test(hint)) score += 50;
      const alt = String(img?.getAttribute?.('alt') || '').trim().toLowerCase();
      if (alt === 'thumbnail') score += 90;
      const nw = img?.naturalWidth || img?.width || 0;
      const nh = img?.naturalHeight || img?.height || 0;
      if (nw >= 40 && nh >= 40) score += Math.min(36, Math.round((nw * nh) / 4800));
      return score;
    };
    const considerSearchImage = (best, url, img) => {
      const score = searchImageScore(url, img);
      if (score < 0) return best;
      if (!best || score > best.score) return { url, score };
      return best;
    };
    const imageFromCard = (card) => {
      if (!card?.querySelectorAll) return '';
      let best = null;
      const considerUrl = (url, img) => {
        best = considerSearchImage(best, url, img);
      };
      for (const picture of card.querySelectorAll('picture')) {
        const sourceUrl = usableImageUrl(
          firstSrcsetUrl(picture.querySelector('source[srcset]')?.getAttribute('srcset'))
        );
        considerUrl(sourceUrl, picture.querySelector('img'));
        for (const img of picture.querySelectorAll('img')) {
          considerUrl(imageFromImg(img, { relaxed: true }), img);
        }
      }
      for (const img of card.querySelectorAll('img')) {
        considerUrl(imageFromImg(img, { relaxed: true }), img);
      }
      const sourceUrl = usableImageUrl(firstSrcsetUrl(card.querySelector('source[srcset]')?.getAttribute('srcset')));
      considerUrl(sourceUrl, null);
      for (const el of [card, ...card.querySelectorAll('[style*="background-image"]')]) {
        const style = String(el.getAttribute('style') || '');
        const match = style.match(/url\(["']?([^"')]+)["']?\)/i);
        considerUrl(usableImageUrl(match?.[1]), null);
      }
      return best?.url || '';
    };

    const pushSearchItem = (link, scope) => {
      if (!link || MS.isInsideNoiseSection(link)) return;
      let path;
      try {
        path = new URL(link.href, location.origin).pathname;
      } catch {
        return;
      }
      if (isDaangnCategoryPath(path)) return;
      const itemId = extractSearchItemIdFromPath(path);
      if (!itemId || seen.has(itemId)) return;

      const card = scope || link.closest('[data-gtm="search_article"], article') || searchTextRoot(link);
      const text = (card.innerText || '').trim();
      const imgAlt = String(card.querySelector?.('img')?.alt || '').trim();
      const titleFromAlt = imgAlt && !/^thumbnail$/i.test(imgAlt) && imgAlt.length >= 3 ? imgAlt : '';
      const title = (
        link.getAttribute('aria-label') ||
        link.getAttribute('title') ||
        text.split('\n').find((line) => !/^(?:[\d,]+\s*원|나눔)$/.test(line.trim())) ||
        titleFromAlt ||
        ''
      )
        .trim()
        .slice(0, 120);
      if (!MS.listingTitleMatchesSearchQuery?.(title, query)) return;

      const imageUrl =
        imageFromSearchArticleRoot(scope) ||
        imageFromSearchArticleRoot(card) ||
        imageFromSearchArticleRoot(link);

      const statusM = text.match(/판매완료|예약중|거래완료/);
      const saleStatus = statusM ? statusM[0] : '';
      seen.add(itemId);
      const priceM = text.match(/([\d,]+)\s*원/);
      const isFree = !priceM && text.split('\n').some((line) => line.trim() === '나눔');
      const price = MS.parsePriceNumber(priceM?.[1]);

      items.push({
        platform: 'daangn',
        platformLabel: '당근마켓',
        itemId,
        title: title || `매물 ${itemId}`,
        price: isFree ? 0 : price,
        priceLabel: isFree ? '나눔' : price != null ? formatWon(price) : priceM?.[0] || '—',
        url: link.href.split('?')[0],
        imageUrl: imageUrl || '',
        ...(saleStatus ? { saleStatus } : {}),
      });
    };

    for (const scope of document.querySelectorAll('[data-gtm="search_article"]')) {
      if (scope.parentElement?.closest('[data-gtm="search_article"]')) continue;
      const link =
        (scope.matches?.('a[href*="/buy-sell/"]') ? scope : null) ||
        scope.querySelector?.('a[href*="/buy-sell/"]');
      pushSearchItem(link, scope);
    }

    for (const a of document.querySelectorAll('a[href*="/buy-sell/"]')) {
      if (MS.isInsideNoiseSection(a)) continue;
      let path;
      try {
        path = new URL(a.href, location.origin).pathname;
      } catch {
        continue;
      }
      if (isDaangnCategoryPath(path)) continue;
      const itemId = extractSearchItemIdFromPath(path);
      if (!itemId || seen.has(itemId)) continue;
      pushSearchItem(a, a.closest('[data-gtm="search_article"], article'));
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
    enhanceSearchListings: fillMissingSearchImages,
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
