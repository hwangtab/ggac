# 마이페이지 시스템 구현 계획서

## 1. 개요

경기아트콜렉티브 웹사이트에 마이페이지 시스템을 구축하여 아티스트가 자신의
아티스트 상세페이지를 관리할 수 있도록 한다. 이 시스템은 기존 member_profiles
테이블을 확장하여 구현하며, 조합원 승인 시 관리자가 직접 아티스트 ID를 할당하는
방식으로 운영된다.

## 2. 시스템 아키텍처

### 2.1 데이터베이스 설계

#### 2.1.1 member_profiles 테이블 확장

현재 member_profiles 테이블에 다음 컬럼을 추가한다:

```sql
-- 아티스트 관련 컬럼 추가
ALTER TABLE public.member_profiles
ADD COLUMN artist_id TEXT REFERENCES public.artists(legacy_id),
ADD COLUMN is_artist BOOLEAN DEFAULT false,
ADD COLUMN artist_role TEXT DEFAULT 'owner' CHECK (artist_role IN ('owner', 'manager', 'collaborator'));
```

#### 2.1.2 artists 테이블 생성 (JSON 데이터 마이그레이션용)

기존 JSON 데이터를 데이터베이스로 이관하기 위한 테이블:

```sql
CREATE TABLE public.artists (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  legacy_id TEXT UNIQUE NOT NULL, -- 기존 artist-001 형태 ID
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  category TEXT[],
  profile_photo_url TEXT,
  one_liner TEXT,
  bio TEXT,
  template_type TEXT DEFAULT '콜라주형' CHECK (template_type IN ('미니멀형', '콜라주형')),
  portfolio_links JSONB,
  youtube_videos JSONB,
  contact TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

#### 2.1.3 RLS 정책 설정

아티스트 정보 수정 권한 제어를 위한 정책:

```sql
-- artists 테이블 RLS 활성화
ALTER TABLE public.artists ENABLE ROW LEVEL SECURITY;

-- 모든 사용자가 아티스트 정보 조회 가능
CREATE POLICY "Anyone can view artists" ON public.artists
    FOR SELECT USING (true);

-- 연결된 멤버만 해당 아티스트 정보 수정 가능
CREATE POLICY "Members can update their artist profile" ON public.artists
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM public.member_profiles mp
            WHERE mp.id = auth.uid()
            AND mp.artist_id = artists.legacy_id
            AND mp.is_artist = true
            AND mp.is_active = true
        )
    );

-- 관리자는 모든 아티스트 정보 수정 가능
CREATE POLICY "Admins can update all artists" ON public.artists
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM public.member_profiles mp
            WHERE mp.id = auth.uid()
            AND mp.is_admin = true
            AND mp.is_active = true
        )
    );
