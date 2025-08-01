'use client';

import React, { useRef, useCallback } from 'react';
import { Editor } from '@tinymce/tinymce-react';
import type { Editor as TinyMCEEditor } from 'tinymce';

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

  // 이미지 업로드 핸들러
  const handleImageUpload = useCallback((blobInfo: any, progress: (percent: number) => void) => {
    return new Promise<string>((resolve, reject) => {
      const formData = new FormData();
      formData.append('file', blobInfo.blob(), blobInfo.filename());

      // 임시 게시글 ID를 위한 UUID 생성 (실제로는 게시글 생성 후 교체)
      const tempPostId = 'temp-' + Date.now();

      fetch(`/api/posts/${tempPostId}/attachments`, {
        method: 'POST',
        body: formData,
      })
        .then(response => {
          if (!response.ok) {
            throw new Error('이미지 업로드에 실패했습니다.');
          }
          return response.json();
        })
        .then(result => {
          progress(100);
          resolve(result.url);
        })
        .catch(error => {
          console.error('이미지 업로드 오류:', error);
          reject(error.message || '이미지 업로드에 실패했습니다.');
        });
    });
  }, []);

  const editorConfig = {
    height,
    menubar: false,
    plugins: [
      'advlist', 'autolink', 'lists', 'link', 'image', 'charmap', 'preview',
      'anchor', 'searchreplace', 'visualblocks', 'code', 'fullscreen',
      'insertdatetime', 'media', 'table', 'code', 'help', 'wordcount',
      'paste', 'emoticons'
    ],
    toolbar: 'undo redo | blocks | ' +
      'bold italic forecolor | alignleft aligncenter ' +
      'alignright alignjustify | bullist numlist outdent indent | ' +
      'removeformat | image link | code | help',
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
    valid_elements: 'p,br,strong,em,u,s,a[href|target],ul,ol,li,blockquote,h1,h2,h3,h4,h5,h6,img[src|alt|width|height],table,thead,tbody,tr,td,th,div,span',
    invalid_elements: 'script,style,iframe,object,embed,form,input,textarea,button',
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