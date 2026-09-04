import { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getPostMetadata } from '@/lib/posts'
import PostDetailClient from './PostDetailClient'
import { Suspense } from 'react'
import { generatePostOgImage } from '@/utils/imageUrl'
import { setRequestLocale } from 'next-intl/server'
import { parseIntegerParam } from '@/utils/queryParams'
import { validateUUID } from '@/utils/validation'
import {
  generatePostStructuredData,
  generateBreadcrumbStructuredData,
  combineStructuredData,
  structuredDataToScript,
} from '@/utils/structuredData'
import { listPosts, getPostById } from '@/db/queries/posts'
import { listCommentsKeyset } from '@/db/queries/comments'
import { listAttachments } from '@/db/queries/attachments'
import { getSiteUrl } from '@/utils/site'

function normalizePostRouteId(id: string): string | null {
  const validation = validateUUID(id, '게시글 ID')
  return validation.isValid ? validation.sanitized : null
}

// 동적 메타데이터 생성
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; id: string }>
}): Promise<Metadata> {
  const resolvedParams = await params
  const postId = normalizePostRouteId(resolvedParams.id)
  if (!postId) {
    return {
      title: '게시물을 찾을 수 없습니다',
      description: '요청하신 게시물을 찾을 수 없습니다.',
      robots: { index: false, follow: true },
    }
  }

  try {
    const metadata = await getPostMetadata(postId)

    if (!metadata) {
      return {
        title: '게시물을 찾을 수 없습니다',
        description: '요청하신 게시물을 찾을 수 없습니다.',
        robots: { index: false, follow: true },
      }
    }

    const { post, author, thumbnail, description, categoryEmoji, keywords, contentTextLength } =
      metadata

    const ogTitle = `${categoryEmoji} [${post.category}] ${post.title} - 경기아트콜렉티브`
    const title = `${categoryEmoji} [${post.category}] ${post.title}`

    // OG 이미지 생성 - 통합 유틸리티 사용
    const ogImageUrl = generatePostOgImage(thumbnail)

    // Thin content는 색인 가치가 낮아 GSC "크롤링됨 - 색인 안 됨"으로 잡힘.
    // 본문이 짧거나 잡담 카테고리면 noindex 처리해 사이트 전반의 색인 품질 확보.
    const isThinContent = contentTextLength < 200
    const isLowValueCategory = post.category === '잡담'
    const shouldNoindex = isThinContent || isLowValueCategory

    return {
      title,
      description,
      keywords,
      authors: [{ name: author?.display_name || '경기아트콜렉티브' }],
      ...(shouldNoindex && {
        robots: { index: false, follow: true },
      }),
      openGraph: {
        title: ogTitle,
        description,
        url: `${getSiteUrl()}/board/${postId}`,
        siteName: '경기아트콜렉티브 협동조합',
        locale: 'ko_KR',
        images: [
          {
            url: ogImageUrl,
            width: 1200,
            height: 630,
            alt: `${post.title} - 경기아트콜렉티브`,
          },
        ],
        type: 'article',
        publishedTime: post.created_at,
        authors: [author?.display_name || '경기아트콜렉티브'],
        section: post.category,
      },
      twitter: {
        card: 'summary_large_image',
        title: ogTitle,
        description,
        images: [ogImageUrl],
      },
      alternates: {
        canonical: `/board/${postId}`,
      },
    }
  } catch (error) {
    console.error('[Metadata] Error generating metadata:', error)
    return {
      title: '게시물',
      description: '경기아트콜렉티브 협동조합 조합원들의 소통 공간입니다.',
    }
  }
}

// ISR 설정 - 게시글 상세 페이지 60초 캐시
export const revalidate = 60

// 동적 세그먼트 라우트는 generateStaticParams가 없으면 ISR이 아니라 완전 동적으로
// 취급된다(revalidate 선언이 무효). 최근 게시글은 빌드 시 프리렌더하고 나머지는
// 첫 요청 시 생성·캐시(on-demand ISR)한다. 실패 시 빈 배열이어도 on-demand ISR은 유효.
export async function generateStaticParams() {
  // posts는 이제 Turso가 권위다. `listPosts`는 `src/db/client.ts`의 지연 생성
  // Proxy를 거치므로, 자격 증명이 없는 빌드 환경에서도 모듈 로드 자체는
  // 안전하고 실제 쿼리 시점에만 던진다 — 아래 try/catch가 그 경우 빈 배열로
  // 흡수해 on-demand ISR(dynamicParams 기본 true)로 넘긴다.
  try {
    const { rows } = await listPosts({
      page: 1,
      limit: 30,
      sort: 'created_at_desc',
      includeDeleted: false,
    })
    return rows.map(row => ({ id: row.id }))
  } catch {
    return []
  }
}

