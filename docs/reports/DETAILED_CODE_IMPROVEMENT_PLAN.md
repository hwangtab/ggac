# 경기아트콜렉티브 웹사이트 상세 코드 개선 계획

## 📊 분석 요약

### 발견된 주요 문제점

- **고우선순위**: 필터링 로직 중복, 카테고리 정의 불일치, Post 인터페이스 중복
- **중간우선순위**: UI 패턴 중복, 사용하지 않는 파일, import 패턴 불일치
- **저우선순위**: 패키지 의존성, 에러 핸들링 불일치, 타입 정의 중복

### 전체 개선 목표

- 코드 중복성 90% 제거
- 타입 안정성 100% 확보
- 유지보수성 50% 향상
- 빌드 시간 20% 단축

---

## 🚀 Phase 1: 필터링 시스템 통합 (HIGH Priority)

### 목표

중복된 필터링 로직 제거 및 카테고리 표준화를 통한 유지보수성 향상

### 소요 시간: 1.5-2시간

### 위험도: 낮음 ✅

### 작업 목록

#### 1.1 카테고리 상수 중앙화 (30분)

**생성할 파일**: `src/constants/categories.ts`

```typescript
export const PROJECT_CATEGORIES = [
  'All',
  '음반·음원',
  '공연·전시',
  '예술교육',
  '지원·용역사업',
  '행사',
] as const

export const ARTIST_CATEGORIES = ['All', '창작자', '기획자'] as const

export const BOARD_CATEGORIES = [
  '전체',
  '공지',
  '잡담',
  '홍보',
  '건의',
] as const

export type ProjectCategory = (typeof PROJECT_CATEGORIES)[number]
export type ArtistCategory = (typeof ARTIST_CATEGORIES)[number]
export type BoardCategory = (typeof BOARD_CATEGORIES)[number]
```

**수정할 파일들**:

- `src/app/archive/ArchiveContent.tsx` (lines 13-20)
- `src/app/artists/ArtistsContent.tsx` (line 12)
- `src/components/PostList.tsx` (line 52)
- `src/components/CreatePostForm.tsx` (line 25)

#### 1.2 재사용 가능한 useFilter 훅 생성 (45분)

**생성할 파일**: `src/hooks/useFilter.ts`

```typescript
import { useMemo } from 'react'

interface FilterableItem {
  category: string | string[]
}

export const useFilter = <T extends FilterableItem>(
  items: T[],
  selectedCategory: string,
  allLabel: string = 'All'
) => {
  return useMemo(() => {
    if (selectedCategory === allLabel) return items

    return items.filter(item => {
      if (Array.isArray(item.category)) {
        return item.category.includes(selectedCategory)
      }
      return item.category === selectedCategory
    })
  }, [items, selectedCategory, allLabel])
}
```

#### 1.3 기존 컴포넌트 업데이트 (45분)

**수정 대상**:

- `src/app/archive/ArchiveContent.tsx` - useFilter 훅 적용
- `src/app/artists/ArtistsContent.tsx` - useFilter 훅 적용

### 검증 방법

1. 필터링 기능이 모든 페이지에서 정상 작동하는지 확인
2. TypeScript 컴파일 에러 없음 확인
3. 카테고리 변경 시 UI 반응 정상 확인

---

## 🔧 Phase 2: 타입 시스템 통합 (HIGH Priority)

### 목표

중복된 타입 정의 제거 및 중앙화된 타입 시스템 구축

### 소요 시간: 2-2.5시간

### 위험도: 중간 ⚠️

### 작업 목록

#### 2.1 Post 인터페이스 통합 (60분)

**수정할 파일**: `src/types/index.ts`

```typescript
// 기존 타입에 추가
export interface Post {
  id: string
  title: string
  content: string
  category: BoardCategory
  author_id: string
  created_at: string
  updated_at?: string
  is_deleted?: boolean
  author?: {
    name: string
    email: string
  }
}

export interface Comment {
  id: string
  post_id: string
  content: string
  author_id: string
  created_at: string
  author?: {
    name: string
    email: string
  }
}
```

**제거할 중복 정의들**:

- `src/components/PostList.tsx` (lines 7-14)
- `src/components/CreatePostForm.tsx` (lines 10-17)
- `src/hooks/usePostsWithPagination.ts` (lines 6-13)

#### 2.2 OptimizedImage Props 통합 (30분)

**통합 위치**: `src/types/index.ts` **제거할 중복**:
`src/components/OptimizedImage.tsx` 내 인터페이스

#### 2.3 타입 import 표준화 (60분)

**수정 패턴**:

```typescript
// Before
interface Post { ... }

// After
import type { Post } from '@/types'
```

**수정할 파일들**: 10+ 컴포넌트 파일

### 검증 방법

1. `npm run build` 성공 확인
2. TypeScript 에러 0개 확인
3. 모든 타입 import가 정상 작동하는지 확인

---

## 🧹 Phase 3: 보안 강화 및 UI 통합 (MEDIUM Priority)

### 목표

XSS 취약점 완전 제거 및 UI 컴포넌트 통합

### 소요 시간: 1.5-2시간

### 위험도: 낮음 ✅

### 작업 목록

#### 3.1 보안 유틸리티 강화 (45분)

**수정할 파일**: `src/utils/security.ts`

- XSS 방지 함수 추가 개선
- HTML 태그 화이트리스트 구현
- URL 검증 로직 강화

#### 3.2 공통 카드 컴포넌트 생성 (60분)

