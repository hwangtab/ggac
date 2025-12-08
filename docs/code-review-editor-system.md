# 게시판 에디터 시스템 코드 리뷰

**날짜:** 2025-01-13 **분석 도구:** Gemini CLI **대상:** QuillEditor,
PostContentRenderer, Typography 설정

---

## 종합 평가

전반적으로 시스템은 잘 구성되어 있으며, 특히 **보안**과 **사용자 경험(UX)**에
많은 신경을 쓴 흔적이 있습니다. 이미지 업로드 처리, 파일 검증, XSS 방지 등
중요한 기능들이 잘 구현되어 있습니다.

### 강점 ✅

- 파일 검증 및 XSS 방지 (DOMPurify) 잘 구현됨
- 한글 친화적 설정 (`word-break: keep-all`) 훌륭함
- 접근성 고려 (`focus-visible` 스타일 등)
- 전반적인 코드 품질 양호

### 개선 필요 ⚠️

- 과도한 복잡성
- 성능 저하 요소
- 스타일 불일치 문제

---

## 🔴 High Priority (시급)

### 1. Next.js Image 최적화 비활성화

**문제점:**

- `unoptimized` 속성으로 인해 Next.js의 이미지 최적화 기능 완전 비활성화
- WebP 변환, 자동 리사이징, 캐싱 기능 모두 동작하지 않음
- 성능에 직접적인 악영향

**위치:** `src/components/PostContentRenderer.tsx:83`

```typescript
// ❌ 현재 (문제)
<Image
  src={src}
  alt={alt || '이미지'}
  width={800}
  height={600}
  style={{ maxWidth: '100%', height: 'auto' }}
  className="rounded-lg"
  unoptimized  // 문제!
/>
```

**해결 방안:**

1. `unoptimized` 속성 제거
2. `next.config.js`에 이미지 호스트 설정 추가:

```javascript
// next.config.js
module.exports = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'your-supabase-storage.supabase.co',
        port: '',
        pathname: '/storage/v1/object/public/**',
      },
    ],
  },
}
```

**영향:** 이미지 로딩 속도 대폭 개선, 대역폭 절약

---

### 2. 에디터-렌더러 스타일 불일치 (WYSIWYG 위반)

**문제점:**

- QuillEditor는 자체 `style jsx global` 사용
- PostContentRenderer는 Tailwind Typography (`prose`) 사용
- 편집 화면과 실제 게시물이 다르게 보임
- 사용자 혼란 유발

**위치:**

- `src/components/QuillEditor.tsx:555-788` (에디터 스타일)
- `tailwind.config.js:65-218` (렌더러 스타일)

**해결 방안:**

1. **스타일 통합 방법:**

```typescript
// QuillEditor.tsx
<div className="prose max-w-none">
  <ReactQuill ... />
</div>
```

2. QuillEditor의 `style jsx global` 제거
3. Quill 기본 클래스와 충돌하는 부분만 `globals.css`에서 오버라이드

**영향:** WYSIWYG 경험 개선, 사용자 신뢰도 향상

---

## 🟡 Medium Priority

### 3. 이미지 삽입 로직의 과도한 복잡성

**문제점:**

- 3단계 폴백 로직 + `setTimeout` 폴링 사용
- 코드 이해 및 유지보수 어려움
- 많은 `console.log`가 남아있어 개발 과정의 어려움 시사
- 잠재적 버그 가능성

**위치:** `src/components/QuillEditor.tsx:130-244`

**현재 구조:**

```typescript
const insertImageToEditor = useCallback(async (imageUrl: string) => {
  // 방법 1: getSelection() + insertEmbed
  // 방법 2: getLength() + insertEmbed
  // 방법 3: updateContents with Delta
  // 각각 setTimeout 폴링 포함
}, [...])
```

**개선 방안:**

1. **근본 원인 분석:**
   - `getSelection()` 불안정 원인 파악
   - `dynamic` import와 Quill 초기화 타이밍 문제 확인

2. **로직 단순화:**