```

### 2.2 아티스트 승인 프로세스

#### 2.2.1 조합원 승인 시 아티스트 ID 할당

1. 관리자가 Supabase 대시보드에서 member_profiles 테이블에 접근
2. 승인할 조합원의 `registration_status`를 'approved'로 변경
3. 해당 조합원이 아티스트인 경우:
   - `is_artist`를 `true`로 설정
   - `artist_id`에 해당하는 아티스트 ID 입력 (예: 'artist-001')
   - `artist_role`을 'owner'로 설정

#### 2.2.2 아티스트 ID 매핑 테이블

관리자 참조용 아티스트 ID 목록:

| Legacy ID  | Artist Name  | Slug            | Contact                |
| ---------- | ------------ | --------------- | ---------------------- |
| artist-001 | 사바하       | sabbaha         | sabbaha.doom@gmail.com |
| artist-002 | Simon DM     | simon-dm        | lizard1022@naver.com   |
| artist-003 | 로잘린송     | rosalyn-song    | durisongsong@gmail.com |
| artist-004 | themilliways | themilliways    | me@jtjoo.com           |
| artist-005 | 유동혁       | yoo-dong-hyuk   | amuro4@naver.com       |
| artist-006 | 최기타       | choi-guitar     | choisguitar@naver.com  |
| artist-007 | 남수         | namsu           | -                      |
| artist-008 | 황경하       | hwang-gyeong-ha | hwangtab@gmail.com     |
| artist-009 | Zsthyger     | acmein          | eutaxmusic@gmail.com   |
| artist-010 | 장현호       | jang-hyun-ho    | -                      |
| artist-011 | ANAZAO       | anazao          | -                      |
| artist-012 | 희우         | heewoo          | -                      |

## 3. 마이페이지 구조 설계

### 3.1 라우트 구조

```
/mypage
├── page.tsx                 # 메인 마이페이지 (대시보드)
├── profile/
│   ├── page.tsx            # 개인 프로필 편집
│   └── components/
│       ├── ProfileEditForm.tsx
│       ├── PersonalInfo.tsx
│       ├── CooperativeInfo.tsx
│       └── AccountInfo.tsx
├── artist/
│   ├── page.tsx            # 아티스트 프로필 관리 (권한 있는 사용자만)
│   └── components/
│       ├── ArtistEditForm.tsx
│       ├── BasicInfo.tsx
│       ├── BioEditor.tsx
│       ├── MediaManager.tsx
│       ├── PortfolioLinks.tsx
│       └── YoutubeVideos.tsx
└── components/
    ├── MypageLayout.tsx
    ├── MypageNavigation.tsx
    ├── PermissionCheck.tsx
    └── LoadingStates.tsx
```

### 3.2 컴포넌트 설계

#### 3.2.1 MypageLayout 컴포넌트

```typescript
interface MypageLayoutProps {
  children: React.ReactNode
  title: string
  description?: string
}

