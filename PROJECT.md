# 중고 매물 스크랩 · 가격 분석 — 상세 인수인계

> **다른 PC / 새 Cursor 채팅**에서는 맨 처음에  
> `@PROJECT.md` 를 읽고 작업하세요.

- **작성일:** 2026-05-19  
- **확장 버전:** `extension/manifest.json` → `2.6.5`
- **워크스페이스:** `used-listing-analyzer`

**맥북 ↔ 윈도우:** 이쪽(윈도우 등)에서도 프로젝트 맥락은 이해한 상태로 맞춰 두었으니, 앞으로 맥북·윈도우를 오가며 할 때 `@PROJECT.md`와 저장소를 기준으로 서로 잘 맞춰가자.  
**Git 동기화:** 두 PC 모두 이 저장소를 Cursor로 연 뒤 채팅에 **`깃동기화`**(또는 **`sync-repo`**)라고 입력하면 에이전트가 `pull`·(필요 시 `commit`/`push`)를 수행한다. 규칙 파일은 `.cursor/rules/git-sync-keyword.mdc`(저장소에 포함) — **다른 PC에서는 반드시 `git pull`로 최신을 받은 다음** 쓰면 된다. 자세한 절은 **§12.5**. 동기화 후 **`PROJECT.md`에 반영된 추가·수정이 있으면 에이전트가 한국어로 요약해 말해 준다** (diff 기준). 이번 동기화 구간에 **추가·변경된 `.cursor/rules` 파일은 전부 읽고** 새 키워드·동작을 **이해한 상태로** 이어 간다.  
**분석 서버:** 채팅에 **`분석서버켜`** / **`서버켜`** / **`analyzer-up`** 으로 로컬 분석 웹을 띄우고, **`분석서버꺼`** / **`서버꺼`** / **`analyzer-down`** 으로 끈다(기본 포트 3920). 규칙 `.cursor/rules/analyzer-server-keyword.mdc` — **§12.6**.  
**규칙·인수인계:** `.cursor/rules` 를 추가·수정할 때마다 **이 문서(§12.6·§15)도 같이 고치고**, 작업 후 **`깃동기화`** 해서 맥/윈도에 규칙을 맞출 것. 에이전트는 규칙 변경 시 이 점을 안내한다(`.cursor/rules/handover-on-rule-changes.mdc`).
**현재 분석 웹 상태(2026-05-21):** 1단계 제품 정리 완료 후 2단계 제품 리스크가 자동 실행된다. 2단계는 `prompts/product-risk.txt` 자연어 조사 → `prompts/product-risk-json.txt` 카드 JSON 변환의 2호출 구조이며, 제품 진위/공식성 검증이 아니라 “이미 식별된 제품을 중고로 살 때 확인할 관련 이슈·고질병”만 다룬다. 판매자 이미지 분석은 홍보용·공식·쇼핑몰 스크랩 이미지를 실물 사진과 구분해, 홍보컷을 실물 하자 없음으로 단정하지 않도록 `analyzer-server.mjs` 프롬프트와 `analyzer/app.js` 배지 fallback을 보강했다. 디버그용 `AI 대화` 버튼은 헤더에서 직접 Gemini+Google Search 질의를 보낼 수 있다. **제품 식별:** 제목·사진의 세대/후속작 번호(`스위치2`, `Switch 2`, `OLED` 등)를 기본형으로 일반화하지 않도록 `product-identify.txt`·`product-summary.txt` 규칙 + `analyzer-server.mjs` `preserveVariantTokens()` 후처리로 보정한다.
**최근 프롬프트 보강 기록(2026-05-21 18:40~):** 스위치2 세트 매물의 쇼핑몰 캡처(가격·할인율·쿠폰 UI 포함)를 AI가 “박스 상태 양호”로 착각한 사례를 발표 메모 `presentation-prompts/prompt-process-summary.md` §16과 `발표용 이미지 캡처/대화첨부_42_image-b522681d-437c-4514-ab4b-c3ff34040a60.png`에 기록했다. 이후 `runListingImageAnalysis` 규칙을 강화해 쇼핑몰 UI가 보이면 실제 상품이 함께 보여도 홍보/스크랩 이미지로 분류하고, `깨끗함·양호함·본문과 일치` 같은 실물 상태 단정을 금지했다. 새 분석 반영을 위해 `ulsa_ai_analysis_cache_v10`으로 캐시 키를 올렸으므로 윈도우에서는 최신 pull 후 서버를 다시 띄우고 새로 분석하면 된다.

---

## 0. 이 문서가 대체하는 것

