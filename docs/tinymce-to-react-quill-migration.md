# TinyMCE에서 React-Quill로 완전 전환 계획서

## 📋 개요

### 목표
- 현재 사용 중인 TinyMCE 리치 에디터를 React-Quill로 완전 교체
- API 키 의존성 제거 및 설정 단순화
- 기존 기능 동등성 보장 및 사용자 경험 개선

### 전환 이유
1. **API 키 문제**: TinyMCE API 키 설정 및 관리 복잡성
2. **의존성 제거**: 외부 CDN 의존성 없는 자체 호스팅
3. **성능 개선**: 더 가벼운 번들 크기
4. **유지보수성**: 단순한 설정과 관리

## 🎯 현재 상태 분석

### 기존 TinyMCE 사용 위치
1. **게시글 작성**: `/src/components/CreatePostForm.tsx`
2. **게시글 수정**: `/src/app/board/[id]/edit/page.tsx`
3. **리치 에디터 컴포넌트**: `/src/components/RichTextEditor.tsx`

### 기존 기능 분석
- [x] 텍스트 서식 (굵게, 기울임, 밑줄)
- [x] 목록 (순서, 무순서)
- [x] 정렬 (좌, 중앙, 우, 양쪽)
- [x] 이미지 업로드 및 첨부
- [x] 링크 삽입
- [x] 테이블 지원
- [x] 드래그 앤 드롭 이미지
- [x] 보안 HTML 검증
- [x] 한국어 지원

## 📦 의존성 변경 계획

### 제거할 패키지
```bash
npm uninstall @tinymce/tinymce-react tinymce
```

### 추가할 패키지
```bash
npm install react-quill quill
```

### 환경변수 정리
- 제거: `NEXT_PUBLIC_TINYMCE_API_KEY`
- 유지: 기존 Supabase 관련 환경변수

## 🔧 구현 단계별 계획

### Phase 1: React-Quill 컴포넌트 개발 (1-2시간)

#### 1.1 패키지 설치 및 기본 설정
```bash
npm install react-quill quill
```

#### 1.2 새로운 QuillEditor 컴포넌트 생성
**파일**: `/src/components/QuillEditor.tsx`

**주요 기능**:
- TinyMCE와 동일한 인터페이스 유지
- 커스텀 툴바 구성
- 이미지 업로드 핸들러 이식
- 보안 HTML 검증 유지
- 한국어 플레이스홀더 지원

#### 1.3 스타일링 설정
**파일**: `/src/styles/quill-custom.css`
- Quill Snow 테마 커스터마이징
- 기존 디자인 시스템과 일치하는 스타일
- 다크모드 지원 (필요시)

### Phase 2: 기능 이식 및 확장 (2-3시간)

#### 2.1 이미지 업로드 시스템 이식
- 기존 `handleImageUpload` 함수 재사용
- Quill의 이미지 핸들러와 연동
- 파일 검증 및 보안 처리 유지

#### 2.2 드래그 앤 드롭 기능 구현
```typescript
// Quill 커스텀 모듈로 구현
const dragDropModule = {
  toolbar: false,
  imageDrop: true,
  imageResize: {
    displaySize: true
  }
};
```

#### 2.3 보안 HTML 검증 강화
- DOMPurify 연동 유지
- Quill Delta -> HTML 변환 시 검증
- XSS 방지 정책 적용

### Phase 3: 컴포넌트 교체 (1시간)

#### 3.1 기존 컴포넌트 백업
```bash
# 백업 생성
cp src/components/RichTextEditor.tsx src/components/RichTextEditor.tsx.backup
```

#### 3.2 인터페이스 호환성 확보
```typescript
// 기존 RichTextEditorProps 인터페이스 유지
interface RichTextEditorProps {
  value: string;
  onChange: (content: string) => void;
  placeholder?: string;
  disabled?: boolean;
  height?: number;
}
```

#### 3.3 단계적 교체
1. **먼저**: QuillEditor를 별도 컴포넌트로 완성
2. **다음**: RichTextEditor에서 QuillEditor 호출하도록 변경
3. **마지막**: 완전 교체 후 TinyMCE 코드 제거

### Phase 4: 테스트 및 검증 (1-2시간)

#### 4.1 기능 테스트 체크리스트
- [ ] 게시글 작성 화면에서 에디터 로딩
- [ ] 텍스트 서식 기능 (굵게, 기울임, 밑줄, 취소선)
- [ ] 목록 기능 (순서 있는 목록, 순서 없는 목록)
- [ ] 정렬 기능 (좌, 중앙, 우, 양쪽 정렬)
- [ ] 이미지 업로드 및 표시
- [ ] 드래그 앤 드롭 이미지 첨부
- [ ] 링크 삽입 및 편집
- [ ] 게시글 저장 및 표시
- [ ] 게시글 수정 기능
- [ ] HTML 보안 검증
- [ ] 모바일 반응형 동작

