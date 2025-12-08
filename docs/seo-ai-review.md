# SEO, Metadata 및 AI 추천 최적화 코드 리뷰

## 1. 현황 분석 요약

현재 웹사이트는 Next.js App Router를 기반으로 구축되어 있으며, 전반적으로 높은
수준의 SEO 및 메타데이터 구현 상태를 보여줍니다. 특히 `next.config.js`를 통한
보안 헤더 설정, 이미지 최적화, 그리고 `structuredData.tsx`를 통한 JSON-LD
구조화된 데이터 생성이 체계적으로 이루어져 있습니다.

하지만 Sitemap 및 Robots.txt 생성 방식에서 App Router의 표준 방식과 레거시 API
방식이 혼재되어 있어 중복 및 유지보수 복잡성이 존재합니다. 또한 AI 검색
엔진(Perplexity, ChatGPT Search 등)의 인용 확률을 높이기 위한 몇 가지 미세
조정이 가능합니다.

---

## 2. 상세 코드 리뷰 및 개선점

### 2.1. Sitemap 및 Robots.txt 구현 (중복 제거 필요)

**현황:**

- `src/app/sitemap.ts`: App Router 표준 방식의 Sitemap 생성 로직이 존재합니다.
- `src/app/api/sitemap/route.ts`: API 라우트 방식의 커스텀 Sitemap 생성 로직이
  별도로 존재합니다.
- `next.config.js`: `/sitemap.xml` 요청을 `/api/sitemap`으로
  리라이트(rewrite)하고 있습니다.

**문제점:**

- 두 가지 Sitemap 생성 로직이 공존하여 코드 중복이 발생합니다.
- `next.config.js`의 리라이트 규칙으로 인해 App Router의 내장 `sitemap.ts`
  기능이 무시되거나 불필요하게 우회되고 있습니다.

**개선 제안:**

- **권장:** `src/app/api/sitemap` 및 `src/app/api/robots` 디렉토리를 삭제하고,
  `next.config.js`의 `rewrites` 설정을 제거합니다.
- `src/app/sitemap.ts`와 `src/app/robots.ts`(신규 생성 필요)를 사용하여 Next.js
  표준 방식을 따르도록 통일합니다. 이는 빌드 시 정적 생성(SSG) 최적화에도
  유리합니다.

### 2.2. 메타데이터 및 SEO 설정

**현황:**

- `src/app/layout.tsx`: `metadataBase`, `openGraph`, `twitter` 등 필수
  메타데이터가 잘 정의되어 있습니다.
- `src/app/page.tsx`: 페이지별 메타데이터 오버라이딩이 적절히 구현되어 있습니다.

**개선 제안:**

- **`alternates` 설정 강화:** 다국어 지원 계획이 있다면 `languages` 설정을
  구체화하고, 현재는 한국어 전용이므로 `canonical` URL 생성 로직을 자동화하는
  유틸리티 도입을 고려할 수 있습니다.
- **이미지 Alt 텍스트:** `Hero.tsx` 등에서 `alt` 속성이 잘 사용되고 있으나, 모든
  이미지(특히 갤러리나 아티스트 프로필)에 대해 구체적이고 설명적인 Alt 텍스트가
  동적으로 생성되도록 보장해야 합니다.

### 2.3. 구조화된 데이터 (Structured Data)

**현황:**

- `src/utils/structuredData.tsx`: `Organization`, `WebSite`, `Article`, `Person`
  등 다양한 스키마를 잘 지원하고 있습니다.

**개선 제안:**

- **`BreadcrumbList` 적용:** 모든 하위 페이지(아티스트 상세, 프로젝트 상세 등)에
  `BreadcrumbList` 스키마를 추가하여 검색 결과에서 사이트 구조가 더 잘
  드러나도록 합니다.
- **`Event` 스키마 추가:** 공연이나 전시 일정에 대해 `Event` 스키마를 적용하면
  구글 검색 결과의 이벤트 섹션에 노출될 확률이 높아집니다.

---

## 3. AI 추천 확률 최적화 (AI Search Optimization)

AI 검색 엔진(ChatGPT, Perplexity, Gemini 등)은 기존 검색 엔진보다 "콘텐츠의
의미"와 "신뢰성"을 더 중요하게 평가합니다.

### 3.1. 시맨틱 마크업 (Semantic Markup)

- **현황:** `Hero.tsx`, `AboutPage` 등에서 `<section>`, `<h1>`, `<h2>` 태그가
  적절히 사용되고 있습니다.
- **개선:** 본문 콘텐츠(아티스트 소개, 프로젝트 설명)가 `<div>` 남발이 아닌
  `<article>`, `<p>`, `<ul>`/`<li>` 등으로 명확히 구조화되도록 유지해야 합니다.
  AI는 텍스트의 위계를 HTML 태그로 파악합니다.

### 3.2. 콘텐츠 명확성 (Content Clarity)

- **제안:** 각 페이지의 핵심 정보(누가, 언제, 어디서, 무엇을, 왜)가 상단에
  명확한 텍스트로 존재해야 합니다.
- **AI 최적화:** "자주 묻는 질문(FAQ)" 페이지를 확충하고 `FAQPage` 스키마를
  적용하면, AI가 사용자 질문에 대한 답변을 생성할 때 해당 내용을 인용할 확률이
  매우 높아집니다.

### 3.3. 로봇 접근성

- **현황:** `robots.txt`가 모든 User-agent(`*`)를 허용하고 있습니다.
- **제안:** AI 봇(예: `GPTBot`, `CCBot` 등)을 명시적으로 허용하거나 제어할
  필요가 있는지 검토합니다. 현재는 모두 허용이므로 AI 학습 및 인용에는 유리한
  상태입니다.

---

## 4. 실행 계획 (Action Items)

1.  **[Refactor] Sitemap/Robots 표준화:**
    - `src/app/api/sitemap`, `src/app/api/robots` 삭제
    - `next.config.js` 내 `rewrites` 제거
    - `src/app/robots.ts` 생성
2.  **[Feature] 구조화된 데이터 확장:**
    - 상세 페이지에 `BreadcrumbList` 스키마 적용
    - 공연/전시 페이지에 `Event` 스키마 적용
3.  **[Content] AI 최적화 콘텐츠 보강:**
    - 주요 페이지 텍스트 구조 점검 (시맨틱 태그 강화)
    - FAQ 콘텐츠 및 스키마 추가

이 문서를 바탕으로 우선순위에 따라 최적화 작업을 진행하시길 권장합니다.
