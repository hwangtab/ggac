'use client';

import React, { useMemo } from 'react';
import DOMPurify from 'dompurify';

interface PostContentRendererProps {
  content: string;
  contentFormat?: 'plain' | 'html' | 'markdown';
  className?: string;
}

export const PostContentRenderer: React.FC<PostContentRendererProps> = ({
  content,
  contentFormat = 'plain',
  className = '',
}) => {
  const sanitizedContent = useMemo(() => {
    if (contentFormat === 'html') {
      // HTML 콘텐츠 새니타이제이션
      return DOMPurify.sanitize(content, {
        ALLOWED_TAGS: [
          'p', 'br', 'strong', 'em', 'u', 's', 'a', 'ul', 'ol', 'li',
          'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'img',
          'table', 'thead', 'tbody', 'tr', 'td', 'th', 'div', 'span'
        ],
        ALLOWED_ATTR: [
          'href', 'target', 'src', 'alt', 'width', 'height', 'style',
          'class', 'title'
        ],
        ALLOWED_URI_REGEXP: /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|data):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
        KEEP_CONTENT: true,
        RETURN_DOM_FRAGMENT: false,
      });
    } else if (contentFormat === 'markdown') {
      // 향후 마크다운 지원 시 구현
      return content;
    } else {
      // 플레인 텍스트는 줄바꿈만 처리
      return content;
    }
  }, [content, contentFormat]);

  if (contentFormat === 'html') {
    return (
      <div 
        className={`prose prose-sm max-w-none ${className}`}
        style={{
          lineHeight: '1.6',
          wordBreak: 'break-word',
        }}
        dangerouslySetInnerHTML={{
          __html: sanitizedContent
        }}
      />
    );
  }

  // 플레인 텍스트 렌더링 (기존 방식)
  return (
    <div className={`whitespace-pre-wrap text-gray-800 leading-relaxed ${className}`}>
      {content}
    </div>
  );
};

export default PostContentRenderer;