# 프로젝트 아키텍처

## 라우트 구조

### 공개 라우트
- `/` - 홈페이지 (피처드 콘텐츠)
- `/about` - 협동조합 소개
- `/archive` - 프로젝트 갤러리 (필터링 기능)
- `/artists` - 아티스트 디렉토리
- `/connect` - 연락처 및 멤버십 정보

### 인증 라우트
- `/login` - 멤버 로그인
- `/signup` - 사용자 등록
- `/register/pending` - 승인 대기 페이지
- `/register/rejected` - 거부 알림 페이지
- `/auth/callback` - Supabase 인증 콜백

### 보호된 라우트
- `/board` - 멤버 전용 게시판 (승인 필요)
- `/admin` - 관리자 패널 (관리자 권한 필요)
  - `/admin/members` - 멤버 관리 및 승인
  - `/admin/artists` - 아티스트 프로필 관리
  - `/admin/posts` - 게시글 관리
- `/mypage` - 개인 대시보드 (승인 필요)
  - `/mypage/profile` - 개인 프로필 편집
  - `/mypage/artist` - 아티스트 프로필 관리

## 컴포넌트 구조
- **Layout**: Navigation, Footer, Hero 섹션
- **Content**: ArticleCard, FeaturedProjects, FeaturedArtists
- **Media**: OptimizedImage, YouTubeEmbed, Lightbox
- **Interactive**: TicketingCard (외부 링크)
- **Board**: PostList, CreatePostForm, CommentSection
- **Mypage**: MypageLayout, MypageNavigation, PermissionCheck
- **Performance**: AdaptiveParticles, PerformanceMonitor

## 데이터베이스 스키마 (Supabase)
- `member_profiles` - 사용자 프로필 및 승인 상태
- `posts` - 게시판 게시글 (카테고리: 공지, 잡담, 홍보, 건의)
- `comments` - 중첩 댓글
- `artists` - 아티스트 프로필 데이터 (JSON에서 이관)