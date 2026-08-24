import { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { validateUUID } from '@/utils/validation'
import { createLogger } from '@/utils/logger'
import { parseIntegerParam } from '@/utils/queryParams'
import { getPostById } from '@/db/queries/posts'

// `dynamic = 'force-dynamic'` 적용으로 ISR `revalidate`는 의미 없음 — 헤더로 캐시 제어.
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const preferredRegion = 'icn1'

const log = createLogger('api/board/post')

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: postId } = await params

  const uuidValidation = validateUUID(postId, '게시글 ID')
  if (!uuidValidation.isValid) {
    return ApiError.badRequest(
      uuidValidation.errors[0] || '잘못된 게시글 ID 형식입니다.'
    ).toNextResponse()
  }
  const validPostId = uuidValidation.sanitized

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anonKey) {
    log.error('Supabase 환경변수 누락', { hasUrl: Boolean(url), hasAnonKey: Boolean(anonKey) })
    return ApiError.internalServerError('Supabase credentials not configured').toNextResponse()
  }

  const supabase = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  try {
    const timings: Record<string, number> = {}
    const t0 = Date.now()

    const COMMENTS_PAGE_SIZE = 20
    const commentsQuery = supabase
      .from('comments')
      .select(
        `
        id,
        content,
        author_id,
        created_at,
        author:member_profiles!comments_author_id_fkey (display_name)
      `
      )
      .eq('post_id', validPostId)
      .order('created_at', { ascending: true })
      .range(0, COMMENTS_PAGE_SIZE - 1)

    const attachmentsQuery = supabase
      .from('post_attachments')
      .select('file_url, file_type, file_size, is_primary, created_at')
      .eq('post_id', validPostId)
      .order('created_at', { ascending: true })

    const t1 = Date.now()
    // posts/member_profiles(저자) 조회는 Turso(getPostById)로, 댓글/첨부는
    // 아직 Supabase가 권위라 그대로 병렬 실행한다.
    const [fullPost, commentsRes, attachmentsRes] = await Promise.all([
      getPostById(validPostId, { includeDeleted: false }).catch(() => null),
      commentsQuery,
      attachmentsQuery,
    ])
    const t2 = Date.now()

    interface AttachmentRow {
      file_url: string
      file_type: string
      file_size: number | string | null
      is_primary: boolean | null
      created_at: string
    }

    const post = fullPost
      ? {
          id: fullPost.id,
          title: fullPost.title,
          category: fullPost.category,
          author_id: fullPost.author_id,
          created_at: fullPost.created_at,
          author: { display_name: fullPost.author.display_name },
        }
      : null
    const comments = (commentsRes.data as unknown[]) || []
    const attachments = (attachmentsRes.data as AttachmentRow[]) || []

    timings.queue_ms = t1 - t0
    timings.query_ms = t2 - t1

    if (!post) {
      log.warn('게시글 조회 실패 또는 없음', {
        commentsCount: comments.length,
        attachmentsCount: attachments.length,
      })
      return ApiError.notFound('Post not found').toNextResponse()
    }

    const totalSize = attachments.reduce(
      (sum, att) => sum + parseIntegerParam(String(att.file_size ?? ''), 0, { min: 0 }),
      0
    )

    const payload = {
      post: {
        ...post,
        is_liked: false,
        comment_count: comments.length,
        attachments_stats: {
          total_attachments: attachments.length,
          total_size: totalSize,
          image_count: attachments.filter(att => att.file_type === 'image').length,
          document_count: attachments.filter(att => att.file_type === 'document').length,
          video_count: attachments.filter(att => att.file_type === 'video').length,
          audio_count: attachments.filter(att => att.file_type === 'audio').length,
        },
      },
      comments,
      attachments,
      author: (post as { author?: unknown }).author,
    }

    const extraHeaders: Record<string, string> = {}
    if (process.env.POST_DETAIL_TIMING === '1') {
      extraHeaders['x-debug-timing'] = JSON.stringify(timings)
    }
    return ApiSuccess.ok(payload).toNextResponse({
      cacheControl: 'public, s-maxage=60, stale-while-revalidate=300',
      extraHeaders,
    })
  } catch (e) {
    log.error('예상치 못한 오류', e)
    return ApiError.internalServerError('Failed to fetch post detail').toNextResponse()
  }
}
