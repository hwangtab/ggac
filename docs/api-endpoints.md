# API 엔드포인트 명세서

경기아트콜렉티브 웹사이트의 REST API 엔드포인트 문서입니다.

## 📋 목차

- [인증 API](#인증-api)
- [사용자 관리 API](#사용자-관리-api)
- [게시글 API](#게시글-api)
- [댓글 API](#댓글-api)
- [첨부파일 API](#첨부파일-api)
- [알림 API](#알림-api)
- [관리자 API](#관리자-api)
- [미디어 API](#미디어-api)

---

## 🔐 인증 API

### POST `/api/auth/verify-session`
현재 세션의 유효성을 검증합니다.

**Headers:**
```
Authorization: Bearer <token>
```

**Response:**
```typescript
{
  success: boolean
  data: {
    user: {
      id: string
      email: string
      display_name: string
      is_admin: boolean
      is_artist: boolean
    }
    session: {
      expires_at: string
      created_at: string
    }
  }
  message?: string
}
```

---

## 👥 사용자 관리 API

### GET `/api/mypage/activity`
사용자의 활동 내역을 조회합니다.

**Query Parameters:**
- `page`: 페이지 번호 (기본값: 1)
- `limit`: 페이지당 항목 수 (기본값: 20)
- `type`: 활동 타입 필터 (`post`, `comment`, `like`)

**Response:**
```typescript
{
  success: true
  data: {
    activities: ActivityItem[]
    pagination: {
      current_page: number
      total_pages: number
      total_items: number
      has_next: boolean
      has_prev: boolean
    }
  }
  message: string
}
```

### GET `/api/mypage/artist`
아티스트 정보를 조회합니다.

**Response:**
```typescript
{
  success: true
  data: {
    artist: {
      id: string
      name: string
      bio: string
      photo_url?: string
      genre: string[]
      social_links: {
        website?: string
        instagram?: string
        youtube?: string
      }
    }
  }
}
```

### PUT `/api/mypage/artist`
아티스트 정보를 업데이트합니다.

**Request Body:**
```typescript
{
  name: string
  bio: string
  genre: string[]
  social_links: {
    website?: string
    instagram?: string
    youtube?: string
  }
}
```

---

## 📝 게시글 API

### GET `/api/posts`
게시글 목록을 조회합니다.

**Query Parameters:**
- `page`: 페이지 번호 (기본값: 1)
- `limit`: 페이지당 항목 수 (기본값: 20)
- `category`: 카테고리 필터
- `author_id`: 작성자 ID 필터
- `search`: 검색어
- `sort`: 정렬 방식 (`created_at`, `updated_at`, `like_count`, `view_count`)
- `order`: 정렬 순서 (`asc`, `desc`)

**Response:**
```typescript
{
  success: true
  data: {
    posts: Post[]
    pagination: PaginationInfo
    filters: {
      category?: string
      author_id?: string
      search?: string
    }
  }
  meta: {
    timestamp: string
    requestId?: string
    version: string
  }
}
```

### GET `/api/posts/[id]`
특정 게시글을 조회합니다.

**Response:**
```typescript
{
  success: true
  data: {
    post: {
      id: string
      title: string
      content: string
      content_format: 'markdown' | 'html'
      category: string
      author: {
        display_name: string
        email: string
      }
      like_count: number
      view_count: number
      comment_count: number
      attachments: PostAttachment[]
      created_at: string
      updated_at: string
    }
  }
}
```

### POST `/api/posts`
새 게시글을 작성합니다.

**Request Body:**
```typescript
{
  title: string
  content: string
  content_format?: 'markdown' | 'html'
  category: string
  attachment_ids?: string[]
}
```

**Response:**
```typescript
{
  success: true
  data: {
    post: Post
  }
  message: '게시글이 성공적으로 작성되었습니다.'
}
```

### PUT `/api/posts/[id]`
게시글을 수정합니다.

**Request Body:**
```typescript
{
  title?: string
  content?: string
  category?: string
}
```

### DELETE `/api/posts/[id]`
게시글을 삭제합니다.

**Response:**
```typescript
{
  success: true
  message: '게시글이 성공적으로 삭제되었습니다.'
}
```

### POST `/api/posts/[id]/likes`
게시글 좋아요를 토글합니다.

**Response:**
```typescript
{
  success: true
  data: {
    liked: boolean
    like_count: number
  }
  message: string
}
```

### PUT `/api/posts/[id]/view`
게시글 조회수를 증가시킵니다.

**Response:**
```typescript
{
  success: true
  data: {
    view_count: number
  }
}
```

---

## 💬 댓글 API

### POST `/api/comments/[id]/like`
댓글 좋아요를 토글합니다.

**Response:**
```typescript
{
  success: true
  data: {
    liked: boolean
    like_count: number
  }
  message: string
}
```

---

## 📎 첨부파일 API

### GET `/api/posts/[id]/attachments`
게시글의 첨부파일 목록을 조회합니다.

**Response:**
```typescript
{
  success: true
  data: {
    attachments: PostAttachment[]
  }
}
```

### PUT `/api/posts/[id]/attachments/[attachmentId]`
첨부파일 정보를 수정합니다.

**Request Body:**
```typescript
{
  alt_text?: string
  is_primary?: boolean
}
```

### DELETE `/api/posts/[id]/attachments/[attachmentId]`
첨부파일을 삭제합니다.

**Response:**
```typescript
{
  success: true
  message: '첨부파일이 성공적으로 삭제되었습니다.'
}
```

---

## 🔔 알림 API

### GET `/api/notifications`
알림 목록을 조회합니다.

**Query Parameters:**
- `page`: 페이지 번호
- `limit`: 페이지당 항목 수
- `unread_only`: 읽지 않은 알림만 조회 (true/false)

**Response:**
```typescript
{
  success: true
  data: {
    notifications: Notification[]
    pagination: PaginationInfo
    unread_count: number
  }
}
```

### PUT `/api/notifications/[id]`
특정 알림을 읽음 처리합니다.

**Response:**
```typescript
{
  success: true
  data: {
    notification: Notification
  }
  message: '알림이 읽음 처리되었습니다.'
}
```

### PUT `/api/notifications/bulk`
여러 알림을 일괄 처리합니다.

**Request Body:**
```typescript
{
  notification_ids: string[]
  action: 'read' | 'delete'
}
```

### GET `/api/notifications/stats`
알림 통계를 조회합니다.

**Response:**
```typescript
{
  success: true
  data: {
    total_count: number
    unread_count: number
    today_count: number
  }
}
```

---

## 🛡️ 관리자 API

### GET `/api/admin/stats`
관리자 대시보드 통계를 조회합니다.

**Response:**
```typescript
{
  success: true
  data: {
    stats: {
      totalMembers: number
      pendingApprovals: number
      totalPosts: number
      totalArtists: number
      monthlyGrowth: {
        members: number
        posts: number
      }
    }
  }
}
```

### GET `/api/admin/members`
회원 목록을 관리자 권한으로 조회합니다.

**Query Parameters:**
- `page`: 페이지 번호
- `limit`: 페이지당 항목 수
- `status`: 회원 상태 필터 (`pending`, `approved`, `rejected`)
- `search`: 검색어 (이름, 이메일)
- `sort`: 정렬 기준
- `order`: 정렬 순서

**Response:**
```typescript
{
  success: true
  data: {
    members: Member[]
    pagination: PaginationInfo
    filters: FilterInfo
    statistics: {
      total: number
      pending: number
      approved: number
      rejected: number
    }
  }
}
```

### PUT `/api/admin/members/[id]`
회원 상태를 변경합니다.

**Request Body:**
```typescript
{
  action: 'approve' | 'reject' | 'activate' | 'deactivate' | 'suspend' | 'unsuspend'
  reason?: string
}
```

### GET `/api/admin/posts`
모든 게시글을 관리자 권한으로 조회합니다.

### GET `/api/admin/artists`
아티스트 목록을 관리자 권한으로 조회합니다.

### POST `/api/admin/reports/generate`
관리자 리포트를 생성합니다.

**Request Body:**
```typescript
{
  type: 'members' | 'posts' | 'activities' | 'comprehensive'
  date_range: {
    start: string  // ISO date
    end: string    // ISO date
  }
  format: 'json' | 'csv' | 'pdf'
  include_details?: boolean
}
```

---

## 🖼️ 미디어 API

### POST `/api/media/upload`
파일을 업로드합니다.

**Request Body:** `multipart/form-data`
- `file`: 업로드할 파일
- `bucket`: Storage 버킷명 (선택)
- `folder`: 폴더 경로 (선택)

**Response:**
```typescript
{
  success: true
  data: {
    file: {
      id: string
      name: string
      size: number
      type: string
      url: string
      public_url: string
      metadata: {
        width?: number  // 이미지인 경우
        height?: number // 이미지인 경우
        uploaded_at: string
      }
    }
  }
  message: '파일이 성공적으로 업로드되었습니다.'
}
```

### GET `/api/images`
이미지 목록을 조회합니다.

**Query Parameters:**
- `folder`: 폴더 경로
- `limit`: 조회 개수
- `type`: 이미지 타입 필터

### GET `/api/images/proxy`
외부 이미지를 프록시합니다.

**Query Parameters:**
- `url`: 프록시할 이미지 URL

---

## 🔗 기타 API

### GET `/api/link-preview`
URL의 메타데이터를 추출합니다.

**Query Parameters:**
- `url`: 미리보기할 URL

**Response:**
```typescript
{
  success: true
  data: {
    title?: string
    description?: string
    image?: string
    site_name?: string
    favicon?: string
    url: string
  }
}
```

### POST `/api/security/csp-report`
CSP 위반 리포트를 수집합니다.

### GET `/api/settings`
시스템 설정을 조회합니다.

### PUT `/api/settings`
시스템 설정을 업데이트합니다.

---

## 📊 공통 응답 형식

### 성공 응답
```typescript
{
  success: true
  data: any
  message?: string
  meta?: {
    timestamp: string
    requestId?: string
    version: string
  }
}
```

### 오류 응답
```typescript
{
  success: false
  error: {
    code: string
    message: string
    details?: any
  }
  meta?: {
    timestamp: string
    requestId?: string
    version: string
  }
}
```

### 페이지네이션 정보
```typescript
interface PaginationInfo {
  current_page: number
  total_pages: number
  total_items: number
  items_per_page: number
  has_next: boolean
  has_prev: boolean
}
```

---

## 🔒 인증 및 권한

### 인증 방식
- **Session 기반**: Supabase Auth를 통한 세션 관리
- **Bearer Token**: API 호출 시 Authorization 헤더 사용

### 권한 레벨
- **Public**: 인증 없이 접근 가능
- **User**: 로그인한 사용자만 접근
- **Author**: 컨텐츠 작성자만 접근
- **Admin**: 관리자만 접근

### 에러 코드
- `400`: Bad Request - 잘못된 요청
- `401`: Unauthorized - 인증 필요
- `403`: Forbidden - 권한 없음
- `404`: Not Found - 리소스 없음
- `422`: Unprocessable Entity - 유효성 검사 실패
- `500`: Internal Server Error - 서버 오류

---

*이 API 문서는 지속적으로 업데이트되며, 새로운 엔드포인트가 추가되면 해당 문서도 함께 작성됩니다.*