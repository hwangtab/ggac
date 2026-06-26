/**
 * 게시물 관련 서버 사이드 데이터 조회 유틸리티
 * generateMetadata 및 Server Component에서 사용
 */

import { createClient } from '@supabase/supabase-js'
import type { PostAttachment } from '@/types'
import { createLogger, maskId } from '@/utils/logger'

const log = createLogger('Posts')

// Service Role 클라이언트 생성
function getSupabaseAdmin() {
  const hasUrl = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL)
  const hasSrv = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY)
  if (!hasUrl || !hasSrv) {
    log.error('Missing env for service client', { hasUrl, hasSrv })
    throw new Error('Supabase configuration missing for server-side post queries')
  }
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

// 게시물 상세 정보 인터페이스
export interface PostDetail {
  id: string
  title: string
  content: string
  category: string
  author_id: string
  created_at: string
  updated_at?: string
  view_count?: number
  is_deleted: boolean
}

// 작성자 프로필 정보 인터페이스
export interface AuthorProfile {
  id: string
  display_name: string
  profile_photo_url?: string
}

/**
 * 게시물 상세 정보 조회 (서버 사이드)
 * 공개 정책에 따라 삭제되지 않은 게시물만 조회
 */
export async function getPostById(postId: string): Promise<PostDetail | null> {
  try {
    // 기본 입력값 검증 (빈 문자열 체크)
    if (!postId || postId.trim() === '') {
      log.debug('Empty postId provided')
      return null
    }

    const supabase = getSupabaseAdmin()

    const { data: post, error } = await supabase
      .from('posts')
      .select('*')
      .eq('id', postId)
      .not('is_deleted', 'is', true)
      .single()

    if (error || !post) {
      log.debug('Post not found:', maskId(postId), error?.message)
      return null
    }

    return post as PostDetail
  } catch (error) {
    log.error('Error fetching post:', error)
    return null
  }
}

/**
 * 게시물의 작성자 프로필 조회
 */
export async function getPostAuthor(authorId: string): Promise<AuthorProfile | null> {
  try {
    const supabase = getSupabaseAdmin()

    // member_profiles 조회. profile_photo_url 컬럼은 artists 테이블에만 존재하므로
    // 여기서 select하면 PostgREST 42703 에러로 조회 전체가 실패한다. 제외한다.
    const { data: profile, error } = await supabase
      .from('member_profiles')
      .select('id, display_name')
      .eq('id', authorId)
      .maybeSingle()

    if (!profile) {
      log.debug('Author profile not found:', maskId(authorId), error?.message)
      return {
        id: authorId,
        display_name: '알 수 없는 사용자',
      }
    }

    return profile as AuthorProfile
  } catch (error) {
    log.error('Error fetching author:', error)
    return {
      id: authorId,
      display_name: '알 수 없는 사용자',
    }
  }
}

/**
 * 게시물의 첨부 이미지 목록 조회
 */
export async function getPostImages(postId: string): Promise<PostAttachment[]> {
  try {
    const supabase = getSupabaseAdmin()

    const { data: images, error } = await supabase
      .from('post_attachments')
      .select('*')
      .eq('post_id', postId)
      .eq('file_type', 'image')
      .order('is_primary', { ascending: false }) // 대표 이미지 우선
      .order('created_at', { ascending: true }) // 그 다음 업로드 순서

    if (error) {
      log.error('Error fetching images:', error)
      return []
    }

    return images || []
  } catch (error) {
    log.error('Error fetching post images:', error)
    return []
  }
}

/**
 * 게시물의 첫 번째 이미지 URL 조회
 */
export async function getPostThumbnail(postId: string): Promise<string | null> {
  try {
    const images = await getPostImages(postId)

    if (images.length > 0) {
      return images[0].file_url
    }

    return null
  } catch (error) {
    log.error('Error fetching post thumbnail:', error)
    return null
  }
}

/**
 * 게시물 내용에서 텍스트만 추출 (HTML 태그 제거)
 */
export function extractTextFromContent(content: string, maxLength: number = 150): string {
  if (!content) return ''

  // HTML 태그 제거
  const textOnly = content.replace(/<[^>]*>/g, '')

  // 연속된 공백과 줄바꿈 정리
  const cleaned = textOnly.replace(/\s+/g, ' ').trim()

  // 길이 제한
  if (cleaned.length <= maxLength) {
    return cleaned
  }

  return cleaned.substring(0, maxLength) + '...'
}

/**
 * 카테고리별 이모지 반환
 */
export function getCategoryEmoji(category: string): string {
  const categoryEmojis: Record<string, string> = {
    공지: '📢',
    잡담: '💬',
    홍보: '📣',
    건의: '💡',
  }

  return categoryEmojis[category] || '📝'
}

/**
 * 게시물의 전체 메타데이터 정보 조회
 */
// SNS 공유용 키워드 생성 함수
function generatePostKeywords(post: any, author: any): string[] {
  const keywords: string[] = []

  // 기본 사이트 키워드
  keywords.push('경기아트콜렉티브', '협동조합', '예술가 커뮤니티')

  // 카테고리 기반 키워드
  const categoryKeywords: Record<string, string[]> = {
    공지: ['공지사항', '안내', '알림'],
    잡담: ['소통', '이야기', '대화'],
    홍보: ['홍보', '프로모션', '이벤트', '공연', '전시'],
    건의: ['건의사항', '제안', '개선'],
  }

  if (post.category && categoryKeywords[post.category]) {
    keywords.push(...categoryKeywords[post.category])
  }

  // 작성자 이름 (키워드로 활용)
  if (author?.display_name) {
    keywords.push(author.display_name)
  }

  // 제목에서 의미있는 단어 추출 (3글자 이상 한글 단어)
  if (post.title) {
    const titleWords = post.title
      .replace(/[^\w가-힣\s]/g, ' ')
      .split(/\s+/)
      .filter((word: string) => word.length >= 2 && /[가-힣]/.test(word))
      .slice(0, 3) // 최대 3개만
    keywords.push(...titleWords)
  }

  // 내용에서 자주 언급되는 단어 추출 (간단한 방식)
  if (post.content) {
    const contentText = extractTextFromContent(post.content)
    const commonWords = [
      '음악',
      '공연',
      '전시',
      '작품',
      '아티스트',
      '예술',
      '창작',
      '협업',
      '프로젝트',
    ]
    const foundWords = commonWords.filter(word => contentText.includes(word))
    keywords.push(...foundWords.slice(0, 2)) // 최대 2개만
  }

  // 중복 제거 및 최대 10개로 제한
  return [...new Set(keywords)].slice(0, 10)
}

export async function getPostMetadata(postId: string) {
  try {
    // 직접 DB 조회로 단순화하여 데이터 일관성 확보
    const post = await getPostById(postId)
    if (!post) {
      return null
    }

    const [author, thumbnail] = await Promise.all([
      getPostAuthor(post.author_id),
      getPostThumbnail(postId),
    ])

    const description = extractTextFromContent(post.content)
    const categoryEmoji = getCategoryEmoji(post.category)
    const keywords = generatePostKeywords(post, author)

    // 색인 가치 판단을 위한 본문 텍스트 길이 (HTML/공백 제거 후)
    const contentTextLength = extractTextFromContent(post.content, Number.MAX_SAFE_INTEGER).length

    return { post, author, thumbnail, description, categoryEmoji, keywords, contentTextLength }
  } catch (error) {
    log.error('Error fetching post metadata:', error)
    return null
  }
}
