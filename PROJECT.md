# 중고 매물 스크랩 · 가격 분석 — 상세 인수인계

> **다른 PC / 새 Cursor 채팅**에서는 맨 처음에  
> `@PROJECT.md` 를 읽고 작업하세요.

- **작성일:** 2026-05-19  
- **확장 버전:** `extension/manifest.json` → `2.3.0`  
- **워크스페이스:** `used-listing-analyzer`

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

- 검색어 `q`: 상세 **제목**에서 `[...]` 제거, 공백 정리, **최대 40자** (`lib/search-urls.js` → `guessSearchQuery`)
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

- 본 매물: 제목·가격·판매자·본문·사진(12)·원본 링크  
- **비교 매물**: N건, 중앙값·min~max, 링크 15개  
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

---

## 14. 다음 작업 체크리스트 (우선순위)

- [ ] 비교 매물 DOM 깨짐 시 셀렉터 수정 (`harvestSearchListings`)  
- [ ] 분석 웹: 판매완료 comp 표시/필터  
- [ ] `docs/기획1.pdf` 추가  
- [ ] analyzer에 OpenAI API 라우트 (`POST /api/analyze`)  
- [ ] Vision bbox 오버레이 (`canvas` on image)  
- [ ] 프롬프트 JSON 스키마 파일 `prompts/step1.json`  
- [ ] GitHub remote push  

---

## 15. 빠른 명령 · 경로

| 목적 | 명령/URL |
|------|----------|
| 분석 웹 | `node analyzer-server.mjs` → http://127.0.0.1:3920/ |
| 레거시 이미지 | `npm start` → http://127.0.0.1:3847/ |
| 확장 새로고침 | chrome://extensions |
| 아이콘 재생성 | `./extension/build-icons.sh` (Mac, `extension_icon.png` 필요) |

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

---

*이 문서는 Mac Cursor 대화(2026-05-19)와 코드베이스 v2.3.0 기준으로 작성됨. 수정 시 manifest version과 함께 갱신할 것.*