| 옮기기 어려운 것 | 이 문서 + 코드로 대체 |
|------------------|----------------------|
| Mac Cursor 채팅 전체 | 여기 적힌 **결정 사항·버그·다음 할 일** |
| 교수님 기획서(PPT/이미지) | §1 기획 요약 + 원본은 `docs/`에 넣 권장 |
| “왜 이렇게 만들었지?” | §8~§10 설계 결정 로그 |

---

## 1. 기획서 요약 (교수 컨펌 방향)

### 주제

**AI 중고 매물 검증 서비스 (구매자용)** — “얼마에 사면 되는지”를 모르는 구매자를 돕는다.

### 한 줄 서비스 정의

> 판매자 게시물(사진+글)을 분석해 **허위·누락·모순**을 찾고, **네고 가격**과 **판매자에게 보낼 질문·채팅 멘트**를 제안한다.

### 기존 서비스(예: 얼마야) 한계

- 평균 시세·차트 위주
- 비지원 제품·**상태별** 가격 설명 부족
- **사진 vs 본문 불일치** 검증 없음

### 기획 3단계 (원본)

1. **매물 확인** — 사진·글 수집 (웹이면 **브라우저 확장**으로 한 번에)
2. **AI 검증** — 모델 특정, 사진 하자, 만성 결함, 논리 모순
3. **결과** — 네고 가격 + 판매자 질문 리스트

### 대화 중 추가로 합의한 기능 (기획서엔 없음)

| 추가 | 설명 |
|------|------|
| Vision **좌표 마킹** | 하자 위치 bbox → 나중에 분석 웹 오버레이 |
| **네고 채팅 대사** | 당근/번개 채팅창에 붙여넣을 정중한 문장 |
| **고질병 RAG** | `site:`/웹 검색 요약 → 2차 프롬프트에 주입 (채택) |
| **실매물 시세** | LLM 추정 ❌ → 번개·당근 **비교 매물 URL**이 근거 |

### 발표 (다음 주, 점수에 거의 안 들어감)

- **5분, 슬라이드 5장**, **프롬프트 설계 과정**이 핵심 (완성도 X)
- 추천 구성: 문제 → 파이프라인 다이어그램 → 프롬프트 3종(JSON 출력) → 실매물 1건 실험 스샷 → 한계
- 구현 데모: 확장 → 분석 웹 10초면 충분

---

## 2. 시스템 구성 (지금 돌아가는 것)

```
┌─────────────────┐     chrome.storage      ┌──────────────────┐
│ 번개/당근 상세   │ ──GET_LISTING/REFRESH──►│ marketScrape*    │
│ (content script)│                         │ Latest, History  │
└────────┬────────┘                         │ Comps, AutoCollect│
         │                                  └────────┬─────────┘
         │ popup.js                                   │
         │  · 유사매물 검색 → 탭 2개 open              │ bridge-analyzer.js
         │  · 분석 웹으로 보내기                       │ postMessage
         ▼                                            ▼
┌─────────────────┐                         ┌──────────────────┐
│ 번개/당근 검색   │ ──COLLECT_SEARCH───────►│ analyzer :3920   │
│ (자동/수동 수집) │                         │ (로컬 Node 서버)  │
└─────────────────┘                         └──────────────────┘

[미연결] server.mjs:3847 + index.html — 번개 이미지 URL만 (Playwright)
```

---

## 3. URL 규칙 (코드와 1:1)

### 3.1 상세 페이지만 스크랩 허용

**번개장터** (`popup.js` / `bunjang.js`)

- 허용: `pathname` 이 `/products/{숫자}` 또는 `/posts/{숫자}`
- 예: `https://m.bunjang.co.kr/products/123456789`
- 거부: `/search`, `/categories`, 홈

**당근마켓** (`daangn.js`)

- 허용: `/kr/buy-sell/{slug}-{id}/` — id는 영숫자
- 예: `https://www.daangn.com/kr/buy-sell/메타-퀘스트-3-vr-abc123xyz/`
- 거부: `/kr/buy-sell/?search=...` (검색 목록)

### 3.2 검색 페이지 (비교 매물)

| 플랫폼 | URL 템플릿 |
|--------|------------|
| 번개 | `https://m.bunjang.co.kr/search/products?q={encodeURIComponent(q)}&order=score` |
| 당근 | `https://www.daangn.com/kr/buy-sell/?search={encodeURIComponent(q)}` |

- 검색어 `q`: 상세 **제목**에서 `[...]` 제거, 공백 정리, **최대 96자** (`lib/search-urls.js` → `guessSearchQuery`, AI 경로는 `analyzer-server.mjs` 와 동일 상한)
- 번개 `order`: `score` \| `popular` \| `date` \| `price_asc` \| `price_desc`
- 당근: **로그인 사용자의 동네** 기준 결과 → 리포트에 “지역 기준” 문구 필요

