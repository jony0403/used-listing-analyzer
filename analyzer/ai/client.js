/** 로컬 분석 서버로 검색어 정규화 요청 (확장/서버 공통 프롬프트) */
(() => {
  globalThis.UlsaAi = globalThis.UlsaAi || {};

  UlsaAi.getStoredModel = () =>
    localStorage.getItem(UlsaAi.STORAGE_KEY_MODEL) || UlsaAi.DEFAULT_MODEL;

  function cleanApiError(text, fallback = 'AI 분석 요청에 실패했습니다.') {
    const raw = String(text || '').trim();
    if (!raw) return fallback;
    if (/<!doctype|<html|<title>/i.test(raw)) {
      const title = raw.match(/<title>([^<]+)<\/title>/i)?.[1]?.trim();
      return title ? `서버 오류: ${title}` : fallback;
    }
    return raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 220) || fallback;
  }

  /**
   * @param {{ title: string, body?: string, imageUrls?: string[], apiKey: string, model?: string }} p
   * @returns {Promise<{ query: string }>}
   */
  UlsaAi.fetchSearchQuery = async (p) => {
    const port = location.port || '3920';
    const model = p.model || UlsaAi.getStoredModel();
    const res = await fetch(`http://${location.hostname}:${port}/api/search-query`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Gemini-Key': p.apiKey,
        'X-Gemini-Model': model,
      },
      body: JSON.stringify({
        title: p.title || '',
        body: p.body || '',
        imageUrls: Array.isArray(p.imageUrls) ? p.imageUrls : [],
      }),
    });
    const text = await res.text();
    if (res.status === 404) {
      const fallback = await UlsaAi.fetchSearchQuery(p);
      const query = String(fallback.query || '').trim();
      if (!query) {
        throw new Error('제품 정리 API를 찾지 못했습니다. 분석 서버를 재시작한 뒤 다시 시도하세요.');
      }
      return {
        summary: {
          productName: query,
          newPrice: '',
          newPriceSourceUrl: '',
          description: '제품 정리 API가 아직 반영되지 않아 AI 검색어 식별 결과만 먼저 표시합니다.',
          makerOrSeller: '',
          searchQuery: query,
          searchQueries: [query],
          productImageUrl: '',
        },
        fallback: 'search-query',
      };
    }
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(cleanApiError(text, `HTTP ${res.status}`));
    }
    if (!res.ok) {
      throw new Error(cleanApiError(data.error || data.message, `HTTP ${res.status}`));
    }
    return data;
  };

  /**
   * @param {{ title: string, body?: string, imageUrls?: string[], apiKey: string, model?: string }} p
   * @returns {Promise<{ summary: { productName: string, newPrice: string, newPriceSourceUrl?: string, description: string, makerOrSeller: string, searchQuery: string, searchQueries?: string[], productImageUrl: string } }>}
   */
  UlsaAi.fetchProductSummary = async (p) => {
    const port = location.port || '3920';
    const model = p.model || UlsaAi.getStoredModel();
    const res = await fetch(`http://${location.hostname}:${port}/api/product-summary`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Gemini-Key': p.apiKey,
        'X-Gemini-Model': model,
      },
      body: JSON.stringify({
        title: p.title || '',
        body: p.body || '',
        imageUrls: Array.isArray(p.imageUrls) ? p.imageUrls : [],
      }),
    });
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(cleanApiError(text, `HTTP ${res.status}`));
    }
    if (!res.ok) {
      throw new Error(cleanApiError(data.error || data.message, `HTTP ${res.status}`));
    }
    return data;
  };

  /**
   * @param {{ productName?: string, searchQuery?: string }} p
   * @returns {Promise<{ imageUrls: string[], source: string }>}
   */
  UlsaAi.fetchProductImage = async (p) => {
    const port = location.port || '3920';
    const res = await fetch(`http://${location.hostname}:${port}/api/product-image`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        productName: p.productName || '',
        searchQuery: p.searchQuery || '',
      }),
    });
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(cleanApiError(text, `HTTP ${res.status}`));
    }
    if (!res.ok) {
      throw new Error(cleanApiError(data.error || data.message, `HTTP ${res.status}`));
    }
    return data;
  };

  /**
   * @param {{ title: string, body?: string, imageUrls?: string[], productName?: string, summary?: object, apiKey: string, model?: string }} p
   * @returns {Promise<{ analysis: { relatedIssues: Array<{ title: string, detail: string, level?: string }>, chronicDefects: Array<{ title: string, detail: string, level?: string }>, verdict?: string } }>}
   */
  UlsaAi.fetchProductRisk = async (p) => {
    const port = location.port || '3920';
    const model = p.model || UlsaAi.getStoredModel();
    const res = await fetch(`http://${location.hostname}:${port}/api/product-risk`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Gemini-Key': p.apiKey,
        'X-Gemini-Model': model,
      },
      body: JSON.stringify({
        title: p.title || '',
        body: p.body || '',
        imageUrls: Array.isArray(p.imageUrls) ? p.imageUrls : [],
        productName: p.productName || '',
        summary: p.summary || null,
      }),
    });
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(cleanApiError(text, `HTTP ${res.status}`));
    }
    if (!res.ok) {
      throw new Error(cleanApiError(data.error || data.message, `HTTP ${res.status}`));
    }
    return data;
  };

  /**
   * @param {{ title: string, body?: string, seller?: object, priceLabel?: string, productName?: string, summary?: object, riskAnalysis?: object, apiKey: string, model?: string }} p
   * @returns {Promise<{ analysis: { sellerVerdict: string, bodyVerdict: string, questions: string[], redFlags: string[], overall: string } }>}
   */
  UlsaAi.fetchListingTextAnalysis = async (p) => {
    const port = location.port || '3920';
    const model = p.model || UlsaAi.getStoredModel();
    const res = await fetch(`http://${location.hostname}:${port}/api/listing-text-analysis`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Gemini-Key': p.apiKey,
        'X-Gemini-Model': model,
      },
      body: JSON.stringify({
        title: p.title || '',
        body: p.body || '',
        seller: p.seller || null,
        priceLabel: p.priceLabel || '',
        productName: p.productName || '',
        summary: p.summary || null,
        riskAnalysis: p.riskAnalysis || null,
      }),
    });
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(cleanApiError(text, `HTTP ${res.status}`));
    }
    if (!res.ok) {
      throw new Error(cleanApiError(data.error || data.message, `HTTP ${res.status}`));
    }
    return data;
  };

  /**
   * @param {{ title: string, body?: string, imageUrls?: string[], productName?: string, apiKey: string, model?: string }} p
   * @returns {Promise<{ analysis: { images: Array<{ index: number, label?: string, comment: string, level?: string, imageWidth?: number, imageHeight?: number }>, overall: string } }>}
   */
  UlsaAi.fetchListingImageAnalysis = async (p) => {
    const port = location.port || '3920';
    const model = p.model || UlsaAi.getStoredModel();
    const res = await fetch(`http://${location.hostname}:${port}/api/listing-image-analysis`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Gemini-Key': p.apiKey,
        'X-Gemini-Model': model,
      },
      body: JSON.stringify({
        title: p.title || '',
        body: p.body || '',
        imageUrls: Array.isArray(p.imageUrls) ? p.imageUrls : [],
        productName: p.productName || '',
      }),
    });
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(cleanApiError(text, `HTTP ${res.status}`));
    }
    if (!res.ok) {
      throw new Error(cleanApiError(data.error || data.message, `HTTP ${res.status}`));
    }
    return data;
  };

  /**
   * @param {{ prompt: string, apiKey: string, model?: string }} p
   * @returns {Promise<{ answer: string, model: string, pipeline: string }>}
   */
  UlsaAi.askDirect = async (p) => {
    const port = location.port || '3920';
    const model = p.model || UlsaAi.getStoredModel();
    const res = await fetch(`http://${location.hostname}:${port}/api/ai-chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Gemini-Key': p.apiKey,
        'X-Gemini-Model': model,
      },
      body: JSON.stringify({
        prompt: p.prompt || '',
      }),
    });
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(cleanApiError(text, `HTTP ${res.status}`));
    }
    if (!res.ok) {
      throw new Error(cleanApiError(data.error || data.message, `HTTP ${res.status}`));
    }
    return data;
  };

})();
