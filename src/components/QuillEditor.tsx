'use client';

import React, { useMemo, useRef, useCallback, useEffect } from 'react';
import dynamic from 'next/dynamic';
import 'react-quill/dist/quill.snow.css';
import { validateFile, sanitizeImageFile } from '@/utils/fileValidation';
import { generateTempId } from '@/utils/security';

const ReactQuill = dynamic(() => import('react-quill'), { 
  ssr: false,
  loading: () => (
    <div className="animate-pulse bg-gray-100 rounded-md" style={{ height: 400 }}>
      <div className="h-12 bg-gray-200 rounded-t-md mb-2"></div>
      <div className="px-3 py-2 space-y-2">
        <div className="h-4 bg-gray-200 rounded w-3/4"></div>
        <div className="h-4 bg-gray-200 rounded w-1/2"></div>
        <div className="h-4 bg-gray-200 rounded w-5/6"></div>
      </div>
    </div>
  )
});

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

  // 컴포넌트 마운트 시 디버깅 로그
  useEffect(() => {
    console.log('[QuillEditor] 컴포넌트 초기화 완료');
  }, []);

  // 이미지 업로드 핸들러 (기존 TinyMCE 로직 재사용)
  const handleImageUpload = useCallback(async (file: File): Promise<string> => {
    try {
      console.log('[QuillEditor] 이미지 업로드 시작:', file.name);

      // 1. 파일 검증
      const validation = await validateFile(file);
      if (!validation.isValid) {
        throw new Error(`파일 검증 실패: ${validation.errors.join(', ')}`);
      }

      if (validation.fileType !== 'image') {
        throw new Error('이미지 파일만 업로드할 수 있습니다.');
      }

      console.log('[QuillEditor] 파일 검증 완료');

      // 2. 이미지 메타데이터 제거
      const sanitizedFile = await sanitizeImageFile(file);
      
      // 3. 서버 업로드
      const formData = new FormData();
      formData.append('file', sanitizedFile);
      const tempPostId = generateTempId();

      console.log('[QuillEditor] 서버 업로드 시작');

      const response = await fetch(`/api/posts/${tempPostId}/attachments`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || '이미지 업로드에 실패했습니다.');
      }

      const result = await response.json();
      console.log('[QuillEditor] 이미지 업로드 성공:', result.url);
      
      return result.url;
    } catch (error) {
      console.error('[QuillEditor] 이미지 업로드 오류:', error);
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
              } catch (error: any) {
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

  // 드래그 앤 드롭 핸들러
  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files);
    const imageFiles = files.filter(file => file.type.startsWith('image/'));
    
    if (imageFiles.length > 0) {
      const quill = quillRef.current?.getEditor();
      if (quill) {
        try {
          for (const file of imageFiles) {
            const imageUrl = await handleImageUpload(file);
            const range = quill.getSelection(true);
            quill.insertEmbed(range.index, 'image', imageUrl, 'user');
            quill.setSelection(range.index + 1);
          }
        } catch (error: any) {
          alert('이미지 업로드에 실패했습니다: ' + error.message);
        }
      }
    }
  }, [handleImageUpload]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  return (
    <div 
      className="quill-editor-container"
      onDrop={handleDrop}
      onDragOver={handleDragOver}
    >
      <ReactQuill
        theme="snow"
        value={value}
        onChange={onChange}
        ref={quillRef}
        modules={modules}
        formats={formats}
        placeholder={placeholder}
        readOnly={disabled}
        style={{ height: height }}
      />
      <style jsx global>{`
        .quill-editor-container .ql-container {
          font-family: "Pretendard", -apple-system, BlinkMacSystemFont, system-ui, Roboto, "Helvetica Neue", "Segoe UI", "Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", sans-serif;
          font-size: 14px;
          line-height: 1.6;
        }
        
        .quill-editor-container .ql-editor {
          min-height: ${height - 42}px;
          padding: 12px 15px;
        }
        
        .quill-editor-container .ql-toolbar {
          border-top: 1px solid #d1d5db;
          border-left: 1px solid #d1d5db;
          border-right: 1px solid #d1d5db;
          border-radius: 0.5rem 0.5rem 0 0;
          background: #f9fafb;
          padding: 8px;
        }
        
        .quill-editor-container .ql-container {
          border-bottom: 1px solid #d1d5db;
          border-left: 1px solid #d1d5db;
          border-right: 1px solid #d1d5db;
          border-radius: 0 0 0.5rem 0.5rem;
          background: white;
        }

        .quill-editor-container .ql-toolbar .ql-formats {
          margin-right: 8px;
        }

        .quill-editor-container .ql-toolbar button:hover {
          color: #2563eb;
        }

        .quill-editor-container .ql-toolbar button.ql-active {
          color: #2563eb;
        }

        .quill-editor-container .ql-editor.ql-blank::before {
          color: #9ca3af;
          font-style: normal;
        }

        /* 이미지 스타일링 */
        .quill-editor-container .ql-editor img {
          max-width: 100%;
          height: auto;
          border-radius: 0.375rem;
          box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.1);
        }

        /* 링크 스타일링 */
        .quill-editor-container .ql-editor a {
          color: #2563eb;
          text-decoration: underline;
        }

        /* 블록 인용 스타일링 */
        .quill-editor-container .ql-editor blockquote {
          border-left: 4px solid #e5e7eb;
          padding-left: 16px;
          margin: 16px 0;
          color: #6b7280;
          font-style: italic;
        }

        /* 코드 블록 스타일링 */
        .quill-editor-container .ql-editor pre {
          background-color: #f3f4f6;
          border-radius: 0.375rem;
          padding: 12px;
          font-family: 'Courier New', monospace;
          font-size: 13px;
          overflow-x: auto;
        }

        /* 인라인 코드 스타일링 */
        .quill-editor-container .ql-editor code {
          background-color: #f3f4f6;
          padding: 2px 4px;
          border-radius: 0.25rem;
          font-family: 'Courier New', monospace;
          font-size: 13px;
        }

        /* 비활성화 상태 */
        .quill-editor-container.disabled .ql-toolbar {
          pointer-events: none;
          opacity: 0.6;
        }

        .quill-editor-container.disabled .ql-editor {
          background-color: #f9fafb;
          cursor: not-allowed;
        }
      `}</style>
    </div>
  );
};

export default QuillEditor;