### 3.3 검색 페이지 판별

```text
번개: hostname includes bunjang + pathname includes /search + query has q
당근: pathname /kr/buy-sell/ + query has search
```

---

## 4. 확장 프로그램 — 로드 순서

`manifest.json` → content_scripts (번개/당근):

1. `lib/shared.js` — UI, `refresh`, 메시지 라우터  
2. `lib/search-urls.js` — URL 빌더  
3. `lib/images.js` — 노이즈 섹션·이미지 필터  
4. `lib/storage.js` — `saveListing`  
5. `lib/comps.js` — `saveComps`  
6. `hosts/bunjang.js` — 어댑터 등록  
7. `hosts/daangn.js` — 어댑터 등록  
8. `content.js` — `MarketScrape.boot()` 1회

`popup.js` 가 탭에 **같은 순서**로 `scripting.executeScript` 주입 (팝업 열 때마다).

분석 웹만: `bridge-analyzer.js` (3920 포트).

---

## 5. 메시지 프로토콜 (popup ↔ content)

| type | 호출 위치 | 동작 |
|------|-----------|------|
| `GET_LISTING` | 상세 팝업 로드 | `refresh()` → storage 저장 → listing 미리보기 필드 반환 |
| `REFRESH_AND_SAVE` | 「분석 웹으로 보내기」 | 동일 + `{ ok, imageCount, platform }` |
| `COLLECT_SEARCH` | 검색 팝업 「이 페이지 수집」 | `harvestSearchListings()` → `saveComps` |
| `REFRESH` | (FAB 패널용, 예전) | 패널 열기 |
| `GET_JSON` | (FAB, 예전) | 클립보드용 JSON |
| `TOGGLE_PANEL` | (FAB) | 페이지 내 패널 토글 |
| `PUSH_ANALYZER` | popup → bridge | storage → 분석 웹 `postMessage` |

응답 타임아웃: popup **25초**.

---

## 6. 데이터 스키마

### 6.1 본 매물 (`marketScrapeLatest`)

```json
{
  "platform": "bunjang | daangn",
  "platformLabel": "번개장터 | 당근마켓",
  "itemId": "숫자 또는 당근 id",
  "title": "",
  "price": 30000,
  "priceLabel": "30,000원 | 나눔",
  "body": "",
  "imageUrls": ["https://..."],
  "seller": { "nickname", "mannerScore", "reviewCount", ... },
  "source": "api | remix | dom",
  "sourceLabel": "",
  "pageUrl": "현재 탭 URL",
  "exportedAt": "ISO8601"
}
```

- `saveListing` 시 **다른 itemId**면 `marketScrapeComps` 를 `{ forItemKey, bunjang: null, daangn: null }` 로 리셋.

### 6.2 비교 매물 (`marketScrapeComps`)

```json
{
  "forItemKey": "bunjang:123456789",
  "bunjang": {
    "items": [
      {
        "platform": "bunjang",
        "platformLabel": "번개장터",
        "itemId": "987654321",
        "title": "제목",
        "price": 280000,
        "priceLabel": "280,000원",
        "url": "https://m.bunjang.co.kr/products/987654321"
      }
    ],
    "count": 12,
    "collectedAt": "ISO8601",
    "searchUrl": "열었던 검색 URL",
    "query": "검색어"
  },
  "daangn": { "... 동일 구조 ..." }
}
```

- 플랫폼당 최대 **40건** (`lib/comps.js`).

### 6.3 자동 수집 플래그 (`marketScrapeAutoCollect`)

```json
{ "bunjang": true, "daangn": true, "at": 1716123456789 }
```

- 「유사 매물 검색」 클릭 시 설정.  
- 검색 탭 content script: **1.2초 후** `tryAutoCollectSearch()` → 수집 후 해당 플랫폼 `false`.  
- **3분** 지나면 무시.

---

## 7. 플랫폼별 수집 구현 상세

### 7.1 번개장터 (`hosts/bunjang.js`)

**상세 API (1순위)**

```http
GET https://api.bunjang.co.kr/api/pms/v1/products/{pid}/detail/web
Origin: https://m.bunjang.co.kr
Referer: https://m.bunjang.co.kr/products/{pid}
```

- `imageUrl` 템플릿 + `imageCount` → `{cnt}` 치환 (**count 0이면 이미지 0장**, 예전 24장 버그 수정됨)
- 실패 시 DOM 폴백

**이미지**

- `media.bunjang.co.kr/product/{pid}_` 포함 URL만
- DOM: 갤러리/스와이퍼 영역만 (`findBunjangGalleryRoot`)
- API 이미지 있으면 **DOM 이미지와 merge 안 함**