**생성할 파일**: `src/components/common/BaseCard.tsx`

```typescript
interface BaseCardProps {
  title: string
  description: string
  category: string
  imageUrl: string
  href: string
  date?: string
  author?: string
  className?: string
}
```

#### 3.3 스타일 유틸리티 클래스 생성 (15분)

**수정할 파일**: `tailwind.config.js`

```javascript
module.exports = {
  theme: {
    extend: {
      // 자주 사용되는 조합을 유틸리티로 등록
    },
  },
}
```

### 검증 방법

1. XSS 테스트 스크립트 실행
2. 카드 컴포넌트 렌더링 확인
3. 시각적 일관성 검증

---

## 🗂️ Phase 4: 코드 정리 및 최적화 (MEDIUM Priority)

### 목표

불필요한 파일 제거 및 import 패턴 표준화

### 소요 시간: 1-1.5시간

### 위험도: 낮음 ✅

### 작업 목록

#### 4.1 사용하지 않는 파일 정리 (30분)

**제거 대상**:

- `src/utils/routeProtection.ts` (사용되지 않음)
- `src/utils/authDebug.ts` (개발용으로 이동)

**이동 대상**:

- 개발용 파일들을 `src/dev/` 폴더로 이동

#### 4.2 Import 패턴 표준화 (45분)

**표준화 규칙**:

```typescript
// 절대 경로 사용
import Component from '@/components/Component'
import type { TypeName } from '@/types'
import { utility } from '@/utils/utility'

// 상대 경로 금지
import Component from '../components/Component' // ❌
```

**수정 대상**: 전체 src/ 디렉토리 (50+ 파일)

#### 4.3 패키지 의존성 최적화 (15분)

**수정할 파일**: `package.json`

- `@playwright/test`를 devDependencies로 이동
- 사용하지 않는 패키지 제거 검토

### 검증 방법

1. 빌드 성공 확인
2. 모든 import가 정상 작동하는지 확인
3. 패키지 설치 오류 없음 확인

---

## 📈 실행 전략

### 실행 순서

1. **Phase 1** → 필터링 시스템 (핵심 기능)
2. **Phase 2** → 타입 시스템 (안정성)
3. **Phase 3** → 보안/UI (품질)
4. **Phase 4** → 정리 (최적화)

### 병렬 실행 가능

- Phase 1과 Phase 3는 독립적 실행 가능
- Phase 2는 Phase 1 완료 후 실행 권장

### 롤백 전략

- 각 Phase 완료 후 Git 커밋
- 문제 발생 시 이전 커밋으로 롤백
- 중요 변경사항은 별도 브랜치에서 작업

---

## 🔍 품질 보증

### 각 Phase 완료 후 확인사항

1. **빌드 성공**: `npm run build`
2. **타입 체크**: `npm run typecheck`
3. **린트 통과**: `npm run lint`
4. **기능 테스트**: 주요 페이지 동작 확인

### 최종 검증

1. **성능 테스트**: 페이지 로딩 시간 측정
2. **보안 테스트**: XSS 취약점 스캔
3. **사용자 테스트**: 주요 사용자 플로우 확인

---

## 📊 예상 성과

### 정량적 지표

- **중복 코드**: 90% 감소
- **TypeScript 에러**: 100% 해결
- **빌드 시간**: 20% 단축
- **번들 크기**: 10% 감소

### 정성적 지표

- **유지보수성**: 크게 향상
- **개발 생산성**: 30% 향상
- **코드 품질**: 전반적 개선
- **신규 개발자 온보딩**: 시간 단축

---

## 🚨 위험 요소 및 대응

### 잠재적 위험

1. **타입 변경으로 인한 빌드 에러**
   - 대응: 점진적 변경 및 충분한 테스트
2. **UI 변경으로 인한 시각적 문제**
   - 대응: 스타일 가이드 준수 및 시각적 확인
3. **import 경로 변경으로 인한 에러**
   - 대응: IDE 자동 refactoring 활용

### 비상 계획

- 각 Phase별 Git 태그 생성
- 중요 변경사항은 feature 브랜치에서 작업
- 프로덕션 배포 전 staging 환경 테스트

---

## ✅ 체크리스트

### Phase 1

- [ ] 카테고리 상수 파일 생성
- [ ] useFilter 훅 구현
- [ ] 기존 컴포넌트 업데이트
- [ ] 필터링 기능 테스트

### Phase 2

- [ ] Post 인터페이스 통합
- [ ] 중복 타입 정의 제거
- [ ] import 문 업데이트
- [ ] TypeScript 컴파일 확인

### Phase 3

- [ ] 보안 유틸리티 개선
- [ ] 공통 카드 컴포넌트 생성
- [ ] XSS 취약점 테스트
- [ ] UI 일관성 확인

### Phase 4

- [ ] 불필요한 파일 제거
- [ ] Import 패턴 표준화
- [ ] 패키지 의존성 정리
- [ ] 최종 빌드 테스트

---

## 📝 완료 후 문서화

### 업데이트할 문서

- `CLAUDE.md` - 새로운 구조 반영
- `README.md` - 개선된 아키텍처 설명
- 타입 시스템 가이드 추가

### 팀 공유사항

- 새로운 카테고리 상수 사용법
- 표준화된 import 패턴
- 공통 컴포넌트 사용 가이드

---

_이 계획서는 프로덕션 안정성을 최우선으로 하여 작성되었습니다. 각 단계별로
충분한 테스트를 거쳐 안전하게 진행하시기 바랍니다._
