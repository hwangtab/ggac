'use client'

import React, { useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import Image from 'next/image'
import { detectXssPatterns, logSecurityEvent } from '@/utils/security'
import { sanitizePostHtml } from '@/utils/sanitizePostHtml'
import { createImageProxy } from '@/utils/imageValidation'
import { isSafeInternalPath, toSafeHttpUrl, toSafeLinkHref } from '@/utils/safeUrl'
import { shiftMarkdownHeadings } from '@/utils/markdownHeadings'

interface PostContentRendererProps {
  content: string
  contentFormat?: 'plain' | 'html' | 'markdown'
  className?: string
}

export const PostContentRenderer: React.FC<PostContentRendererProps> = ({
  content,
  contentFormat = 'plain',
  className = '',
}) => {
  const normalizeBlankParagraphs = (html: string) => {
    if (!html) return html
    return html
      .replace(/<p[^>]*data-empty-line="true"[^>]*>\s*<\/p>/gi, '<p data-empty-line="true"></p>')
      .replace(/<p>(?:\s|&nbsp;|<br\s*\/?>)*<\/p>/gi, '<p data-empty-line="true"></p>')
      .replace(/(?:<p data-empty-line="true"><\/p>){2,}/gi, '<p data-empty-line="true"></p>')
  }

  const sanitizedHtml = useMemo(() => {
    if (contentFormat !== 'html') return ''

    if (detectXssPatterns(content)) {
      logSecurityEvent('XSS_PATTERN_DETECTED', { content: content.substring(0, 200) }, 'high')
      console.warn('[Security] XSS 패턴이 감지되어 콘텐츠가 차단되었습니다.')
      return '<p>[보안상의 이유로 콘텐츠가 차단되었습니다.]</p>'
    }

    const sanitized = sanitizePostHtml(content)

    const normalized = normalizeBlankParagraphs(sanitized)

    if (normalized !== content) {
      logSecurityEvent(
        'CONTENT_SANITIZED',
        {
          originalLength: content.length,
          sanitizedLength: normalized.length,
        },
        'medium'
      )
    }

    return normalized
  }, [content, contentFormat])

  if (contentFormat === 'html') {
    return (
      <div
        className={`prose max-w-none ${className}`}
        dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
      />
    )
  }

  if (contentFormat === 'markdown') {
    return (
      <div className={`prose max-w-none ${className}`}>
        <ReactMarkdown
          components={{
            a: ({ node, href, children, ...props }) => {
              const safeHref = typeof href === 'string' ? toSafeLinkHref(href) : null
              if (!safeHref) return <span {...props}>{children}</span>

              return (
                <a href={safeHref} target="_blank" rel="noopener noreferrer" {...props}>
                  {children}
                </a>
              )
            },
            img: ({ node, src, alt, ...props }) => {
              if (!src || typeof src !== 'string') return null
              const safeHttpSrc = toSafeHttpUrl(src)
              const safeSrc = isSafeInternalPath(src)
                ? src
                : safeHttpSrc
                  ? createImageProxy(safeHttpSrc)
                  : null

              if (!safeSrc) return null

              return (
                <Image
                  src={safeSrc}
                  alt={alt || '이미지'}
                  width={800}
                  height={600}
                  style={{ maxWidth: '100%', height: 'auto' }}
                  className="rounded-lg"
                />
              )
            },
          }}
        >
          {shiftMarkdownHeadings(content)}
        </ReactMarkdown>
      </div>
    )
  }

  // Fallback for 'plain' text
  return (
    <div
      className={`prose max-w-none whitespace-pre-wrap text-gray-800 leading-relaxed ${className}`}
    >
      {content}
    </div>
  )
}

export default PostContentRenderer