**검색 목록**

- `a[href*="/products/"]`, `a[href*="/posts/"]` 카드에서 title·가격·URL

### 7.2 당근마켓 (`hosts/daangn.js`)

**상세 데이터 순서**

1. HTML 안 `window.__remixContext` 파싱  
2. 실패 시 **페이지 컨텍스트** 인라인 `<script>` 로 `__remixContext.state.loaderData` 읽기 (격리 월드 이슈)  
3. 실패 시 DOM `scrapeProductFromDom`

**본문 (중요 — 여러 번 깨졌던 부분)**

- `article` 전체 `innerText` **사용 안 함** (다른 매물·매너온도·조회수 섞임)
- 우선: `[class*="ArticleDescription"]`, `article-description`, `data-testid*="article-description"` 등
- `sanitizeDaangnBody`: `조회 N` 이후만 본문, `판매완료`·`비슷한 매물` 이후 절단, 줄 단위 필터
- Remix `content` 와 DOM 본문 중 **더 짧고 깨끗한 쪽** 선호

**이미지**

- `p.images` 배열 (Remix) 우선
- URL 필터: `img.kr.gcp-karroter.net` 등, profile/avatar 제외
- DOM은 갤러리 영역만

**검색 목록**

- `a[href*="/kr/buy-sell/"]` + slug-id 패턴
- 카드 텍스트에 `판매완료|예약중|거래완료` → **제외**

---

## 8. 팝업 UX 상태机 (사용자 관점)

### A. 매물 **상세** 탭

1. 아이콘 클릭 → 자동 `GET_LISTING` (제목·가격·본문·사진 8장)  
2. `비교 매물 · 번개 N건 · 당근 M건` (storage 폴링 0.8초)  
3. **[유사 매물 검색 · 자동 수집]**  
   - 검색어 = 제목 기반  
   - 번개·당근 탭 `active: false` 로 생성  
   - `marketScrapeAutoCollect` 설정  
   - 2.5초·5초 후 comps 줄 갱신  
4. **[분석 웹으로 보내기]**  
   - `REFRESH_AND_SAVE`  
   - 상태 **「전송 완료」** (초록) — **분석 탭은 백그라운드** (팝업 안 닫히게)  
   - 분석 탭 없으면 3920 탭 생성 후 `PUSH_ANALYZER`

### B. **검색** 탭

1. 팝업 UI 전환 (상세 패널 숨김)  
2. 검색어 표시 `「퀘스트3」` 등  
3. **[이 페이지 수집하기]** 또는 자동 수집 완료 시 `✓ N건 저장됨`  
4. 힌트: “매물 상세 탭에서 분석 웹으로 보내기”

### C. 그 외 페이지

- “매물 상세 또는 검색 결과 페이지에서 열어 주세요”

---

## 9. 분석 웹

**실행**

```bash
node analyzer-server.mjs
# → http://127.0.0.1:3920/
# 종료 Ctrl+C
```

**브릿지**

- `bridge-analyzer.js` → `window.postMessage({ type: 'MARKET_SCRAPE_BRIDGE', latest, history, comps })`
- `latest`에 `comps` 붙임: `forItemKey` 가 본 매물과 일치할 때만 (`attachComps`)

**화면**

- 본 매물: 제목·가격·판매자·본문·사진(슬라이더)·원본 링크
- 제품 정리: Gemini가 사진·제목·본문으로 제품 식별 → Google Search로 제품 설명, 국내 신품 시세/가격대, 제조사/판매처, 대표 이미지를 보강
- 2단계 리스크: 제품 정리 완료 후 자동 실행. `product-risk.txt`로 자연어 조사하고 `product-risk-json.txt`로 관련 이슈/고질병 카드 JSON 변환
- **비교 매물**: 현재는 제품 정리 카드에서 검색어 칩/비슷한 매물 버튼을 숨김. 나중에 관련 매물 단계에서 자동 노출 예정
- 사진 클릭 → `#lightbox` (max viewport - 32px)  
- 「불러오기」→ `MARKET_SCRAPE_REQUEST`

---

## 10. 설계 결정 로그 (왜 이렇게 했는지)

| 결정 | 이유 |
|------|------|
| 상세만 스크랩 | 목록 페이지 HTML 스캔 시 **다른 매물 ID** 섞임 (번개 카테고리 버그) |
| 이미지 갤러리만 | 추천·프로필·광고 이미지 제외 |
| 비교 매물 = 검색 탭 | 서버 크롤링·API 역공학 리스크 ↓, **실제 URL** 확보 |
| 자동 수집 + 수동 버튼 | SPA 로딩 느릴 때 백업 |
| 전송 시 탭 포커스 X | 팝업 닫혀 「전송 중…」만 보이던 버그 |
| 시세 LLM만 X | 희귀품 **환각 가격** 방지 → 표본 수·링크 공개 |
| RAG는 고질병에만 | 시세는 반드시 번개·당근 comps |
| `PROJECT.md` | 다른 PC Cursor가 기획서 모르는 문제 해결 |