#### 4.2 브라우저 호환성 테스트
- [ ] Chrome (최신)
- [ ] Safari (최신)
- [ ] Firefox (최신)
- [ ] Edge (최신)
- [ ] 모바일 Safari (iOS)
- [ ] 모바일 Chrome (Android)

#### 4.3 성능 테스트
- [ ] 초기 로딩 시간 측정
- [ ] 번들 크기 비교 (before/after)
- [ ] 메모리 사용량 확인
- [ ] 대용량 텍스트 처리 성능

### Phase 5: 정리 및 최적화 (30분)

#### 5.1 불필요한 코드 제거
- TinyMCE 관련 import 문 제거
- 사용하지 않는 환경변수 정리
- CSP 정책에서 TinyMCE CDN 제거

#### 5.2 문서화 업데이트
- CLAUDE.md 파일 업데이트
- 개발 가이드 수정
- 트러블슈팅 가이드 추가

## 💡 상세 구현 사양

### QuillEditor 컴포넌트 사양

```typescript
'use client';

import React, { useMemo, useRef, useCallback } from 'react';
import dynamic from 'next/dynamic';
import 'react-quill/dist/quill.snow.css';
import { validateFile, sanitizeImageFile } from '@/utils/fileValidation';
import { generateTempId } from '@/utils/security';

const ReactQuill = dynamic(() => import('react-quill'), { ssr: false });

interface QuillEditorProps {
  value: string;
  onChange: (content: string) => void;
  placeholder?: string;
  disabled?: boolean;
  height?: number;
}

export const QuillEditor: React.FC<QuillEditorProps> = ({
  value,
  onChange,
  placeholder = '내용을 입력하세요...',
  disabled = false,
  height = 400,
}) => {
  const quillRef = useRef<any>(null);

  // 이미지 업로드 핸들러 (기존 TinyMCE 로직 재사용)
  const handleImageUpload = useCallback(async (file: File) => {
    try {
      // 기존 파일 검증 로직
      const validation = await validateFile(file);
      if (!validation.isValid) {
        throw new Error(`파일 검증 실패: ${validation.errors.join(', ')}`);
      }

      if (validation.fileType !== 'image') {
        throw new Error('이미지 파일만 업로드할 수 있습니다.');
      }

      // 기존 메타데이터 제거 로직
      const sanitizedFile = await sanitizeImageFile(file);
      
      // 기존 서버 업로드 로직
      const formData = new FormData();
      formData.append('file', sanitizedFile);
      const tempPostId = generateTempId();

      const response = await fetch(`/api/posts/${tempPostId}/attachments`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || '이미지 업로드에 실패했습니다.');
      }

      const result = await response.json();
      return result.url;
    } catch (error) {
      console.error('이미지 업로드 오류:', error);
      throw error;
    }
  }, []);

  // Quill 모듈 설정
  const modules = useMemo(() => ({
    toolbar: {
      container: [
        [{ 'header': [1, 2, 3, false] }],
        ['bold', 'italic', 'underline', 'strike'],
        [{ 'list': 'ordered'}, { 'list': 'bullet' }],
        [{ 'align': [] }],
        ['link', 'image'],
        ['blockquote', 'code-block'],
        ['clean']
      ],
      handlers: {
        image: function() {
          const input = document.createElement('input');
          input.setAttribute('type', 'file');
          input.setAttribute('accept', 'image/*');
          
          input.onchange = async () => {
            const file = input.files?.[0];
            if (file) {
              try {
                const imageUrl = await handleImageUpload(file);
                const quill = quillRef.current?.getEditor();
                if (quill) {
                  const range = quill.getSelection(true);
                  quill.insertEmbed(range.index, 'image', imageUrl, 'user');
                  quill.setSelection(range.index + 1);
                }
              } catch (error) {
                alert('이미지 업로드에 실패했습니다: ' + error.message);
              }
            }
          };
          
          input.click();
        }
      }
    },
    clipboard: {
      matchVisual: false
    }
  }), [handleImageUpload]);

  // 허용할 포맷 (보안상 제한)
  const formats = [
    'header', 'bold', 'italic', 'underline', 'strike',
    'list', 'bullet', 'align', 'link', 'image',
    'blockquote', 'code-block'
  ];

  return (
    <div className="quill-editor-container">
      <ReactQuill
        ref={quillRef}
        theme="snow"
        value={value}
        onChange={onChange}
        modules={modules}
        formats={formats}
        placeholder={placeholder}
        readOnly={disabled}
        style={{ height: height }}
      />
      <style jsx global>{`
        .quill-editor-container .ql-container {
          font-family: "Pretendard", -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
          font-size: 14px;
          line-height: 1.6;
        }
        
        .quill-editor-container .ql-editor {
          min-height: ${height - 42}px;
        }
        
        .quill-editor-container .ql-toolbar {
          border-top: 1px solid #e5e7eb;
          border-left: 1px solid #e5e7eb;
          border-right: 1px solid #e5e7eb;
          border-radius: 0.5rem 0.5rem 0 0;
          background: #f9fafb;
        }
        
        .quill-editor-container .ql-container {
          border-bottom: 1px solid #e5e7eb;
          border-left: 1px solid #e5e7eb;
          border-right: 1px solid #e5e7eb;
          border-radius: 0 0 0.5rem 0.5rem;
          background: white;
        }
      `}</style>
    </div>
  );
};

export default QuillEditor;
```

