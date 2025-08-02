'use client';

import React, { useRef, useCallback, useEffect } from 'react';
import { Editor } from '@tinymce/tinymce-react';
import type { Editor as TinyMCEEditor } from 'tinymce';
import { generateTempId } from '@/utils/security';
import { validateFile, sanitizeImageFile } from '@/utils/fileValidation';

interface RichTextEditorProps {
  value: string;
  onChange: (content: string) => void;
  placeholder?: string;
  disabled?: boolean;
  height?: number;
}

export const RichTextEditor: React.FC<RichTextEditorProps> = ({
  value,
  onChange,
  placeholder = '내용을 입력하세요...',
  disabled = false,
  height = 400,
}) => {
  const editorRef = useRef<TinyMCEEditor | null>(null);

  // 컴포넌트 언마운트 시 TinyMCE 에디터 정리
  useEffect(() => {
    return () => {
      if (editorRef.current) {
        try {
          // 에디터 인스턴스 제거
          editorRef.current.destroy();
          editorRef.current = null;
        } catch (error) {
          console.warn('[TinyMCE] 에디터 정리 중 오류:', error);
        }
      }
    };
  }, []);

  // 이미지 업로드 핸들러
  const handleImageUpload = useCallback(async (blobInfo: any, progress: (percent: number) => void) => {
    try {
      // 1. 파일 객체 생성
      const file = new File([blobInfo.blob()], blobInfo.filename(), { 
        type: blobInfo.blob().type 
      });

      progress(10);

      // 2. 클라이언트 사이드 파일 검증
      const validation = await validateFile(file);
      if (!validation.isValid) {
        throw new Error(`파일 검증 실패: ${validation.errors.join(', ')}`);
      }

      if (validation.fileType !== 'image') {
        throw new Error('이미지 파일만 업로드할 수 있습니다.');
      }

      progress(30);

      // 3. 이미지 메타데이터 제거 (EXIF 등)
      const sanitizedFile = await sanitizeImageFile(file);
      
      progress(50);

      // 4. 서버 업로드
      const formData = new FormData();
      formData.append('file', sanitizedFile);

      // 암호학적으로 안전한 임시 게시글 ID 생성
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
      progress(100);
      
      return result.url;
    } catch (error) {
      console.error('이미지 업로드 오류:', error);
      throw error;
    }
  }, []);

  const editorConfig = {
    apiKey: process.env.NEXT_PUBLIC_TINYMCE_API_KEY,
    height,
    menubar: false,
    // 보안상 안전한 플러그인만 사용
    plugins: [
      'advlist', 'autolink', 'lists', 'link', 'image', 'preview',
      'searchreplace', 'visualblocks', 'fullscreen',
      'table', 'help', 'wordcount', 'paste'
    ],
    // 색상, 미디어 등 위험한 기능 제거
    toolbar: 'undo redo | blocks | ' +
      'bold italic | alignleft aligncenter ' +
      'alignright alignjustify | bullist numlist outdent indent | ' +
      'removeformat | image link | help',
    content_style: 'body { font-family: "Pretendard", -apple-system, BlinkMacSystemFont, system-ui, Roboto, "Helvetica Neue", "Segoe UI", "Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", sans-serif; font-size: 14px; line-height: 1.6; }',
    placeholder,
    paste_data_images: true,
    automatic_uploads: true,
    images_upload_handler: handleImageUpload,
    // images_upload_url: false, // 커스텀 핸들러 사용
    file_picker_types: 'image',
    file_picker_callback: (callback: any, value: any, meta: any) => {
      if (meta.filetype === 'image') {
        const input = document.createElement('input');
        input.setAttribute('type', 'file');
        input.setAttribute('accept', 'image/*');

        input.onchange = function() {
          const file = (this as HTMLInputElement).files?.[0];
          if (file) {
            const reader = new FileReader();
            reader.onload = function(e) {
              callback(e.target?.result, {
                alt: file.name
              });
            };
            reader.readAsDataURL(file);
          }
        };

        input.click();
      }
    },
    skin: 'oxide',
    theme: 'silver',
    language: 'ko_KR',
    branding: false,
    promotion: false,
    statusbar: false,
    resize: false,
    paste_webkit_styles: 'none',
    paste_remove_styles_if_webkit: true,
    paste_strip_class_attributes: 'all',
    // DOMPurify와 일치하는 보안 설정 - style 속성 완전 차단
    valid_elements: 'p,br,strong,em,u,s,a[href|target],ul,ol,li,blockquote,h1,h2,h3,h4,h5,h6,img[src|alt|width|height|class|title],table,thead,tbody,tr,td,th,div[class],span[class]',
    invalid_elements: 'script,style,iframe,object,embed,form,input,textarea,button,frame',
    // 추가 보안 속성 차단
    invalid_styles: 'color font-size font-family background-color background-image',
    forced_root_block: 'p',
    force_br_newlines: false,
    force_p_newlines: true,
    content_css: false,
    setup: (editor: TinyMCEEditor) => {
      editorRef.current = editor;
      
      editor.on('change keyup', () => {
        const content = editor.getContent();
        onChange(content);
      });

      // 드래그 앤 드롭 이미지 처리
      editor.on('drop', (e) => {
        const files = Array.from(e.dataTransfer?.files || []) as File[];
        const imageFiles = files.filter(file => file.type.startsWith('image/'));
        
        if (imageFiles.length > 0) {
          e.preventDefault();
          imageFiles.forEach(file => {
            const reader = new FileReader();
            reader.onload = (event) => {
              const img = editor.dom.create('img', {
                src: event.target?.result as string,
                alt: file.name,
                style: 'max-width: 100%; height: auto;'
              });
              editor.insertContent(img.outerHTML);
            };
            reader.readAsDataURL(file);
          });
        }
      });

      // 에디터 초기화 완료 시 이벤트 리스너 정리 준비
      editor.on('init', () => {
        console.log('[TinyMCE] 에디터 초기화 완료');
      });

      // 에디터 제거 전 정리 작업
      editor.on('remove', () => {
        console.log('[TinyMCE] 에디터 제거 중...');
        // 추가적인 정리 작업이 필요한 경우 여기에 추가
      });
    },
  };

  return (
    <div className="rich-text-editor">
      <Editor
        value={value}
        onEditorChange={onChange}
        disabled={disabled}
        init={editorConfig}
      />
      <style jsx global>{`
        .tox .tox-editor-header {
          border-bottom: 1px solid #e5e7eb;
        }
        .tox .tox-toolbar {
          background: #f9fafb;
        }
        .tox .tox-edit-area {
          border: none;
        }
        .tox-tinymce {
          border: 1px solid #d1d5db !important;
          border-radius: 0.5rem !important;
        }
        .tox .tox-edit-area__iframe {
          background: white;
        }
      `}</style>
    </div>
  );
};

export default RichTextEditor;