---

## 11. 알려진 한계 · 버그 후보

| 현상 | 원인/대응 |
|------|-----------|
| 비교 0건 | 검색어 부정확·동네에 매물 없음·DOM 변경 |
| 자동 수집 안 됨 | 탭 로드 1.2초 전 종료 → **수동 수집** |
| 당근 본문仍 이상 | selector 변경 → `daangn.js` `harvestBodyFromDom` / `sanitizeDaangnBody` |
| 번개 API 403 | DOM 폴백, `Referer` 확인 |
| 분석 웹 빈 화면 | `analyzer-server.mjs` 미실행 |
| 확장 무반응 | `chrome://extensions` 새로고침, **상세 URL**인지 확인 |
| 학교 PC | 개발자 모드 확장 막힘 → 본인 노트북 데모 |

---

## 12. 설치 · 다른 PC 이전

### 12.1 복사할 것

```
used-listing-analyzer/
  extension/          ← 필수
  analyzer/
  analyzer-server.mjs
  package.json
  package-lock.json   (있으면)
  extension_icon.png
  PROJECT.md          ← 이 파일
  .gitignore
  .cursor/rules/      ← Cursor 키워드 규칙(.mdc), GitHub에 올려 맥/윈도 공유
```

**복사 X:** `node_modules/`

### 12.2 Windows 첫 실행

```powershell
cd Desktop\used-listing-analyzer
npm install
node analyzer-server.mjs
```

Chrome → `extension` 폴더 로드.

### 12.3 Git 권장 (한 번만)

```bash
git init
git add extension analyzer analyzer-server.mjs package.json PROJECT.md .gitignore extension_icon.png
git commit -m "중고 매물 스크랩 v2.3"
# GitHub push 후 Windows에서 clone
```

### 12.4 Cursor 대화

- Mac: `~/.cursor/projects/Users-joun-Desktop/agent-transcripts/`  
- **필수 아님** — `@PROJECT.md` + 코드면 충분  
- 원본 기획서: `docs/기획1.pdf` 등으로 추가

### 12.5 키워드 「깃동기화」— 맥·윈도 공통 (저장소에 포함)

목적: PC를 옮겨도 Cursor 채팅만으로 **원격 `main`과 맞추기**(다른 쪽에서 올린 커밋 **받아오기** + 이 PC에서 수정한 것 **올리기**).

| 항목 | 내용 |
|------|------|
| 트리거 | 채팅에 **`깃동기화`** 또는 **`sync-repo`** 입력 |
| 전제 | 이 워크스페이스가 **`https://github.com/jony0403/used-listing-analyzer`** 를 연 상태이고, 프로젝트 안에 **`.cursor/rules/git-sync-keyword.mdc`** 가 있어야 함 |
| 맥/다른 PC에서 처음 | 터미널에서 `git clone …` 또는 기존 폴더면 **`git pull origin main`** 으로 최신 받기 → 그 다음부터 Cursor에서 **`깃동기화`** 가능 |
| 동작(요약) | 에이전트가 `fetch` / `pull origin main` 으로 **원격 변경을 먼저 반영**한 뒤, 이 PC에 로컬 변경이 있으면 `commit`·`push` 를 처리함 |
| 인수인계 요약 | 이번 동기화 구간에서 **`PROJECT.md`가 바뀌면**(pull·로컬 커밋 포함) `git diff <시작_HEAD> HEAD -- PROJECT.md` 기준으로 **에이전트가 한국어로 변경점을 정리**해 줌(규칙 참고) |
| 규칙·신규 파일 | 동기화 구간에서 **추가·수정된 `.cursor/rules` 등**은 **`git diff --name-status`로 식별 후 Read로 전부 읽고**, 새 키워드·동작을 **이해한 뒤** 짧게 요약(규칙 참고) |
| “받아오기”만 하면 될 때 | 상대가 이미 push 했고 내 쪽 수정이 없으면, 실질적으로 **`pull`만** 이루어지고 커밋/푸시는 생략될 수 있음 |

**주의:** 예전에 USB로 폴더만 복사한 사본에는 `.cursor` 규칙이 없을 수 있음 → **GitHub에서 clone/pull 한 쪽**을 Cursor로 열 것.

### 12.6 Cursor 키워드 일람 · 규칙 변경 시 인수인계

