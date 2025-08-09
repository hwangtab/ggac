# 프로필 사진 시스템 종합 문서

## 📋 개요

경기아트콜렉티브 협동조합의 프로필 사진 업로드 및 관리 시스템에 대한 종합 문서입니다. 이 시스템은 아티스트 프로필 사진을 안전하고 효율적으로 관리하기 위해 구현되었습니다.

## 🏗️ 시스템 아키텍처

### 1. 컴포넌트 구조

```
src/
├── components/
│   ├── MediaManager.tsx          # 범용 미디어 관리 컴포넌트
│   └── ProfilePhotoUploader.tsx  # 프로필 사진 전용 업로더
├── app/
│   ├── api/
│   │   ├── mypage/artist/photo/route.ts  # 아티스트 프로필 사진 API
│   │   └── media/upload/route.ts         # 범용 미디어 업로드 API
│   └── mypage/
│       ├── profile/components/
│       │   ├── PersonalInfo.tsx          # 개인정보 (읽기전용 프로필 사진)
│       │   └── ProfileEditForm.tsx       # 프로필 편집 폼
│       └── artist/                       # 아티스트 프로필 관리 페이지
└── types/index.ts                        # 타입 정의
```

### 2. 데이터 플로우

```
1. 사용자 파일 선택
   ↓
2. 클라이언트 사이드 검증 (크기, 타입)
   ↓
3. 이미지 미리보기 및 크기 추출
   ↓
4. 크롭 모달 (옵션)
   ↓
5. 서버 업로드 (/api/mypage/artist/photo)
   ↓
6. Supabase Storage 저장
   ↓
7. 데이터베이스 업데이트 (artists 테이블)
   ↓
8. 공개 URL 반환 및 UI 업데이트
```

## 🔧 핵심 기능

### ProfilePhotoUploader 컴포넌트

**주요 기능:**
- 드래그 앤 드롭 파일 업로드
- 파일 타입 및 크기 검증
- 이미지 미리보기 생성
- 업로드 진행률 표시
- 크롭 모달 (향후 구현)
- 프로필 사진 삭제 기능

**지원 파일 형식:**
- JPEG (.jpg, .jpeg)
- PNG (.png)
- WebP (.webp)
- GIF (.gif)

**크기 제한:**
- 아티스트 프로필 사진: 최대 5MB
- 일반 미디어: 최대 10MB

### MediaManager 컴포넌트

**주요 기능:**
- 단일/다중 파일 업로드 지원
- 다양한 Storage bucket 지원
- 파일 메타데이터 관리
- 업로드 상태 추적
- 에러 핸들링

### API 엔드포인트

#### `/api/mypage/artist/photo`

**PUT** - 아티스트 프로필 사진 업로드/변경
- 인증 확인 (로그인 필요)
- 아티스트 권한 확인 (is_artist, artist_id)
- 승인 상태 확인 (registration_status: 'approved')
- 파일 유효성 검사
- Supabase Storage 업로드
- 데이터베이스 업데이트
- 기존 파일 정리

**DELETE** - 아티스트 프로필 사진 삭제
- 권한 확인
- Storage에서 파일 삭제
- 데이터베이스 레코드 정리

**GET** - 아티스트 프로필 사진 메타데이터 조회
- 현재 프로필 사진 정보 반환
- 메타데이터 포함

#### `/api/media/upload`

**POST** - 범용 미디어 파일 업로드
- 다중 bucket 지원 (profiles, attachments, artists)
- 파일 타입별 크기 제한
- 메타데이터 자동 추출
- 안전한 파일명 생성

**GET** - 업로드된 파일 목록 조회
- 사용자별 파일 목록
- 페이지네이션 지원

## 🗄️ 데이터베이스 스키마

### artists 테이블

```sql
ALTER TABLE artists 
ADD COLUMN profile_photo_url TEXT,
ADD COLUMN profile_photo_metadata JSONB;
```

**profile_photo_metadata 구조:**
```json
{
  "original_filename": "photo.jpg",
  "file_size": 2048576,
  "content_type": "image/jpeg",
  "uploaded_at": "2025-07-20T10:30:00Z",
  "width": 1200,
  "height": 1200,
  "processed": true,
  "crop_info": {
    "x": 0,
    "y": 0,
    "width": 1200,
    "height": 1200
  }
}
```

### member_profiles 테이블

기존 필드 활용:
- `is_artist`: 아티스트 권한 여부
- `artist_id`: 연결된 아티스트 프로필 ID
- `registration_status`: 'approved' 상태 확인

## 🔐 보안 및 검증

### 클라이언트 사이드 검증

1. **파일 타입 검증**
   ```typescript
   const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
   if (!allowedTypes.includes(file.type)) {
     // 에러 처리
   }
   ```

2. **파일 크기 검증**
   ```typescript
   const maxSize = 5 * 1024 * 1024 // 5MB
   if (file.size > maxSize) {
     // 에러 처리
   }
   ```

### 서버 사이드 보안

1. **인증 및 권한 확인**
   - Supabase Auth 세션 검증
   - 아티스트 권한 확인
   - 활성 멤버 상태 확인

2. **파일 검증**
   - 서버에서 재검증
   - MIME 타입 확인
   - 파일 크기 제한

