/**
 * 게시물 관련 서버 사이드 데이터 조회 유틸리티
 * generateMetadata 및 Server Component에서 사용
 */

import { cache } from 'react'
import type { PostAttachment } from '@/types'
import { createLogger, maskId } from '@/utils/logger'
import { getPostById as getPostByIdFromDb } from '@/db/queries/posts'
import { getProfileById } from '@/db/queries/profiles'
import { listImageAttachments } from '@/db/queries/attachments'
import { stripMarkdownSyntax } from '@/utils/textUtils'

const log = createLogger('Posts')

// 게시물 상세 정보 인터페이스
export interface PostDetail {
  id: string
  title: string
  content: string
  content_format?: string
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
 *
 * Turso 전환: `posts`는 이제 Turso가 권위다. `getPostByIdFromDb`의 null/throw
 * 계약(행 없으면 null, 조회 자체 실패면 throw)을 이 함수의 기존 try/catch가
 * 그대로 흡수한다 — 최종 결과(에러도 not-found도 전부 null)는 이전과 동일.
 */
export async function getPostById(postId: string): Promise<PostDetail | null> {
  try {
    // 기본 입력값 검증 (빈 문자열 체크)
    if (!postId || postId.trim() === '') {
      log.debug('Empty postId provided')
      return null
    }

    const post = await getPostByIdFromDb(postId, { includeDeleted: false })

    if (!post) {
      log.debug('Post not found:', maskId(postId))
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
 *
 * Turso 전환: `member_profiles`는 이제 Turso가 권위다. 프로필을 못 찾거나
 * 조회 자체가 실패하면 기존과 동일하게 "알 수 없는 사용자" 폴백을 돌려준다.
 */
export async function getPostAuthor(authorId: string): Promise<AuthorProfile | null> {
  try {
    const profile = await getProfileById(authorId)

    if (!profile) {
      log.debug('Author profile not found:', maskId(authorId))
      return {
        id: authorId,
        display_name: '알 수 없는 사용자',
      }
    }

    return { id: profile.id, display_name: profile.display_name }
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
 *
 * Turso 전환(단계 2c 후속, Task 6 확장): `post_attachments`도 이제 Turso가
 * 권위다. `listImageAttachments`가 `is_primary` 우선·`created_at` 오름차순
 * 정렬과 `file_type = 'image'` 필터를 그대로 재현한다.
 */
export async function getPostImages(postId: string): Promise<PostAttachment[]> {
  try {
    // listImageAttachments가 이미 file_type = 'image'로 필터링하므로 여기서
    // 캐스팅한다 — PostAttachmentRow.file_type은 넓은 string, PostAttachment는
    // 리터럴 유니온이라 타입만 좁혀준다(런타임 값은 항상 'image').
    return (await listImageAttachments(postId)) as PostAttachment[]
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
 *
 * `contentFormat`이 `'markdown'`일 때만 마크다운 문법(헤딩·링크·이스케이프 등)도
 * 먼저 벗겨낸다 — `createTextPreview`(`@/utils/textUtils`)와 같은 게이트.
 * 무조건 적용하면 `[x](y)`를 정당하게 쓰는 기존 평문 게시글의 meta
 * description/OG 설명이 조용히 바뀐다.
 */
export function extractTextFromContent(
  content: string,
  maxLength: number = 150,
  contentFormat?: string
): string {
  if (!content) return ''

  const source = contentFormat === 'markdown' ? stripMarkdownSyntax(content) : content

  // HTML 태그 제거
  const textOnly = source.replace(/<[^>]*>/g, '')

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
    const contentText = extractTextFromContent(post.content, 150, post.content_format)
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

// React cache(): 같은 요청에서 generateMetadata와 페이지 본문이 각각 호출해도
// DB 조회(3쿼리)는 1회만 실행된다(전수감사 P2 — 중복 호출로 왕복 2배이던 회귀 방지).
export const getPostMetadata = cache(async (postId: string) => {
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

    const description = extractTextFromContent(post.content, 150, post.content_format)
    const categoryEmoji = getCategoryEmoji(post.category)
    const keywords = generatePostKeywords(post, author)

    // 색인 가치 판단을 위한 본문 텍스트 길이 (HTML/공백 제거 후)
    const contentTextLength = extractTextFromContent(
      post.content,
      Number.MAX_SAFE_INTEGER,
      post.content_format
    ).length

    return { post, author, thumbnail, description, categoryEmoji, keywords, contentTextLength }
  } catch (error) {
    log.error('Error fetching post metadata:', error)
    return null
  }
})
