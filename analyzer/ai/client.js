/** 로컬 분석 서버로 검색어 정규화 요청 (확장/서버 공통 프롬프트) */
(() => {
  globalThis.UlsaAi = globalThis.UlsaAi || {};

  UlsaAi.getStoredModel = () =>
    localStorage.getItem(UlsaAi.STORAGE_KEY_MODEL) || UlsaAi.DEFAULT_MODEL;

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
      throw new Error(text.slice(0, 200) || `HTTP ${res.status}`);
    }
    if (!res.ok) {
      throw new Error(data.error || data.message || `HTTP ${res.status}`);
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
      throw new Error(text.slice(0, 200) || `HTTP ${res.status}`);
    }
    if (!res.ok) {
      throw new Error(data.error || data.message || `HTTP ${res.status}`);
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
      throw new Error(text.slice(0, 200) || `HTTP ${res.status}`);
    }
    if (!res.ok) {
      throw new Error(data.error || data.message || `HTTP ${res.status}`);
    }
    return data;
  };
})();