| 트리거 | 동작 | 규칙 파일 |
|--------|------|-----------|
| `깃동기화` / `sync-repo` | `fetch`·`pull main`·로컬 변경 시 `commit`·`push` · **`PROJECT.md` 요약** · **변경된 규칙/신규 파일 Read** | `.cursor/rules/git-sync-keyword.mdc` |
| `분석서버켜` / `서버켜` / `analyzer-up` | `node analyzer-server.mjs` (백그라운드) → **http://127.0.0.1:3920/** (`ANALYZER_PORT` 없을 때) | `.cursor/rules/analyzer-server-keyword.mdc` |
| `분석서버꺼` / `서버꺼` / `analyzer-down` | 포트 3920(또는 설정한 `ANALYZER_PORT`) Listen 프로세스 종료 | 동일 |

**규칙 `.mdc` 를 새로 만들거나 고칠 때:** 이 표(또는 §15)·필요 시 상단 요약도 함께 수정하고, **`깃동기화`** 로 GitHub에 올려 다른 PC와 맞춘다. 에이전트 작업 절차: `.cursor/rules/handover-on-rule-changes.mdc`.

---

## 13. AI 단계 — 아직 미구현 (프롬프트 초안)

### 13.1 파이프라인

```text
[0] 수집 ✅
[1] listing JSON → LLM → { modelName, category, summary }
[2] 웹검색 "{model} 중고 흔한 하자" → RAG → chronic_issues[]
[3] Vision → { boxes:[{x,y,w,h,label}], contradictions[] }
[4] merge → risks[]
[5] comps stats + LLM → { median, negoRange, tooCheap }
[6] LLM → { questions[], chatLines[] }
```

### 13.2 출력 규칙 (발표·구현 공통)

- 주장마다 **근거** (사진 번호 / 본문 인용 / comp URL)  
- `confidence: low` → 추가 확인  
- 표본 `< 3` → `price_estimate: null`  
- 판매자 **비난 금지**, 확인 질문 톤

### 13.3 발표용 프롬프트 실험 (수동 OK)

ChatGPT에 `marketScrapeLatest` JSON 붙여넣고 1~3단계만 돌려도 “과정” 증명 가능.

### 13.4 세션 메모 (2026-05-20, 윈도우 Cursor)

**유사 매물 검색어 (`POST /api/search-query`, 확장 `openSearchTabs`)**

