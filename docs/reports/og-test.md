# 프로젝트 상세페이지 OG 이미지 테스트 가이드

## ✅ 수정 사항 요약

### 1. 메타데이터 생성 로직 개선

- 프로젝트 상세페이지에서 직접 이미지 URL을 사용하도록 변경
- 타임스탬프를 제거하여 캐싱 최적화
- SNS 크롤러가 안정적으로 읽을 수 있도록 정적 URL 사용

### 2. 이미지 최적화

- WebP 이미지를 JPG로 자동 변환하는 스크립트 추가
- SNS 플랫폼 호환성 극대화
- 모든 프로젝트와 로고 이미지 JPG 버전 생성 완료

### 3. 메타데이터 구조 개선

```html
<!-- Open Graph -->
<meta property="og:title" content="경기아트콜렉티브 오프닝 파티" />
<meta
  property="og:description"
  content="경기아트콜렉티브 오프닝 파티에 여러분을 초대합니다!"
/>
<meta property="og:url" content="https://ggac.kr/archive/opening-party" />
<meta property="og:site_name" content="경기아트콜렉티브 협동조합" />
<meta
  property="og:image"
  content="https://ggac.kr/images/projects/opening-party.webp"
/>
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta property="og:image:alt" content="경기아트콜렉티브 오프닝 파티" />
<meta property="og:type" content="article" />
<meta property="og:locale" content="ko_KR" />

<!-- Twitter Cards -->
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="경기아트콜렉티브 오프닝 파티" />
<meta
  name="twitter:description"
  content="경기아트콜렉티브 오프닝 파티에 여러분을 초대합니다!"
/>
<meta
  name="twitter:image"
  content="https://ggac.kr/images/projects/opening-party.webp"
/>
```

## 🔗 테스트할 URL들

### 프로젝트 상세페이지들

1. **경기아트콜렉티브 오프닝 파티**
   - URL: `https://ggac.kr/archive/opening-party`
   - 썸네일: `/images/projects/opening-party.webp`

2. **수원 Acme Studio 집들이**
   - URL: `https://ggac.kr/archive/acme-studio-housewarming`
   - 썸네일: `/images/projects/studioparty1.webp`

3. **경기아트콜렉티브 창립총회**
   - URL: `https://ggac.kr/archive/Founding-General-Meeting`
   - 썸네일: `/images/projects/Founding-General-Meeting.webp`

## 🧪 테스트 방법

### 1. Facebook 디버거

- URL: https://developers.facebook.com/tools/debug/
- 각 프로젝트 상세페이지 URL 입력
- "Scrape Again" 버튼으로 새로 스크래핑

### 2. Twitter Card Validator

- URL: https://cards-dev.twitter.com/validator
- 각 프로젝트 상세페이지 URL 입력
- 카드 미리보기 확인

### 3. LinkedIn Post Inspector

- URL: https://www.linkedin.com/post-inspector/
- 각 프로젝트 상세페이지 URL 입력

### 4. 직접 이미지 확인

- 개별 이미지 URL 브라우저에서 접근 테스트:
  - `https://ggac.kr/images/projects/opening-party.webp`
  - `https://ggac.kr/images/projects/studioparty1.webp`
  - `https://ggac.kr/images/projects/Founding-General-Meeting.webp`

## 📋 배포 체크리스트

### 배포 전

- [x] 이미지 JPG 변환 완료
- [x] 메타데이터 로직 수정 완료
- [x] 로컬 빌드 테스트 성공
- [x] next.config.js 정리 완료

### 배포 후

- [ ] 프로덕션에서 이미지 접근성 확인
- [ ] Facebook 디버거 테스트
- [ ] Twitter Card Validator 테스트
- [ ] 실제 SNS 공유 테스트

## 🎯 예상 결과

이제 프로젝트 상세페이지를 SNS에 공유할 때:

- 프로젝트의 커버 이미지가 썸네일로 표시됨
- 프로젝트 제목과 설명이 정확히 표시됨
- 모든 주요 SNS 플랫폼에서 일관된 표시

포스터나 행사 이미지가 있는 프로젝트의 경우, 해당 이미지가 썸네일로 사용되어
훨씬 더 매력적인 공유 카드가 생성됩니다.