```typescript
const insertImageToEditor = useCallback(async (imageUrl: string) => {
  if (!quillRef.current) return;

  const quill = quillRef.current.getEditor();
  quill.focus();

  // 포커스 안정화 대기
  await new Promise(resolve => setTimeout(resolve, 100));

  const selection = quill.getSelection();
  const position = selection?.index ?? quill.getLength();

  quill.insertEmbed(position, 'image', imageUrl);
  quill.setSelection(position + 1);
}, [...]);
```

3. **상태 기반 렌더링:**

```typescript
const [isQuillReady, setIsQuillReady] = useState(false);

useEffect(() => {
  if (quillRef.current) {
    setIsQuillReady(true);
  }
}, [quillRef.current]);

// Quill이 준비되었을 때만 렌더링
{isQuillReady && <ReactQuill ... />}
```

**영향:** 코드 가독성 향상, 버그 감소, 유지보수 용이

---

### 4. 중복되는 XSS 방어 로직

**문제점:**

- `detectXssPatterns` + `DOMPurify` 이중 검사
- `DOMPurify`는 이미 검증된 강력한 라이브러리
- 불필요한 중복, 잘못된 탐지(false positive) 가능성

**위치:** `src/components/PostContentRenderer.tsx:23-25`

**현재 코드:**

```typescript
if (detectXssPatterns(content)) {
  logSecurityEvent('XSS_PATTERN_DETECTED', ...);
  return '<p>[보안상의 이유로 콘텐츠가 차단되었습니다.]</p>';
}

const sanitized = DOMPurify.sanitize(content, { ... });
```

**개선 방안:**

```typescript
const sanitized = DOMPurify.sanitize(content, {
  ALLOWED_TAGS: [...],
  ALLOWED_ATTR: [...],
  // ... 기존 설정 유지
});

// DOMPurify가 콘텐츠를 변경했는지 확인
if (sanitized !== content) {
  logSecurityEvent('CONTENT_SANITIZED', {
    originalLength: content.length,
    sanitizedLength: sanitized.length,
    removed: DOMPurify.removed  // DOMPurify가 제공하는 정보
  }, 'medium');
}
```

**영향:** 코드 단순화, 오탐 감소

---

### 5. 허용 태그/속성 불일치 가능성

**문제점:**

- QuillEditor의 `formats` 배열과 PostContentRenderer의 `ALLOWED_TAGS` 별도 관리
- 동기화 누락 시 서식 손실 가능
- 유지보수 어려움

**위치:**

- `src/components/QuillEditor.tsx:484-496`
- `src/components/PostContentRenderer.tsx:30-35`

**개선 방안:**

1. 공유 설정 파일 생성:

```typescript
// src/config/editor.config.ts
export const EDITOR_CONFIG = {
  allowedTags: [
    'p',
    'br',
    'strong',
    'em',
    'u',
    's',
    'a',
    'ul',
    'ol',
    'li',
    'blockquote',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'img',
    'table',
    'thead',
    'tbody',
    'tr',
    'td',
    'th',
    'div',
    'span',
  ],
  allowedAttributes: [
    'href',
    'target',
    'src',
    'alt',
    'width',
    'height',
    'class',
    'title',
  ],
  quillFormats: [
    'header',
    'bold',
    'italic',
    'underline',
    'strike',
    'list',
    'bullet',
    'align',
    'link',
    'image',
    'blockquote',
    'code-block',
  ],
} as const
```

2. 두 컴포넌트에서 import하여 사용:

```typescript
// QuillEditor.tsx
import { EDITOR_CONFIG } from '@/config/editor.config'
const formats = EDITOR_CONFIG.quillFormats

// PostContentRenderer.tsx
import { EDITOR_CONFIG } from '@/config/editor.config'
const sanitized = DOMPurify.sanitize(content, {
  ALLOWED_TAGS: EDITOR_CONFIG.allowedTags,
  ALLOWED_ATTR: EDITOR_CONFIG.allowedAttributes,
  // ...
})
```