interface InitialPostData {
  post: any
  comments: any[]
  attachments: any[]
  author: any
  user: UserData | null
}

interface UserData {
  id: string
  display_name: string
  profile_photo_url?: string
  is_member: boolean
  is_admin?: boolean
}

// 서버 컴포넌트: 초기 게시글 데이터를 ISR로 제공
async function getInitialPostData(
  postId: string
): Promise<(InitialPostData & { user: UserData | null }) | null> {
  try {
    // 단계 2c 후속(Task 6 확장): 게시글(+저자)·댓글에 이어 첨부도
    // Supabase에서 Turso 쿼리 계층으로 옮겼다 — 셋 다 이제 Turso다. 댓글·
    // 첨부 조회 실패는(예: 순단) 게시글 자체는 계속 렌더하고 각각 빈
    // 배열로 대체한다 — 게시글 조회 실패(아래 postResult)만 error.tsx로
    // 보내는 정책과 일관된다.
    let post: Awaited<ReturnType<typeof getPostById>> = null
    let postFetchError: unknown = null
    const [postResult, commentsRaw, attachmentsRaw] = await Promise.all([
      getPostById(postId, { includeDeleted: false })
        .then(result => ({ data: result, error: null as unknown }))
        .catch(error => ({ data: null, error })),
      listCommentsKeyset(postId, { limit: 20 }).catch(error => {
        console.error('초기 댓글 조회 실패 — 빈 배열로 대체:', error)
        return [] as Awaited<ReturnType<typeof listCommentsKeyset>>
      }),
      listAttachments(postId, { orderBy: 'created_at' }).catch(error => {
        console.error('초기 첨부 조회 실패 — 빈 배열로 대체:', error)
        return [] as Awaited<ReturnType<typeof listAttachments>>
      }),
    ])
    post = postResult.data
    postFetchError = postResult.error

    const comments = commentsRaw
    const attachments = attachmentsRaw

    if (!post) {
      // 진짜 미존재(getPostById가 null)만 404로 보낸다. 조회 자체가
      // 실패했으면(postFetchError, 연결 오류 등) throw해 error.tsx(재시도)로
      // 보낸다 — 장애를 404로 오표시하면 멀쩡한 글이 영구 소실처럼 보이고
      // 검색엔진이 404를 수집한다(전수감사 안정성 H3).
      if (!postFetchError) {
        return null
      }
      // 단, 빌드 페이즈에서는 throw가 generateStaticParams로 프리렌더되는 최근 30개
      // 페이지의 프리렌더 실패 → next build 전체 실패로 번진다(코드리뷰 CONFIRMED).
      // 빌드 중 DB 순단 시엔 해당 글만 스킵(null→on-demand ISR로 미룸)하고, 런타임
      // 장애만 error.tsx로 보낸다. dynamicParams(기본 true)로 미프리렌더 경로는
      // 첫 요청 시 생성되며 그때의 throw는 정상적으로 error.tsx로 간다.
      if (process.env.NEXT_PHASE === 'phase-production-build') {
        console.warn('빌드 중 게시글 조회 실패 — 프리렌더 스킵:', postFetchError)
        return null
      }
      console.error('서버 게시글 조회 오류:', postFetchError)
      throw postFetchError instanceof Error
        ? postFetchError
        : new Error(`게시글 조회 실패: ${String(postFetchError)}`)
    }

    const authorRecord = post.author
    const totalSize = (attachments || []).reduce(
      (sum, att) => sum + parseIntegerParam(String(att.file_size ?? ''), 0, { min: 0 }),
      0
    )

    // 사용자 상태(로그인 여부·is_liked)는 이 함수에서 조회하지 않는다.
    // cookies() 기반 세션 조회가 하나라도 섞이면 라우트 전체가 동적 렌더링으로
    // 전환되어 ISR(revalidate=60)이 사문화된다(전수감사 P2). 개인화는
    // PostDetailClient가 fetchSessionProfile·기존 likes 훅으로 복원한다.
    const commentsWithLikeState = comments.map(comment => ({
      ...comment,
      like_count: parseIntegerParam(String(comment.like_count ?? ''), 0, { min: 0 }),
      is_liked: false, // 클라이언트(useCommentLikes)가 마운트 후 복원
    }))

    return {
      post: {
        // 기존 PostgREST select와 같은 필드만 투영한다(추가 필드 노출 방지 —
        // getPostById는 posts 컬럼 전부 + 확장된 author 객체를 돌려주는
        // 상위집합이다).
        id: post.id,
        title: post.title,
        content: post.content,
        content_format: post.content_format,
        category: post.category,
        author_id: post.author_id,
        created_at: post.created_at,
        updated_at: post.updated_at,
        like_count: post.like_count,
        view_count: post.view_count,
        is_pinned: post.is_pinned,
        author: { display_name: post.author.display_name },
        is_liked: false, // 서버에서는 기본값, 클라이언트에서 업데이트
        comment_count: commentsWithLikeState.length,
        attachments_stats: {
          total_attachments: (attachments || []).length,
          total_size: totalSize,
          image_count: (attachments || []).filter(att => att.file_type === 'image').length,
          document_count: (attachments || []).filter(att => att.file_type === 'document').length,
          video_count: (attachments || []).filter(att => att.file_type === 'video').length,
          audio_count: (attachments || []).filter(att => att.file_type === 'audio').length,
        },
      },
      comments: commentsWithLikeState,
      attachments,
      author: authorRecord ? { display_name: authorRecord.display_name } : null,
      user: null,
    }
  } catch (error) {
    // 빌드 페이즈에서는 프리렌더 실패가 배포를 막으므로 해당 글만 스킵(위 주석 참조)
    if (process.env.NEXT_PHASE === 'phase-production-build') {
      console.warn('빌드 중 초기 게시글 데이터 조회 실패 — 프리렌더 스킵:', error)
      return null
    }
    // 런타임 장애는 404로 오표시하지 않도록 그대로 전파 → error.tsx(재시도)로 처리
    console.error('초기 게시글 데이터 조회 실패:', error)
    throw error
  }
}

