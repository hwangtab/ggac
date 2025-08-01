'use client';

import React, { useMemo } from 'react';
import DOMPurify from 'dompurify';
import { detectXssPatterns, logSecurityEvent } from '@/utils/security';

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
      // 사전 XSS 패턴 검사
      if (detectXssPatterns(content)) {
        logSecurityEvent('XSS_PATTERN_DETECTED', { content: content.substring(0, 200) }, 'high');
        console.warn('[Security] XSS 패턴이 감지되어 콘텐츠가 차단되었습니다.');
        return '<p>[보안상의 이유로 콘텐츠가 차단되었습니다.]</p>';
      }

      // HTML 콘텐츠 새니타이제이션
      const sanitized = DOMPurify.sanitize(content, {
        ALLOWED_TAGS: [
          'p', 'br', 'strong', 'em', 'u', 's', 'a', 'ul', 'ol', 'li',
          'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'img',
          'table', 'thead', 'tbody', 'tr', 'td', 'th', 'div', 'span'
        ],
        ALLOWED_ATTR: [
          'href', 'target', 'src', 'alt', 'width', 'height',
          'class', 'title'
        ],
        // data: URI 차단, 안전한 프로토콜만 허용
        ALLOWED_URI_REGEXP: /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
        KEEP_CONTENT: true,
        RETURN_DOM_FRAGMENT: false,
        // 추가 보안 설정
        SANITIZE_DOM: true,
        SANITIZE_NAMED_PROPS: true,
        // 위험한 속성 및 태그 차단
        FORBID_ATTR: ['style', 'onerror', 'onload', 'onclick', 'onmouseover', 'onfocus', 'onblur', 'onchange', 'onsubmit'],
        FORBID_TAGS: ['script', 'object', 'embed', 'form', 'input', 'style', 'iframe', 'frame'],
        // 추가 프로토콜 및 속성 제한
        ALLOW_ARIA_ATTR: false,
        ALLOW_DATA_ATTR: false,
        ALLOW_UNKNOWN_PROTOCOLS: false,
      });

      // 새니타이제이션 후 추가 검증
      if (sanitized !== content) {
        logSecurityEvent('CONTENT_SANITIZED', { 
          originalLength: content.length, 
          sanitizedLength: sanitized.length 
        }, 'medium');
      }

      return sanitized;
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