### 보안 고려사항

#### HTML 검증 강화
```typescript
// utils/htmlSanitizer.ts 추가
import DOMPurify from 'isomorphic-dompurify';

export const sanitizeQuillContent = (html: string): string => {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      'p', 'br', 'strong', 'em', 'u', 's', 'h1', 'h2', 'h3',
      'ul', 'ol', 'li', 'blockquote', 'a', 'img', 'code', 'pre'
    ],
    ALLOWED_ATTR: [
      'href', 'src', 'alt', 'class', 'target'
    ],
    ALLOWED_URI_REGEXP: /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|cid|xmpp|data):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i
  });
};
```

### CSP 정책 업데이트

#### next.config.js 수정
```javascript
// TinyMCE 관련 CSP 제거
"script-src 'self' 'unsafe-inline' https://www.youtube.com https://www.google-analytics.com", // cdn.tiny.cloud 제거
"style-src 'self' 'unsafe-inline' https://fonts.googleapis.com", // cdn.tiny.cloud 제거
"font-src 'self' https://fonts.gstatic.com", // cdn.tiny.cloud 제거
"connect-src 'self' https://api.supabase.io https://*.supabase.co wss://*.supabase.co", // cdn.tiny.cloud 제거
```

## 🚨 위험 요소 및 대응책

### 잠재적 위험 요소
1. **데이터 호환성**: 기존 TinyMCE HTML과 Quill HTML 차이
2. **기능 누락**: TinyMCE의 일부 고급 기능
3. **사용자 경험**: 에디터 UI 변경에 따른 적응 필요
4. **이미지 처리**: 기존 이미지 데이터 호환성

### 대응책
1. **HTML 호환성 보장**: HTML 파서 및 변환기 구현
2. **기능 매핑**: 필수 기능 우선 구현, 부가 기능 점진적 추가
3. **UX 가이드**: 사용자 가이드 및 도움말 제공
4. **데이터 마이그레이션**: 기존 데이터 검증 및 변환 스크립트

## 📊 성능 비교 예상치

### 번들 크기 (gzipped)
- **Before (TinyMCE)**: ~150KB (CDN 의존)
- **After (React-Quill)**: ~80KB (자체 호스팅)
- **개선율**: ~47% 감소

### 초기 로딩 시간
- **Before**: ~800ms (CDN 로딩 포함)
- **After**: ~300ms (번들에 포함)
- **개선율**: ~62% 단축

### 의존성
- **Before**: 외부 CDN + API 키 필요
- **After**: 완전 자체 호스팅
- **안정성**: 크게 향상

## ✅ 완료 체크리스트

### 개발 단계
- [ ] React-Quill 패키지 설치
- [ ] QuillEditor 컴포넌트 구현
- [ ] 이미지 업로드 기능 이식
- [ ] 드래그 앤 드롭 기능 구현
- [ ] 보안 HTML 검증 적용
- [ ] 스타일링 완료
- [ ] 기존 컴포넌트 교체

### 테스트 단계
- [ ] 기능 테스트 완료
- [ ] 브라우저 호환성 확인
- [ ] 성능 테스트 통과
- [ ] 모바일 테스트 완료
- [ ] 보안 테스트 통과

### 배포 단계
- [ ] 프로덕션 빌드 테스트
- [ ] Vercel 배포 확인
- [ ] 실제 환경 테스트
- [ ] 사용자 피드백 수집
- [ ] 문서화 완료

### 정리 단계
- [ ] TinyMCE 패키지 제거
- [ ] 환경변수 정리
- [ ] CSP 정책 업데이트
- [ ] 코드 리뷰 완료
- [ ] 백업 파일 정리

## 📝 마이그레이션 후 유지보수

### 모니터링 항목
1. **에디터 로딩 시간**
2. **이미지 업로드 성공률**
3. **브라우저별 에러 발생률**
4. **사용자 만족도**

### 정기 업데이트
- React-Quill 패키지 업데이트
- 보안 패치 적용
- 새 기능 추가 검토

---

## 📞 구현 지원

이 계획서에 따라 단계별로 구현하시면 됩니다. 각 단계별로 지원이 필요하시면 언제든지 요청해주세요.

**예상 총 작업 시간**: 5-7시간
**우선순위**: 높음 (TinyMCE API 키 이슈 해결)
**난이도**: 중간 (기존 코드 이해 필요)

구현을 시작하시겠습니까?