3. **Storage 보안**
   - Supabase RLS (Row Level Security) 정책
   - 안전한 파일명 생성
   - 공개 URL 관리

## 📱 사용자 인터페이스

### 프로필 페이지 (/mypage/profile)

**PersonalInfo 컴포넌트:**
- 아티스트 프로필 사진 읽기 전용 표시
- 아티스트 프로필 관리 페이지로 이동 링크
- 권한 없는 사용자에게 안내 메시지

### 아티스트 관리 페이지 (/mypage/artist)

**ProfilePhotoUploader 사용:**
- 드래그 앤 드롭 업로드 영역
- 현재 프로필 사진 표시
- 업로드 진행률 시각화
- 삭제 및 변경 버튼

## 🚀 성능 최적화

### 이미지 처리

1. **클라이언트 사이드**
   - 이미지 크기 정보 추출
   - 미리보기 생성
   - 압축 (향후 구현)

2. **서버 사이드**
   - 메타데이터 추출
   - 공개 URL 생성
   - 캐시 헤더 설정

### 네트워크 최적화

1. **업로드 최적화**
   - FormData 사용
   - 진행률 추적
   - 에러 재시도 (향후 구현)

2. **캐싱**
   - Supabase Storage CDN
   - 브라우저 캐싱
   - Next.js 이미지 최적화

## 🧪 테스트 및 검증

### 통합 테스트

**`test-profile-photo-integration.js`**
- 컴포넌트 파일 존재 확인
- API 엔드포인트 검증
- TypeScript 컴파일 테스트
- 마이그레이션 파일 확인
- 보안 및 인증 검증

### E2E 테스트

**`test-profile-photo-e2e.js`**
- Playwright 기반 브라우저 테스트
- 전체 업로드 플로우 검증
- UI 상호작용 테스트
- 공개 페이지 동기화 확인

### 보안 및 성능 테스트

**`test-profile-photo-security.js`**
- API 보안 검증
- 파일 검증 테스트
- 성능 측정
- 메모리 누수 검사

## 🔄 배포 및 운영

### Supabase 마이그레이션

1. **데이터베이스 스키마 적용**
   ```sql
   -- supabase/migrations/20250720_add_artist_profile_photo_fields.sql 실행
   ```

2. **Storage Bucket 설정**
   ```sql
   -- supabase/migrations/20250720_setup_profile_storage.sql 실행
   ```

3. **RLS 정책 확인**
   - artists bucket 읽기/쓰기 정책
   - 사용자별 접근 제한

### 환경 변수

```env
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
```

### 프로덕션 배포

1. **Vercel 설정**
   - 환경 변수 설정
   - MIME 타입 헤더 구성
   - 빌드 검증

2. **Supabase 프로덕션 설정**
   - Storage bucket 생성
   - RLS 정책 적용
   - 백업 설정

## 🛠️ 개발 워크플로우

### 새 기능 개발

1. **타입 정의 업데이트** (`src/types/index.ts`)
2. **컴포넌트 구현** (`src/components/`)
3. **API 엔드포인트 구현** (`src/app/api/`)
4. **테스트 작성 및 실행**
5. **통합 테스트 실행**

### 테스트 실행

```bash
# 통합 테스트
node test-profile-photo-integration.js

# 보안 및 성능 테스트
node test-profile-photo-security.js

# E2E 테스트 (개발 서버 실행 후)
npm run dev
node test-profile-photo-e2e.js
```

### 코드 품질 확인

```bash
# TypeScript 컴파일 검사
npx tsc --noEmit

# ESLint 검사
npm run lint

# 빌드 테스트
npm run build
```

## 🚨 알려진 이슈 및 제한사항

### 현재 제한사항

1. **크롭 기능**
   - UI는 구현되었으나 실제 크롭 로직은 향후 구현 예정

2. **이미지 압축**
   - 클라이언트 사이드 압축 미구현
   - 서버 사이드 리사이징 미구현

3. **진행률 표시**
   - 실제 업로드 진행률이 아닌 시뮬레이션

### 보안 고려사항

1. **파일 검증**
   - 서버 사이드에서 실제 파일 내용 검증 필요
   - 악성 파일 스캔 권장

2. **업로드 제한**
   - 사용자별 업로드 속도 제한 권장
   - 일일 업로드 횟수 제한 고려

## 🔮 향후 개선 계획

### 1단계: 기본 기능 완성

- [ ] 실제 크롭 기능 구현
- [ ] 이미지 압축 및 리사이징
- [ ] 실시간 업로드 진행률

### 2단계: 성능 최적화

- [ ] 썸네일 자동 생성
- [ ] 다중 해상도 지원
- [ ] CDN 통합

### 3단계: 고급 기능

- [ ] 일괄 처리 기능
- [ ] 이미지 편집 기능
- [ ] AI 기반 자동 크롭

## 📞 지원 및 문의

개발 관련 문의나 이슈 발생 시:

1. **GitHub Issues**: 프로젝트 저장소의 Issues 탭
2. **개발 문서**: 이 문서의 관련 섹션 참조
3. **테스트 실행**: 문제 발생 시 관련 테스트 스크립트 실행

---

**마지막 업데이트**: 2025년 7월 20일  
**버전**: 1.0.0  
**상태**: 프로덕션 준비 완료