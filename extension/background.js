/** 유사 매물 검색 탭(bunjang/daangn) 수집 완료 후 자동 닫기 */
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.marketScrapeAutoCollect) return;
  const f = changes.marketScrapeAutoCollect.newValue;
  if (!f || f.bunjang || f.daangn) return;
  void closeSearchCollectionTabsIfAny();
});

async function closeSearchCollectionTabsIfAny() {
  const { marketScrapeCloseTabs } = await chrome.storage.local.get('marketScrapeCloseTabs');
  if (!Array.isArray(marketScrapeCloseTabs) || !marketScrapeCloseTabs.length) return;
  for (const id of marketScrapeCloseTabs) {
    try {
      await chrome.tabs.remove(id);
    } catch {
      /* 이미 닫힘 */
    }
  }
  await chrome.storage.local.remove(['marketScrapeCloseTabs']);
}

function scheduleCloseSearchCollectionTabs() {
  setTimeout(() => {
    void closeSearchCollectionTabsIfAny();
  }, 45_000);
}

chrome.action.onClicked.addListener((tab) => {
  if (!tab?.id) return;
  chrome.tabs.sendMessage(tab.id, { type: 'SEND_TO_ANALYZER' }, (res) => {
    if (chrome.runtime.lastError || !res?.ok) {
      void chrome.runtime.sendMessage({ type: 'OPEN_ANALYZER_TAB' });
    }
  });
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const allowedTypes = new Set(['OPEN_EXTENSION_POPUP', 'OPEN_ANALYZER_TAB', 'OPEN_SEARCH_TABS']);
  if (!allowedTypes.has(msg?.type)) return undefined;

  (async () => {
    try {
      if (msg.type === 'OPEN_SEARCH_TABS') {
        const query = String(msg.query || '').trim();
        if (!query) {
          sendResponse({ ok: false, error: '검색어가 비었습니다.' });
          return;
        }
        const bunjangUrl = `https://m.bunjang.co.kr/search/products?q=${encodeURIComponent(query)}&order=score`;
        const daangnUrl = `https://www.daangn.com/kr/buy-sell/?search=${encodeURIComponent(query)}`;
        await chrome.storage.local.set({
          marketScrapeAutoCollect: { bunjang: true, daangn: true, at: Date.now() },
        });
        const bunTab = await chrome.tabs.create({ url: bunjangUrl, active: false });
        const dangTab = await chrome.tabs.create({ url: daangnUrl, active: false });
        const closeIds = [bunTab?.id, dangTab?.id].filter((id) => typeof id === 'number');
        if (closeIds.length) await chrome.storage.local.set({ marketScrapeCloseTabs: closeIds });
        scheduleCloseSearchCollectionTabs();
        sendResponse({ ok: true, query, tabIds: closeIds });
        return;
      }

      if (msg.type === 'OPEN_ANALYZER_TAB') {
        const url = 'http://127.0.0.1:3920/';
        const tabs = await chrome.tabs.query({ url: ['http://127.0.0.1:3920/*', 'http://localhost:3920/*'] });
        const existing = tabs.find((t) => t.id != null);
        if (existing?.id != null) {
          await chrome.tabs.update(existing.id, { active: true, url });
          if (existing.windowId != null) await chrome.windows.update(existing.windowId, { focused: true });
        } else {
          await chrome.tabs.create({ url, active: true });
        }
        sendResponse({ ok: true });
        return;
      }

      if (typeof chrome.action?.openPopup !== 'function') {
        sendResponse({ ok: false, error: 'openPopup 미지원' });
        return;
      }
      await chrome.action.openPopup();
      sendResponse({ ok: true });
    } catch (e) {
      sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  })();

  return true;
});