// 서버 컴포넌트 (메타데이터 생성용)
export default async function PostDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>
}) {
  const resolvedParams = await params
  setRequestLocale(resolvedParams.locale)
  const postId = normalizePostRouteId(resolvedParams.id)
  if (!postId) {
    notFound()
  }

  // 데이터 페칭 로직을 페이지 컴포넌트에서 직접 수행
  const [metadata, initialData] = await Promise.all([
    getPostMetadata(postId).catch(() => null),
    getInitialPostData(postId),
  ])

  if (!initialData) {
    notFound()
  }
  const resolvedInitialData = initialData as InitialPostData & { user: UserData | null }

  // 구조화된 데이터 생성(메타데이터 실패 시 생략)
  const postSchema = metadata
    ? generatePostStructuredData({
        id: postId,
        title: metadata.post.title,
        content: metadata.post.content,
        category: metadata.post.category,
        created_at: metadata.post.created_at,
        updated_at: metadata.post.updated_at || metadata.post.created_at,
        author: metadata.author,
        thumbnail: metadata.thumbnail,
      })
    : null

  const breadcrumbData = metadata
    ? generateBreadcrumbStructuredData([
        { name: '홈', url: getSiteUrl() },
        { name: '게시판', url: `${getSiteUrl()}/board` },
        { name: metadata.post.title, url: `${getSiteUrl()}/board/${postId}` },
      ])
    : null

  const structuredData =
    postSchema && breadcrumbData ? combineStructuredData([postSchema, breadcrumbData]) : postSchema

  return (
    <div>
      {structuredData ? structuredDataToScript(structuredData) : null}
      {/* Suspense와 PostDetailClient를 직접 사용 */}
      <Suspense
        fallback={
          <div className="container mx-auto px-4 pt-24 md:pt-28">
            <div className="max-w-4xl mx-auto">
              <div className="h-6 w-48 bg-gray-200 rounded mb-4 animate-pulse" />
              <div className="bg-white rounded-lg shadow p-6 animate-pulse">
                <div className="w-24 h-5 bg-gray-200 rounded mb-3" />
                <div className="w-3/4 h-8 bg-gray-200 rounded mb-4" />
                <div className="w-full h-24 bg-gray-200 rounded" />
              </div>
            </div>
          </div>
        }
      >
        <PostDetailClient
          postId={postId}
          initialData={resolvedInitialData}
          initialUser={resolvedInitialData.user}
        />
      </Suspense>
    </div>
  )
}