| 항목 | 내용 |
|------|------|
| 입력 | `title`, `body`, `imageUrls`(최대 6장, 서버가 fetch→Gemini inline) |
| 파이프라인 | **Google Search 연동** + 사진·글 → 검색어 한 줄 (`pipeline`: `google_search` \| `multimodal_fallback`) |
| 프롬프트 | 브랜드·제품별 하드코딩 규칙 **없음** — 웹·사진으로 제품 파악 후 번개·당근용 키워드 |
| 확장 | `2.5.4` — 검색 탭 ID 저장 → 수집 끝나면 `background.js`가 탭 자동 닫기. 상세 페이지는 우하단 아이콘 하나만 표시, 클릭 시 인페이지 패널이 아이콘에서 애니메이션으로 열림. 패널의 `분석 웹으로 보내기`는 `OPEN_ANALYZER_TAB` background 메시지 사용 |
| 당근 CSP | `2.5.5` — 당근 상세에서 인라인 `<script>`로 `window.__remixContext`를 읽던 경로 제거. CSP 오류 없이 정적 HTML/DOM 수집으로 폴백 |
| 플로팅 패널 | `2.5.6` — 지원 사이트에서는 상세 감지 전에도 우하단 아이콘 표시. 패널 버튼은 `분석 웹으로 보내기` + `유사 매물 검색 · 자동 수집`만 유지 |
| 플로팅 재주입 | `2.5.7` — 확장 재로드/팝업 재주입 후 남아 있던 구버전 `market-scrape-root`를 제거하고 최신 UI를 다시 부트. `content.js` 부트 가드 제거 |
| 플로팅 watchdog | `2.5.8` — 당근 SPA/새로고침 후 DOM에서 플로팅 루트가 사라지면 1.2초 주기로 자동 재부착. 중복 주입 시 기존 타이머 정리 |
| 키워드 후보 선택 | `2.5.9` — 플로팅 패널에서 `키워드 후보 만들기` 클릭 → AI가 `maxQueries: 3` 후보 반환 → 후보 버튼 클릭 시 해당 키워드로 번개·당근 검색 탭 열고 자동 수집. 수집 완료 후 `background.js`가 탭 자동 닫기 |
| 긴급 수정 | `2.5.10` — `shared.js` 이벤트 리스너 뒤 중복 `});` 제거. 이 문법 오류 때문에 `MarketScrape` 초기화가 실패하고 플로팅 버튼이 뜨지 않던 문제 수정 |
| 프롬프트 분리 | `2.6.0` — AI 프롬프트를 `prompts/search-query-single.txt`, `prompts/search-query-candidates.txt`로 분리. 교수님께 프롬프트 과정을 파일 단위로 보여줄 수 있음 |
| 후보 정제·닫기 보강 | `2.6.1` — `json`/코드펜스 조각이 후보로 뜨지 않게 서버·클라이언트 정제 강화. 검색 탭 자동 닫기는 수집 완료 이벤트 외에 45초 폴백 닫기 추가. 분석 브릿지는 확장 재로드 시 storage 예외 무시 |
| 당근 수집·닫기 보강 | `2.6.2` — 당근 상세 URL 판별을 `/kr/buy-sell`·canonical·og:url까지 확장하고 새 이미지 CDN을 허용. 자동수집 플래그를 검색 탭 생성 전 저장하고, 검색 페이지가 플래그 변경을 감지해 재수집하도록 해 탭 자동 닫기 레이스 완화 |
| 검색어 홍보문구 제거 | `2.6.3` — AI 후보에 `새상품 같은 ... 찾는다면` 등 판매자 홍보·권유 문장이 섞이면 서버와 확장 양쪽에서 제거. 프롬프트도 브랜드/라인/모델/품목 중심으로 검색어를 만들도록 보강 |
| 제품 식별어 보정 | `2.6.4` — 검색어 생성 프롬프트를 제품 식별어와 판매글 맥락 분리 절차로 보강. 잘린 검색어 보정이 제목 전체를 복사하지 않고 상태·거래·사용 설명 전까지만 확장하도록 수정 |
| 검색어 생성 속도 개선 | `2.6.5` — AI 이미지 입력을 최대 3장·장당 6초·병렬 다운로드로 제한하고, 가능한 경우 400px급 URL로 낮춤. Gemini 호출은 빠른 멀티모달을 먼저 쓰고 결과가 부적절할 때만 Google Search grounding으로 재시도 |
| 분석 웹 4블록 레이아웃 | 2026-05-20 — `analyzer/index.html`, `analyzer/style.css`, `analyzer/app.js`를 2x2 분석 보드 구조로 변경. 왼쪽 상단은 작은 매물 요약 블록, 나머지는 고질병·하자 분석/가격 판단/네고 대사 생성 블록 자리로 배치 |
| 분석 웹 미니블록 UI | 2026-05-20 — 빈 단계 placeholder는 숨기고, 실제 매물 정보만 제목·가격/판매자/본문/사진/시세/원본 링크 미니 카드로 분해. 당근 주황·번개 레드/블랙 계열로 세련된 카드형 대시보드 톤 적용 |
| 분석 웹 4분면 보정 | 2026-05-20 — 전체 보드는 2x2 분면 구조로 유지하되, 현재 1단계 매물 요약 미니카드는 왼쪽 위 한 분면 안에만 표시. 빈 단계 블록은 숨김. 그라데이션 제거, 최근 매물은 헤더 버튼으로 여는 왼쪽 drawer로 변경 |
| 제품 정리·2단계 자동 리스크 | 2026-05-21 — `prompts/product-summary.txt`, `product-risk.txt`, `product-risk-json.txt` 기반. 제품 정리 완료 즉시 2단계 리스크 분석 자동 시작. 리스크는 자연어 조사 후 JSON 카드화하며, 제품 진위/공식성 검증이 아니라 실제 중고 구매 체크 포인트만 추출 |
| AI 대화 디버그 | 2026-05-21 — 헤더 왼쪽 `AI 대화` 버튼 추가. `/api/ai-chat`으로 사용자가 쓴 문장을 그대로 Gemini+Google Search에 보내 자동 파이프라인과 모델 자체 응답 차이를 비교 |
| 분석 웹 UX 안정화 | 2026-05-21 — 2단계 카드 3열 미니블록, 1단계와 hover/등장 애니메이션 통일, 제품 설명은 넘칠 때만 내부 스크롤, 이미지 새로고침은 2단계 상태를 건드리지 않음, 최근 매물 선택 후 비교 요청 시 최신 매물로 튀지 않도록 선택 상태 보존 |
| 제품 세대·변형 보존 | 2026-05-21 — `스위치2`→`스위치/OLED`로 뭉개지던 오인 수정. `prompts/product-identify.txt`, `product-summary.txt`에 숫자·세대·OLED/Pro 등 변형 표기 유지 규칙 추가. `cleanProductName()` 후 `preserveVariantTokens()`로 제목·본문에 있는 `스위치2`·`Switch 2`·OLED 등이 AI 출력에서 빠지면 복원 |

