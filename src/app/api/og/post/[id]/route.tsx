/**
 * 게시물 OG 이미지 API
 * 게시물의 첫 번째 이미지 첨부파일을 OG 이미지로 제공
 * 이미지가 없는 경우 기본 OG 이미지 반환
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const preferredRegion = 'icn1'

import { NextRequest, NextResponse } from 'next/server'
import { isBlobPublicUrl } from '@/lib/storage/paths'
import { isProjectStoragePublicUrl } from '@/utils/storageUrlValidation'
import { validateUUID } from '@/utils/validation'
import { createLogger, maskId } from '@/utils/logger'
import { getPostById } from '@/db/queries/posts'
import { listImageAttachments } from '@/db/queries/attachments'

const log = createLogger('api/og/post')

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const resolvedParams = await context.params

  try {
    const postIdValidation = validateUUID(resolvedParams.id, '게시글 ID')
    if (!postIdValidation.isValid) {
      log.debug('Invalid UUID format', { postId: maskId(resolvedParams.id) })
      return new Response(null, {
        status: 302,
        headers: {
          Location: '/images/logo/gac_og.webp',
          'Cache-Control': 'public, max-age=3600',
        },
      })
    }
    const postId = postIdValidation.sanitized

    // 게시물 존재 확인 (공개 정책에 따라 삭제되지 않은 게시물만). posts·
    // 첨부(post_attachments) 둘 다 이제 Turso가 권위다(단계 2c 후속, Task 6
    // 확장).
    let post: Awaited<ReturnType<typeof getPostById>> = null
    try {
      post = await getPostById(postId, { includeDeleted: false })
    } catch (postFetchError) {
      log.debug('Post fetch failed', { postId: maskId(postId), error: postFetchError })
    }

    if (!post) {
      log.debug('Post not found', { postId: maskId(postId) })
      return new Response(null, {
        status: 302,
        headers: {
          Location: '/images/logo/gac_og.webp',
          'Cache-Control': 'public, max-age=3600',
        },
      })
    }

    // 게시물의 첫 번째 이미지 첨부파일 조회 — is_primary 우선, 그다음
    // created_at 오름차순(listImageAttachments가 그 순서를 보장한다).
    let attachments: Awaited<ReturnType<typeof listImageAttachments>> = []
    try {
      attachments = await listImageAttachments(postId)
    } catch (attachmentError) {
      console.error('[OG API] Attachment query error:', attachmentError)
      return new Response(null, {
        status: 302,
        headers: {
          Location: '/images/logo/gac_og.webp',
          'Cache-Control': 'public, max-age=3600',
        },
      })
    }

    // 이미지 첨부파일이 있는 경우 해당 이미지 반환
    if (attachments && attachments.length > 0) {
      const imageUrl = attachments[0].file_url
      if (
        !isProjectStoragePublicUrl(imageUrl, 'attachments', 'posts') &&
        !isBlobPublicUrl(imageUrl)
      ) {
        console.warn('[OG API] Unsafe attachment image URL, using default OG image')
        return new Response(null, {
          status: 302,
          headers: {
            Location: '/images/logo/gac_og.webp',
            'Cache-Control': 'public, max-age=3600',
          },
        })
      }

      log.debug('Using post image', { postId: maskId(postId) })

      return new Response(null, {
        status: 302,
        headers: {
          Location: imageUrl,
          'Cache-Control': 'public, max-age=86400', // 24시간 캐시
          'Access-Control-Allow-Origin': '*',
        },
      })
    }

    // 이미지가 없는 경우 기본 OG 이미지 반환
    log.debug('No image found, using default OG image', { postId: maskId(postId) })
    return new Response(null, {
      status: 302,
      headers: {
        Location: '/images/logo/gac_og.webp',
        'Cache-Control': 'public, max-age=86400',
      },
    })
  } catch (error) {
    console.error('[OG API] Error:', error)
    return new Response(null, {
      status: 302,
      headers: {
        Location: '/images/logo/gac_og.webp',
        'Cache-Control': 'public, max-age=3600',
      },
    })
  }
}
