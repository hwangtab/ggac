# 컴포넌트 API 문서

이 문서는 프로젝트의 주요 컴포넌트들의 Props, 사용법, 예제를 설명합니다.

## 📋 목차

- [OptimizedImage](#optimizedimage)
- [MediaManager](#mediamanager)
- [ImageCropModal](#imagecropmodal)
- [PostAttachmentViewer](#postattachmentviewer)
- [CreatePostForm](#createpostform)
- [AdminLayout](#adminlayout)

---

## OptimizedImage

최적화된 이미지 컴포넌트로, 다양한 포맷 fallback과 로딩 상태를 제공합니다.

### Props

| 속성                  | 타입                     | 기본값  | 필수 | 설명                  |
| --------------------- | ------------------------ | ------- | ---- | --------------------- |
| `src`                 | `string`                 | -       | ✅   | 이미지 URL            |
| `alt`                 | `string`                 | -       | ✅   | 대체 텍스트           |
| `width`               | `number`                 | -       | -    | 이미지 너비           |
| `height`              | `number`                 | -       | -    | 이미지 높이           |
| `className`           | `string`                 | `''`    | -    | 추가 CSS 클래스       |
| `priority`            | `boolean`                | `false` | -    | 우선 로딩 여부        |
| `fill`                | `boolean`                | `false` | -    | 부모 요소 채우기      |
| `sizes`               | `string`                 | -       | -    | 반응형 이미지 크기    |
| `quality`             | `number`                 | `80`    | -    | 이미지 품질 (1-100)   |
| `fallbackText`        | `string`                 | -       | -    | 오류 시 표시할 텍스트 |
| `preserveAspectRatio` | `boolean`                | `false` | -    | 종횡비 유지           |
| `onLoadStart`         | `() => void`             | -       | -    | 로딩 시작 콜백        |
| `onLoad`              | `() => void`             | -       | -    | 로딩 완료 콜백        |
| `onError`             | `(error: Error) => void` | -       | -    | 에러 발생 콜백        |
| `suppressSkeleton`    | `boolean`                | `false` | -    | 스켈레톤 UI 비활성화  |

### 사용 예제

```tsx
// 기본 사용법
<OptimizedImage
  src="/images/artist-photo.jpg"
  alt="아티스트 사진"
  width={300}
  height={300}
/>

// 반응형 이미지
<OptimizedImage
  src="/images/banner.jpg"
  alt="배너 이미지"
  fill
  sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
/>

// 오류 처리가 포함된 사용법
<OptimizedImage
  src="/images/profile.jpg"
  alt="프로필 사진"
  width={150}
  height={150}
  fallbackText="프로필"
  onError={(error) => console.error('이미지 로딩 실패:', error)}
/>
```

---

## MediaManager

파일 업로드, 관리, 크롭 기능을 제공하는 종합 미디어 관리 컴포넌트입니다.

### Props

| 속성               | 타입                           | 기본값          | 필수 | 설명             |
| ------------------ | ------------------------------ | --------------- | ---- | ---------------- |
| `id`               | `string`                       | -               | ✅   | 컴포넌트 고유 ID |
| `config`           | `MediaManagerConfig`           | -               | ✅   | 미디어 관리 설정 |
| `existingFiles`    | `MediaFile[]`                  | `[]`            | -    | 기존 파일 목록   |
| `onUploadComplete` | `(files: MediaFile[]) => void` | -               | -    | 업로드 완료 콜백 |
| `onUploadError`    | `(error: string) => void`      | -               | -    | 업로드 오류 콜백 |
| `onFileDelete`     | `(fileId: string) => void`     | -               | -    | 파일 삭제 콜백   |
| `mode`             | `'single' \| 'multiple'`       | `'multiple'`    | -    | 업로드 모드      |
| `bucket`           | `string`                       | `'attachments'` | -    | Storage 버킷명   |
| `className`        | `string`                       | `''`            | -    | 추가 CSS 클래스  |
| `disabled`         | `boolean`                      | `false`         | -    | 비활성화 상태    |
| `enableCrop`       | `boolean`                      | `false`         | -    | 크롭 기능 활성화 |
| `cropSettings`     | `ImageCropSettings`            | -               | -    | 크롭 설정        |

### MediaManagerConfig 인터페이스

```typescript
interface MediaManagerConfig {
  allowed_types: string[] // 허용 파일 타입
  max_file_size: number // 최대 파일 크기 (bytes)
  max_files?: number // 최대 파일 수
  enable_preview?: boolean // 미리보기 활성화
}
```

### 사용 예제

```tsx
// 기본 이미지 업로드
<MediaManager
  id="profile-photo"
  config={{
    allowed_types: ['image/jpeg', 'image/png', 'image/webp'],
    max_file_size: 5 * 1024 * 1024, // 5MB
    max_files: 1
  }}
  mode="single"
  enableCrop
  onUploadComplete={(files) => setProfilePhoto(files[0])}
  onUploadError={(error) => alert(error)}
/>

// 게시글 첨부파일 관리
<MediaManager
  id="post-attachments"
  config={{
    allowed_types: ['image/*', 'application/pdf', 'text/plain'],
    max_file_size: 10 * 1024 * 1024, // 10MB
    max_files: 5,
    enable_preview: true
  }}
  existingFiles={existingAttachments}
  onUploadComplete={handleAttachmentUpload}
  onFileDelete={handleAttachmentDelete}
/>
```

---

## ImageCropModal

이미지 크롭 기능을 제공하는 모달 컴포넌트입니다.

### Props

| 속성          | 타입                                   | 기본값 | 필수 | 설명                       |
| ------------- | -------------------------------------- | ------ | ---- | -------------------------- |
| `isOpen`      | `boolean`                              | -      | ✅   | 모달 열림 상태             |
| `imageUrl`    | `string`                               | -      | ✅   | 크롭할 이미지 URL          |
| `imageName`   | `string`                               | -      | ✅   | 이미지 파일명              |
| `onClose`     | `() => void`                           | -      | ✅   | 모달 닫기 콜백             |
| `onCrop`      | `(blob: Blob, area: CropArea) => void` | -      | ✅   | 크롭 완료 콜백             |
| `aspectRatio` | `number`                               | -      | -    | 고정 종횡비 (width/height) |

### CropArea 인터페이스

```typescript
interface CropArea {
  x: number // X 좌표
  y: number // Y 좌표
  width: number // 너비
  height: number // 높이
}
```

### 사용 예제

```tsx
const [cropModal, setCropModal] = useState({
  isOpen: false,
  imageUrl: '',
  imageName: '',
})

const handleCropComplete = (croppedBlob: Blob, cropArea: CropArea) => {
  // 크롭된 이미지 처리
  const file = new File([croppedBlob], 'cropped-image.jpg', {
    type: 'image/jpeg',
  })
  uploadCroppedImage(file)
  setCropModal({ isOpen: false, imageUrl: '', imageName: '' })
}

;<ImageCropModal
  isOpen={cropModal.isOpen}
  imageUrl={cropModal.imageUrl}
  imageName={cropModal.imageName}
  onClose={() => setCropModal({ isOpen: false, imageUrl: '', imageName: '' })}
  onCrop={handleCropComplete}
  aspectRatio={1} // 정사각형 크롭
/>
```

---

## PostAttachmentViewer

게시글의 첨부파일을 표시하고 관리하는 컴포넌트입니다.

### Props

| 속성                 | 타입                                   | 기본값   | 필수 | 설명                   |
| -------------------- | -------------------------------------- | -------- | ---- | ---------------------- |
| `attachments`        | `PostAttachment[]`                     | -        | ✅   | 첨부파일 목록          |
| `postId`             | `string`                               | -        | ✅   | 게시글 ID              |
| `isAuthor`           | `boolean`                              | `false`  | -    | 작성자 여부            |
| `isAdmin`            | `boolean`                              | `false`  | -    | 관리자 여부            |
| `onAttachmentUpdate` | `(attachment: PostAttachment) => void` | -        | -    | 첨부파일 업데이트 콜백 |
| `onAttachmentDelete` | `(attachmentId: string) => void`       | -        | -    | 첨부파일 삭제 콜백     |
| `showActions`        | `boolean`                              | `false`  | -    | 액션 버튼 표시         |
| `layout`             | `'grid' \| 'list'`                     | `'grid'` | -    | 레이아웃 모드          |
| `className`          | `string`                               | `''`     | -    | 추가 CSS 클래스        |

### 사용 예제

```tsx
// 기본 첨부파일 표시
<PostAttachmentViewer
  attachments={post.attachments}
  postId={post.id}
/>

// 작성자/관리자용 (편집 가능)
<PostAttachmentViewer
  attachments={post.attachments}
  postId={post.id}
  isAuthor={currentUser.id === post.author_id}
  isAdmin={currentUser.is_admin}
  showActions
  onAttachmentUpdate={handleAttachmentUpdate}
  onAttachmentDelete={handleAttachmentDelete}
  layout="list"
/>
```

---

## CreatePostForm

게시글 작성 폼 컴포넌트입니다.

### Props

| 속성                  | 타입                   | 기본값  | 필수 | 설명                    |
| --------------------- | ---------------------- | ------- | ---- | ----------------------- |
| `authorId`            | `string`               | -       | ✅   | 작성자 ID               |
| `onNewPost`           | `(post: Post) => void` | -       | ✅   | 게시글 생성 콜백        |
| `showSuccessRedirect` | `boolean`              | `false` | -    | 성공 시 리다이렉트 표시 |

### 사용 예제

```tsx
<CreatePostForm
  authorId={currentUser.id}
  onNewPost={newPost => {
    setPosts(prev => [newPost, ...prev])
    router.push(`/board/${newPost.id}`)
  }}
  showSuccessRedirect
/>
```

---

## AdminLayout

관리자 페이지 레이아웃 컴포넌트입니다.

### Props

| 속성       | 타입        | 기본값 | 필수 | 설명               |
| ---------- | ----------- | ------ | ---- | ------------------ |
| `children` | `ReactNode` | -      | ✅   | 자식 컴포넌트      |
| `title`    | `string`    | -      | -    | 페이지 제목        |
| `subtitle` | `string`    | -      | -    | 페이지 부제목      |
| `actions`  | `ReactNode` | -      | -    | 페이지 액션 버튼들 |

### 사용 예제

```tsx
<AdminLayout
  title="회원 관리"
  subtitle="협동조합 회원들을 관리하고 승인 처리를 수행합니다"
  actions={<button className="btn-primary">새 회원 초대</button>}
>
  <MemberList />
</AdminLayout>
```

---

## 📝 개발 가이드라인

### TypeScript 사용 권장사항

1. **Props 인터페이스 정의**: 모든 컴포넌트는 명확한 Props 타입을 정의해야
   합니다.
2. **Generic 활용**: 재사용 가능한 컴포넌트는 Generic을 활용하여 타입 안전성을
   보장합니다.
3. **Optional Props**: 선택적 속성은 `?`를 사용하고 기본값을 명시합니다.

### 컴포넌트 설계 원칙

1. **Single Responsibility**: 하나의 컴포넌트는 하나의 책임만 가집니다.
2. **Props Drilling 방지**: Context API나 상태 관리 라이브러리를 활용합니다.
3. **성능 최적화**: `React.memo`, `useMemo`, `useCallback`을 적절히 활용합니다.

### 네이밍 컨벤션

- **컴포넌트**: PascalCase (`OptimizedImage`)
- **Props**: camelCase (`onUploadComplete`)
- **파일명**: PascalCase (`OptimizedImage.tsx`)
- **인터페이스**: PascalCase + 접미사 (`MediaManagerProps`)

---

_이 문서는 지속적으로 업데이트되며, 새로운 컴포넌트가 추가되면 해당 API 문서도
함께 작성됩니다._