**비교 매물 수집 (`harvestSearchListings`)**

- **판매완료·예약중**도 수집(당근 `saleStatus` 필드). 카테고리만 막지 않음.
- 한글 검색어일 때 제목에 검색 토큰 없으면 스킵 (`listingTitleMatchesSearchQuery`).

**알려진 이슈 (다음에 고칠 것)**

- [ ] `usedImages: 0` 이면 이미지 fetch 실패 — 터미널 `[search-query] 이미지 로드 생략` 확인.
- [ ] Google Search 도구가 API 키·모델에서 거부되면 `multimodal_fallback`만 동작.
- [ ] 2단계 리스크 프롬프트는 최종적으로 “직접 대화처럼 제품명을 전제로 관련 이슈만 묻는 방식”이 안정적이었다. 향후 다른 제품군 테스트 시 제품군별 하드코딩 예시를 추가하지 말고, 절차형 판단/근거 필터만 조정할 것.
- [x] 제품 식별 시 후속작 번호·변형 표기 누락 (`스위치2`→기본 스위치) — 프롬프트 + `preserveVariantTokens()` (2026-05-21)

**서버:** `node analyzer-server.mjs` (3920). 코드 바꾼 뒤 **반드시 재시작**. Cursor 키워드 `분석서버켜` / `분석서버꺼`.

---

## 14. 다음 작업 체크리스트 (우선순위)

- [ ] **검색어 API** — 설명문·메타 문구가 검색어로 들어가는 버그 수정 (§13.4)  
- [ ] 비교 매물 DOM 깨짐 시 셀렉터 수정 (`harvestSearchListings`)  
- [ ] 분석 웹: 관련 매물 단계 자동 노출. 현재 제품 정리 카드의 검색어 칩/비슷한 매물 버튼은 숨김  
- [ ] `docs/기획1.pdf` 추가  
- [ ] Vision bbox 오버레이 (`canvas` on image)  
- [x] 검색어 프롬프트 파일 분리 (`prompts/search-query-*.txt`)  

---

## 15. 빠른 명령 · 경로

| 목적 | 명령/URL |
|------|----------|
| 분석 웹(직접) | `node analyzer-server.mjs` → http://127.0.0.1:3920/ |
| 분석 웹 아이콘 | `/icons/icon*.png` 를 `extension/icons`에서 서빙. `analyzer/index.html` 파비콘·헤더 로고가 확장 아이콘과 동일 |
| **분석 웹(Cursor)** | **`분석서버켜`** / **`서버켜`** / **`analyzer-up`** → 서버 기동 · **`분석서버꺼`** / **`서버꺼`** / **`analyzer-down`** → 종료 (`.cursor/rules/analyzer-server-keyword.mdc`) |
| **Gemini·유사 매물** | `/api/search-query`: 사진(`imageUrls`)·제목·본문 + **Gemini Google Search 연동**으로 제품 파악. `maxQueries: 3`이면 후보 배열 `queries` 반환, 없으면 검색어 한 줄. 프롬프트에 특정 브랜드 규칙 없음. |
| 발표용 프롬프트 설명 | `presentation-prompts/prompt-process-summary.md` — 5페이지 발표/추후 HTML 슬라이드 제작용 프롬프트 설계 과정 정리 |
| 레거시 이미지 | `npm start` → http://127.0.0.1:3847/ |
| 아이콘 재생성 | `./extension/build-icons.sh` (Mac, `extension_icon.png` 필요) |
| **GitHub 동기화 (Cursor)** | **`깃동기화`** / **`sync-repo`** → pull·commit·push · `PROJECT.md` 요약 · **변경된 `.cursor/rules` Read** (`.cursor/rules/git-sync-keyword.mdc`) |
| **규칙 추가·수정 후** | `PROJECT.md` §12.6·§15 갱신 → **`깃동기화`** (`.cursor/rules/handover-on-rule-changes.mdc`) |

---

## 16. Cursor에게 시킬 때 예시

```text
@PROJECT.md @extension/popup.js
당근 검색 페이지에서 수집이 0건이야. harvestSearchListings 셀렉터부터 디버깅해줘.
```

```text
@PROJECT.md
analyzer에 OpenAI로 step1 프롬프트 붙이는 최소 API만 추가해줘. 키는 .env.
```

```text
깃동기화
```
(또는 `sync-repo` — 원격 `main` 기준으로 pull 후, 로컬 변경이 있으면 커밋하고 push)

```text
분석서버켜
```

```text
분석서버꺼
```

---

*이 문서는 2026-05-20 세션까지 반영, 코드베이스 v2.6.5 기준. 수정 시 manifest version과 함께 갱신할 것.*