**영향:** 일관성 보장, 유지보수 용이

---

## 🟢 Low Priority

### 6. 불필요한 디버깅 코드

**위치:** `src/components/QuillEditor.tsx:60-62`

```typescript
// ❌ 제거 필요
console.log('[QuillEditor] 컴포넌트 초기화 완료')
```

**해결:** 개발 환경에서만 출력되도록 변경

```typescript
if (process.env.NODE_ENV === 'development') {
  console.log('[QuillEditor] 컴포넌트 초기화 완료')
}
```

---

### 7. 이미지 업로드 중 UI 블로킹

**문제점:**

- 이미지 업로드 중 에디터 전체 비활성화
  (`readOnly={disabled || uploadStatus.isUploading}`)
- 여러 이미지 업로드 시 사용자 대기 필요

**위치:** `src/components/QuillEditor.tsx:551`

**개선 방안:**

1. 플레이스홀더 이미지 먼저 삽입
2. 업로드 중 로딩 스피너 표시
3. 완료 후 실제 URL로 교체

```typescript
const handleImageUpload = async (file: File) => {
  // 플레이스홀더 삽입
  const placeholderId = `uploading-${Date.now()}`
  insertPlaceholder(placeholderId)

  try {
    const url = await uploadImage(file)
    replacePlaceholder(placeholderId, url)
  } catch (error) {
    removePlaceholder(placeholderId)
    toast.error('업로드 실패')
  }
}
```

**영향:** 사용자 경험 개선

---

### 8. 과도하게 구체적인 스타일 규칙

**위치:** `tailwind.config.js:189-194`

```javascript
// ❌ 불필요하게 복잡
'p > strong:only-child': {
  display: 'inline',
  fontFamily: "var(--font-gmarket-sans), 'system-ui', sans-serif",
  fontWeight: '600',
  color: '#075985',
},
```

**개선 방안:** 해당 규칙 제거, 모든 `strong` 태그 일관되게 처리

**영향:** 코드 단순화, 예측 가능성 향상

---

## 추가 고려사항

### 브라우저 호환성

**문제:** `:has()` 선택자 사용 (`tailwind.config.js:131-134`)

```javascript
'p:has(> br:only-child)': {
  marginBottom: '0',
  lineHeight: '0.5rem',
},
```

- 최신 브라우저에서는 지원되지만 구형 브라우저 고려 필요
- 점진적 향상(progressive enhancement)으로 허용 가능
- 대안: 서버/클라이언트에서 `<p><br></p>` 정규식으로 제거

---

## 우선순위별 실행 계획

### Phase 1: 즉시 실행 (High Priority)

1. ✅ Next.js Image `unoptimized` 제거 + config 설정
2. ✅ 에디터-렌더러 스타일 통합

**예상 시간:** 2-3시간 **예상 효과:** 성능 대폭 개선, UX 향상

### Phase 2: 단기 실행 (Medium Priority)

3. 이미지 삽입 로직 단순화
4. XSS 방어 로직 정리
5. 공유 설정 파일 생성

**예상 시간:** 4-6시간 **예상 효과:** 코드 품질 향상, 유지보수성 개선

### Phase 3: 장기 실행 (Low Priority)

6. 디버깅 코드 정리
7. 이미지 업로드 UX 개선
8. 불필요한 스타일 규칙 제거

**예상 시간:** 2-3시간 **예상 효과:** 완성도 향상

---

## 결론

현재 시스템은 **기능적으로 완성도가 높고** **보안적으로 견고**합니다. 가장
시급한 개선 사항은:

1. **이미지 최적화 활성화** (성능)
2. **스타일 통합** (사용자 경험)
3. **코드 단순화** (유지보수성)

이 세 가지를 우선적으로 개선하면 훨씬 더 **안정적이고 성능이 뛰어난** 에디터
시스템이 될 것입니다.

---

**문서 작성자:** Claude Code **검토자:** Gemini CLI **마지막 업데이트:**
2025-01-13
