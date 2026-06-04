/**
 * 게시물 OG 이미지 API
 * 게시물의 첫 번째 이미지 첨부파일을 OG 이미지로 제공
 * 이미지가 없는 경우 기본 OG 이미지 반환
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const preferredRegion = 'icn1'

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Service Role 클라이언트 생성
function getSupabaseAdmin() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.NEXT_PUBLIC_SUPABASE_URL) {
    throw new Error('Supabase configuration missing')
  }

  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const resolvedParams = await context.params

  try {
    const postId = resolvedParams.id

    // UUID 형식 기본 검증
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    if (!uuidRegex.test(postId)) {
      console.log('[OG API] Invalid UUID format:', postId)
      return new Response(null, {
        status: 302,
        headers: {
          Location: '/images/logo/gac_og.webp',
          'Cache-Control': 'public, max-age=3600',
        },
      })
    }

    const supabase = getSupabaseAdmin()

    // 게시물 존재 확인 (공개 정책에 따라 삭제되지 않은 게시물만)
    const { data: post, error: postError } = await supabase
      .from('posts')
      .select('id, title')
      .eq('id', postId)
      .eq('is_deleted', false)
      .single()

    if (postError || !post) {
      console.log('[OG API] Post not found:', postId)
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
      console.log('[OG API] Using post image:', imageUrl)

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
    console.log('[OG API] No image found, using default OG image')
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
