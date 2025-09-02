'use client';

import React, { useMemo } from 'react';
import DOMPurify from 'dompurify';
import ReactMarkdown from 'react-markdown'
import Image from 'next/image';
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
  const sanitizedHtml = useMemo(() => {
    if (contentFormat !== 'html') return '';

    if (detectXssPatterns(content)) {
      logSecurityEvent('XSS_PATTERN_DETECTED', { content: content.substring(0, 200) }, 'high');
      console.warn('[Security] XSS 패턴이 감지되어 콘텐츠가 차단되었습니다.');
      return '<p>[보안상의 이유로 콘텐츠가 차단되었습니다.]</p>';
    }

    const sanitized = DOMPurify.sanitize(content, {
      ALLOWED_TAGS: [
        'p', 'br', 'strong', 'em', 'u', 's', 'a', 'ul', 'ol', 'li',
        'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'img',
        'table', 'thead', 'tbody', 'tr', 'td', 'th', 'div', 'span'
      ],
      ALLOWED_ATTR: ['href', 'target', 'src', 'alt', 'width', 'height', 'class', 'title'],
      ALLOWED_URI_REGEXP: /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
      KEEP_CONTENT: true,
      RETURN_DOM_FRAGMENT: false,
      SANITIZE_DOM: true,
      SANITIZE_NAMED_PROPS: true,
      FORBID_ATTR: ['style', 'onerror', 'onload', 'onclick', 'onmouseover', 'onfocus', 'onblur', 'onchange', 'onsubmit'],
      FORBID_TAGS: ['script', 'object', 'embed', 'form', 'input', 'style', 'iframe', 'frame'],
      ALLOW_ARIA_ATTR: false,
      ALLOW_DATA_ATTR: false,
      ALLOW_UNKNOWN_PROTOCOLS: false,
    });

    if (sanitized !== content) {
      logSecurityEvent('CONTENT_SANITIZED', { 
        originalLength: content.length, 
        sanitizedLength: sanitized.length 
      }, 'medium');
    }

    return sanitized;
  }, [content, contentFormat]);

  if (contentFormat === 'html') {
    return (
      <div
        className={`prose max-w-none ${className}`}
        dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
      />
    );
  }

  if (contentFormat === 'markdown') {
    return (
      <div className={`prose max-w-none ${className}`}>
        <ReactMarkdown
          components={{
            a: ({node, ...props}) => <a {...props} target="_blank" rel="noopener noreferrer" />,
            img: ({node, src, alt, ...props}) => {
              if (!src || typeof src !== 'string') return null;
              return (
                <Image
                  src={src}
                  alt={alt || '이미지'}
                  width={800}
                  height={600}
                  style={{ maxWidth: '100%', height: 'auto' }}
                  className="rounded-lg"
                  unoptimized
                />
              );
            },
          }}
        >
          {content}
        </ReactMarkdown>
      </div>
    );
  }

  // Fallback for 'plain' text
  return (
    <div className={`whitespace-pre-wrap text-gray-800 leading-relaxed ${className}`}>
      {content}
    </div>
  );
};

export default PostContentRenderer;