const MypageLayout: React.FC<MypageLayoutProps> = ({
  children,
  title,
  description
}) => {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container-custom py-8">
        <div className="max-w-6xl mx-auto">
          <div className="grid lg:grid-cols-4 gap-8">
            <div className="lg:col-span-1">
              <MypageNavigation />
            </div>
            <div className="lg:col-span-3">
              <div className="bg-white rounded-lg shadow-sm p-6">
                <div className="mb-8">
                  <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
                  {description && (
                    <p className="text-gray-600 mt-2">{description}</p>
                  )}
                </div>
                {children}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
```

#### 3.2.2 PermissionCheck 컴포넌트

```typescript
interface PermissionCheckProps {
  children: React.ReactNode
  requiredPermission: 'member' | 'artist' | 'admin'
  fallback?: React.ReactNode
}

const PermissionCheck: React.FC<PermissionCheckProps> = ({
  children,
  requiredPermission,
  fallback
}) => {
  const { user, profile, loading } = useAuth()

  if (loading) return <LoadingSpinner />

  if (!user || !profile) {
    return fallback || <AccessDenied />
  }

  switch (requiredPermission) {
    case 'member':
      if (profile.registration_status !== 'approved' || !profile.is_active) {
        return fallback || <AccessDenied />
      }
      break
    case 'artist':
      if (!profile.is_artist || !profile.artist_id) {
        return fallback || <ArtistAccessDenied />
      }
      break
    case 'admin':
      if (!profile.is_admin) {
        return fallback || <AdminAccessDenied />
      }
      break
  }

  return <>{children}</>
}
```

## 4. 기능별 상세 설계

### 4.1 개인 프로필 관리

#### 4.1.1 편집 가능한 필드

- **기본 정보**: display_name, phone_number, birth_date
- **조합 정보**: monthly_fee, bank_name, account_number, account_holder
- **연락처**: email (읽기 전용)

#### 4.1.2 ProfileEditForm 컴포넌트

```typescript
interface ProfileEditFormProps {
  profile: MemberProfile
  onUpdate: (updates: Partial<MemberProfile>) => Promise<void>
}

const ProfileEditForm: React.FC<ProfileEditFormProps> = ({
  profile,
  onUpdate
}) => {
  const [formData, setFormData] = useState({
    display_name: profile.display_name,
    phone_number: profile.phone_number,
    birth_date: profile.birth_date,
    monthly_fee: profile.monthly_fee,
    bank_name: profile.bank_name,
    account_number: profile.account_number,
    account_holder: profile.account_holder
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    await onUpdate(formData)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <PersonalInfo
        data={formData}
        onChange={setFormData}
      />
      <CooperativeInfo
        data={formData}
        onChange={setFormData}
      />
      <AccountInfo
        data={formData}
        onChange={setFormData}
      />
      <div className="flex justify-end">
        <button
          type="submit"
          className="btn-primary"
        >
          저장
        </button>
      </div>
    </form>
  )
}
```

### 4.2 아티스트 프로필 관리

#### 4.2.1 편집 가능한 필드

- **기본 정보**: name, category, one_liner, template_type
- **상세 정보**: bio (마크다운 지원)
- **미디어**: profile_photo_url (업로드 기능)
- **포트폴리오**: portfolio_links (동적 추가/제거)
- **동영상**: youtube_videos (동적 추가/제거)
- **연락처**: contact

#### 4.2.2 ArtistEditForm 컴포넌트

```typescript
interface ArtistEditFormProps {
  artist: Artist
  onUpdate: (updates: Partial<Artist>) => Promise<void>
}

const ArtistEditForm: React.FC<ArtistEditFormProps> = ({
  artist,
  onUpdate
}) => {
  const [formData, setFormData] = useState({
    name: artist.name,
    category: artist.category,
    one_liner: artist.one_liner,
    bio: artist.bio,
    template_type: artist.template_type,
    profile_photo_url: artist.profile_photo_url,
    portfolio_links: artist.portfolio_links || [],
    youtube_videos: artist.youtube_videos || [],
    contact: artist.contact
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    await onUpdate(formData)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      <BasicInfo
        data={formData}
        onChange={setFormData}
      />
      <BioEditor
        value={formData.bio}
        onChange={(bio) => setFormData({ ...formData, bio })}
      />
      <MediaManager
        currentImage={formData.profile_photo_url}
        onImageUpdate={(profile_photo_url) =>
          setFormData({ ...formData, profile_photo_url })
        }
      />
      <PortfolioLinks
        links={formData.portfolio_links}
        onChange={(portfolio_links) =>
          setFormData({ ...formData, portfolio_links })
        }
      />
      <YoutubeVideos
        videos={formData.youtube_videos}
        onChange={(youtube_videos) =>
          setFormData({ ...formData, youtube_videos })
        }
      />
      <div className="flex justify-end">
        <button
          type="submit"
          className="btn-primary"
        >
          저장
        </button>
      </div>
    </form>
  )
}
```

## 5. 타입 정의 업데이트

### 5.1 MemberProfile 인터페이스 확장

```typescript
export interface MemberProfile {
  // 기존 필드들...
  id: string
  display_name: string
  email: string
  phone_number: string
  birth_date: string
  real_name: string
  monthly_fee: number
  bank_name: string
  account_number: string
  account_holder: string
  registration_status: 'pending' | 'approved' | 'rejected'
  is_active: boolean
  is_admin: boolean
  is_member: boolean
  created_at: string
  updated_at: string
  approved_at?: string
  approved_by?: string

  // 새로 추가되는 필드들
  artist_id?: string | null
  is_artist: boolean
  artist_role: 'owner' | 'manager' | 'collaborator'
}
```

### 5.2 Artist 인터페이스 확장

```typescript
export interface Artist {
  // 기존 필드들...
  id: string
  legacy_id: string // 기존 artist-001 형태 ID
  slug: string
  name: string
  category: string | string[]
  profile_photo_url: string | null
  one_liner: string
  bio: string
  template_type: 'minimal' | 'collage' | '미니멀형' | '콜라주형'
  portfolio_links: PortfolioLink[] | null
  youtube_videos: YouTubeVideo[] | null
  contact: string | null
  created_at: string
  updated_at: string

  // 연결된 멤버 정보 (조인용)
  members?: {
    id: string
    display_name: string
    artist_role: string
  }[]
}
```

## 6. API 엔드포인트 설계

### 6.1 프로필 관리 API

```typescript
// /api/mypage/profile
export async function GET(request: NextRequest) {
  // 현재 사용자 프로필 조회
}

export async function PATCH(request: NextRequest) {
  // 프로필 정보 업데이트
}

// /api/mypage/artist
export async function GET(request: NextRequest) {
  // 연결된 아티스트 정보 조회
}

export async function PATCH(request: NextRequest) {
  // 아티스트 정보 업데이트
}
```

### 6.2 미디어 업로드 API

```typescript
// /api/mypage/upload
export async function POST(request: NextRequest) {
  // 이미지 파일 업로드 (Supabase Storage)
  // WebP 변환 및 최적화
  // 권한 검증
}
```

## 7. 보안 고려사항

### 7.1 권한 검증

- 모든 API 요청에서 사용자 인증 상태 확인
- 아티스트 정보 수정 시 연결된 멤버인지 확인
- 파일 업로드 시 파일 타입 및 크기 제한

### 7.2 데이터 유효성 검사

- 입력 데이터 sanitization
- 마크다운 콘텐츠 XSS 방지
- 이미지 업로드 시 악성 파일 검증

### 7.3 RLS 정책

- 멤버는 자신의 프로필만 수정 가능
- 아티스트 정보는 연결된 멤버만 수정 가능
- 관리자는 모든 데이터 접근 가능

## 8. 구현 단계

### Phase 1: 데이터베이스 설정

1. member_profiles 테이블 확장 마이그레이션
2. artists 테이블 생성 및 JSON 데이터 이관
3. RLS 정책 설정
4. 타입 정의 업데이트

### Phase 2: 기본 마이페이지 구조

1. 마이페이지 라우트 설정
2. 기본 레이아웃 및 네비게이션
3. 권한 체크 시스템
4. 프로필 조회 API

### Phase 3: 개인 프로필 관리

1. 개인 프로필 편집 폼
2. 프로필 업데이트 API
3. 유효성 검사 및 에러 처리
4. 성공/실패 알림

### Phase 4: 아티스트 프로필 관리

1. 아티스트 정보 편집 폼
2. 아티스트 업데이트 API
3. 마크다운 에디터
4. 포트폴리오 및 동영상 관리

### Phase 5: 미디어 관리

1. 이미지 업로드 기능
2. Supabase Storage 연동
3. 이미지 최적화 (WebP 변환)
4. 미디어 파일 관리

### Phase 6: 고급 기능

1. 활동 로그 시스템
2. 변경 이력 추적
3. 알림 시스템
4. 배치 작업 (JSON → DB 동기화)

## 9. 테스트 계획

### 9.1 단위 테스트

- 권한 체크 로직
- 데이터 유효성 검사
- API 엔드포인트

### 9.2 통합 테스트

- 사용자 플로우 테스트
- 데이터베이스 연동 테스트
- 파일 업로드 테스트

### 9.3 사용자 테스트

- 아티스트 피드백 수집
- 관리자 워크플로우 테스트
- 모바일 환경 테스트

## 10. 배포 및 운영

### 10.1 배포 준비사항

- 환경 변수 설정
- Supabase Storage 버킷 생성
- RLS 정책 적용 확인

### 10.2 모니터링

- 사용자 활동 로그
- 에러 로그 모니터링
- 성능 지표 추적

### 10.3 유지보수

- 정기적인 데이터베이스 백업
- 이미지 파일 정리
- 사용자 피드백 반영

---

이 문서는 마이페이지 시스템의 전체적인 구현 계획을 담고 있으며, 개발 과정에서
필요에 따라 업데이트될 수 있습니다.
