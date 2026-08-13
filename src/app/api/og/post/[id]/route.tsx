/**
 * 게시물 OG 이미지 API
 * 게시물의 첫 번째 이미지 첨부파일을 OG 이미지로 제공
 * 이미지가 없는 경우 기본 OG 이미지 반환
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const preferredRegion = 'icn1'

import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/server/supabaseAdmin'
import { isBlobPublicUrl } from '@/lib/storage/paths'
import { isProjectStoragePublicUrl } from '@/utils/storageUrlValidation'
import { validateUUID } from '@/utils/validation'
import { createLogger, maskId } from '@/utils/logger'

const log = createLogger('api/og/post')

// Service Role 클라이언트 생성
function getSupabaseAdmin() {
  return createServiceRoleClient()
}

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

    const supabase = getSupabaseAdmin()

    // 게시물 존재 확인 (공개 정책에 따라 삭제되지 않은 게시물만)
    const { data: post, error: postError } = await supabase
      .from('posts')
      .select('id, title')
      .eq('id', postId)
      .eq('is_deleted', false)
      .single()

    if (postError || !post) {
      log.debug('Post not found', { postId: maskId(postId) })
      return new Response(null, {
        status: 302,
        headers: {
          Location: '/images/logo/gac_og.webp',
          'Cache-Control': 'public, max-age=3600',
        },
      })
    }

    // 게시물의 첫 번째 이미지 첨부파일 조회
    const { data: attachments, error: attachmentError } = await supabase
      .from('post_attachments')
      .select('file_url, is_primary')
      .eq('post_id', postId)
      .eq('file_type', 'image')
      .order('is_primary', { ascending: false }) // 대표 이미지 우선
      .order('created_at', { ascending: true }) // 그 다음 업로드 순서
      .limit(1)

    if (attachmentError) {
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
