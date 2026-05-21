/** 분석 페이지(localhost) ↔ 확장 storage 브릿지 */
(() => {
  const PORTS = [3920, 3921];

  function isAnalyzerPage() {
    if (location.hostname !== '127.0.0.1' && location.hostname !== 'localhost') return false;
    const p = Number(location.port);
    return PORTS.includes(p);
  }

  if (!isAnalyzerPage()) return;

  document.addEventListener('ulsa-ai-settings', (ev) => {
    const d = ev.detail;
    if (!d || !d.apiKey) return;
    try {
      chrome.storage.local.set({
        ulsaGeminiApiKey: d.apiKey,
        ulsaGeminiModel: d.model || 'gemini-2.5-flash',
        ulsaGeminiVerifiedAt: d.verifiedAt || Date.now(),
      });
    } catch {
      /* extension reloaded */
    }
  });

  window.addEventListener('message', (ev) => {
    if (ev.source !== window || !ev.data || ev.data.type !== 'ULSA_AI_SETTINGS' || !ev.data.apiKey) return;
    try {
      chrome.storage.local.set({
        ulsaGeminiApiKey: ev.data.apiKey,
        ulsaGeminiModel: ev.data.model || 'gemini-2.5-flash',
        ulsaGeminiVerifiedAt: ev.data.verifiedAt || Date.now(),
      });
    } catch {
      /* extension reloaded */
    }
  });

  function attachComps(latest, comps) {
    if (!latest || !comps?.forItemKey) return latest;
    const key = `${latest.platform}:${latest.itemId}`;
    if (comps.forItemKey !== key) return latest;
    return { ...latest, comps };
  }

  function pushToPage() {
    try {
      chrome.storage.local.get(['marketScrapeLatest', 'marketScrapeHistory', 'marketScrapeComps'], (res) => {
        const latest = attachComps(res.marketScrapeLatest, res.marketScrapeComps);
        window.postMessage(
          {
            type: 'MARKET_SCRAPE_BRIDGE',
            latest,
            history: res.marketScrapeHistory || [],
            comps: res.marketScrapeComps || null,
          },
          '*'
        );
      });
    } catch {
      /* extension reloaded */
    }
  }

  window.addEventListener('message', (ev) => {
    if (ev.source !== window || ev.data?.type !== 'MARKET_SCRAPE_REQUEST') return;
    pushToPage();
  });

  window.addEventListener('message', (ev) => {
    if (ev.source !== window || ev.data?.type !== 'MARKET_SCRAPE_OPEN_SEARCH_TABS') return;
    const query = String(ev.data.query || '').trim();
    if (!query) {
      window.postMessage({ type: 'MARKET_SCRAPE_SEARCH_TABS_RESULT', ok: false, error: '검색어가 비었습니다.' }, '*');
      return;
    }
    chrome.runtime.sendMessage({ type: 'OPEN_SEARCH_TABS', query }, (res) => {
      window.postMessage(
        {
          type: 'MARKET_SCRAPE_SEARCH_TABS_RESULT',
          ok: Boolean(res?.ok),
          error: res?.error || '',
          query: res?.query || query,
        },
        '*'
      );
    });
  });

  window.addEventListener('message', (ev) => {
    if (ev.source !== window || ev.data?.type !== 'MARKET_SCRAPE_CLEAR_COMPS') return;
    try {
      chrome.storage.local.set({ marketScrapeComps: null }, () => {
        window.postMessage({ type: 'MARKET_SCRAPE_MUTATION_RESULT', ok: true, action: 'clear-comps' }, '*');
        pushToPage();
      });
    } catch (e) {
      window.postMessage(
        { type: 'MARKET_SCRAPE_MUTATION_RESULT', ok: false, error: e instanceof Error ? e.message : String(e) },
        '*'
      );
    }
  });

  window.addEventListener('message', (ev) => {
    if (ev.source !== window || ev.data?.type !== 'MARKET_SCRAPE_DELETE_HISTORY') return;
    const key = String(ev.data.key || '');
    if (!key) return;
    try {
      chrome.storage.local.get(['marketScrapeLatest', 'marketScrapeHistory', 'marketScrapeComps'], (res) => {
        const history = Array.isArray(res.marketScrapeHistory) ? res.marketScrapeHistory : [];
        const nextHistory = history.filter((item) => `${item.platform}:${item.itemId}` !== key);
        const latestKey = res.marketScrapeLatest
          ? `${res.marketScrapeLatest.platform}:${res.marketScrapeLatest.itemId}`
          : '';
        const nextLatest = latestKey === key ? nextHistory[0] || null : res.marketScrapeLatest || null;
        const nextComps = res.marketScrapeComps?.forItemKey === key ? null : res.marketScrapeComps || null;
        chrome.storage.local.set(
          {
            marketScrapeLatest: nextLatest,
            marketScrapeHistory: nextHistory,
            marketScrapeComps: nextComps,
          },
          () => {
            window.postMessage({ type: 'MARKET_SCRAPE_MUTATION_RESULT', ok: true, action: 'delete-history' }, '*');
            pushToPage();
          }
        );
      });
    } catch (e) {
      window.postMessage(
        { type: 'MARKET_SCRAPE_MUTATION_RESULT', ok: false, error: e instanceof Error ? e.message : String(e) },
        '*'
      );
    }
  });

  window.addEventListener('message', (ev) => {
    if (ev.source !== window || ev.data?.type !== 'MARKET_SCRAPE_PROMOTE_HISTORY') return;
    const key = String(ev.data.key || '');
    if (!key) return;
    try {
      chrome.storage.local.get(['marketScrapeHistory'], (res) => {
        const history = Array.isArray(res.marketScrapeHistory) ? res.marketScrapeHistory : [];
        const found = history.find((item) => `${item.platform}:${item.itemId}` === key);
        if (!found) return;
        const nextHistory = [found, ...history.filter((item) => `${item.platform}:${item.itemId}` !== key)];
        chrome.storage.local.set(
          {
            marketScrapeLatest: found,
            marketScrapeHistory: nextHistory,
          },
          () => {
            window.postMessage({ type: 'MARKET_SCRAPE_MUTATION_RESULT', ok: true, action: 'promote-history' }, '*');
            pushToPage();
          }
        );
      });
    } catch (e) {
      window.postMessage(
        { type: 'MARKET_SCRAPE_MUTATION_RESULT', ok: false, error: e instanceof Error ? e.message : String(e) },
        '*'
      );
    }
  });

  window.addEventListener('message', (ev) => {
    if (ev.source !== window || ev.data?.type !== 'MARKET_SCRAPE_CLEAR_HISTORY') return;
    try {
      chrome.storage.local.set(
        {
          marketScrapeLatest: null,
          marketScrapeHistory: [],
          marketScrapeComps: null,
        },
        () => {
          window.postMessage({ type: 'MARKET_SCRAPE_MUTATION_RESULT', ok: true, action: 'clear-history' }, '*');
          pushToPage();
        }
      );
    } catch (e) {
      window.postMessage(
        { type: 'MARKET_SCRAPE_MUTATION_RESULT', ok: false, error: e instanceof Error ? e.message : String(e) },
        '*'
      );
    }
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.marketScrapeLatest || changes.marketScrapeHistory || changes.marketScrapeComps) pushToPage();
  });

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === 'PUSH_ANALYZER') {
      pushToPage();
      return true;
    }
    return undefined;
  });

  pushToPage();
})();
