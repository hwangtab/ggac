'use client'

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { logCommentCreated } from '@/utils/activityLogger'
import CommentLikeButton from './CommentLikeButton'
import type { CommentWithLikes } from '@/types'

interface Profile {
  id: string
  display_name: string
}

// 단계 2c(Task 6): comments/comment_likes가 Turso로 전환되며, 브라우저에서
// Supabase 테이블을 직접 읽던 경로(`supabase.from('comments')...`,
// `supabase.from('comment_likes')...`)를 `/api/posts/[id]/comments-list`
// 서버 API 호출로 대체했다. is_liked/like_count는 이제 그 라우트가
// 로그인 세션(쿠키, Better Auth)을 근거로 서버에서 정확히 계산해 내려준다 —
// 클라이언트가 comment_likes 테이블을 직접 조회할 필요가 없어졌다. 이 값은
// 그 API의 PAGE_SIZE_MAX(100, `src/app/api/posts/[id]/comments-list/route.ts`)와
// 맞춘 상한이다 — 회원 23명 규모 커뮤니티에서 게시글 하나의 댓글이 100건을
// 넘는 경우는 실질적으로 없다.
const COMMENT_FETCH_LIMIT = 100

async function fetchCommentsFromApi(postId: string): Promise<CommentWithLikes[]> {
  const res = await fetch(`/api/posts/${postId}/comments-list?limit=${COMMENT_FETCH_LIMIT}`)
  if (!res.ok) {
    throw new Error(`댓글 조회 실패: ${res.status}`)
  }
  const json = await res.json()
  // 리뷰 대응(3차): 무제한 조회이던 것이 COMMENT_FETCH_LIMIT(100)으로 상한이
  // 생겼다 — 101번째 댓글부터는 이 호출이 조용히 빠뜨린다(초기 전체 조회
  // 경로에서는 그 댓글 자체가, 좋아요 상태 병합 경로에서는 그 댓글의 is_liked
  // 갱신이). 서버가 내려주는 has_next로 실제로 잘렸는지 확인해 개발자가 알
  // 수 있게 로그만 남긴다 — 회원 23명 규모에선 실질적으로 안 일어나지만,
  // 조용히 사라지는 것보다는 낫다.
  if (json?.data?.has_next) {
    console.warn(
      `[CommentSection] 댓글이 ${COMMENT_FETCH_LIMIT}건을 넘어 일부만 불러왔습니다(postId=${postId}). ${COMMENT_FETCH_LIMIT + 1}번째 이후 댓글은 좋아요 상태 병합 또는 초기 목록에서 빠질 수 있습니다.`
    )
  }
  return (json?.data?.comments as CommentWithLikes[] | undefined) || []
}

interface CommentSectionProps {
  postId: string
  currentUserId?: string
  isMember: boolean
  initialComments?: CommentWithLikes[]
}

const CommentSection: React.FC<CommentSectionProps> = ({
  postId,
  currentUserId,
  isMember,
  initialComments,
}) => {
  const [comments, setComments] = useState<CommentWithLikes[]>(initialComments || [])
  const [newComment, setNewComment] = useState('')
  const [loading, setLoading] = useState(false)
  const [profiles, setProfiles] = useState<Record<string, string>>({})

  // 인기 댓글과 일반 댓글 분리 (3개 이상 좋아요 받은 댓글 중 최고)
  const getPopularAndRegularComments = (allComments: CommentWithLikes[]) => {
    // 3개 이상 좋아요 받은 댓글들 중에서 가장 많은 좋아요 받은 댓글 찾기
    const eligibleForPopular = allComments.filter(comment => comment.like_count >= 3)
    const popularComment =
      eligibleForPopular.length > 0
        ? eligibleForPopular.reduce((prev, current) =>
            prev.like_count > current.like_count ? prev : current
          )
        : null

    // 인기 댓글을 제외한 나머지 댓글들 (원래 순서 유지)
    const regularComments = popularComment
      ? allComments.filter(comment => comment.id !== popularComment.id)
      : allComments

    return { popularComment, regularComments }
  }

  const fetchComments = useCallback(async () => {
    try {
      // 서버(`/api/posts/[id]/comments-list`)가 이미 로그인 세션(쿠키)을
      // 근거로 like_count/is_liked를 정확히 계산해 내려준다 — 브라우저에서
      // comments/comment_likes 테이블을 직접 배치 조회할 필요가 없다.
      const rows = await fetchCommentsFromApi(postId)
      setComments(rows)
    } catch (error) {
      console.error('Error fetching comments with likes:', error)
    }
  }, [postId])

  const fetchProfiles = useCallback(async () => {
    const authorIds = Array.from(new Set(comments.map(comment => comment.author_id)))
    if (authorIds.length === 0) return

    try {
      const res = await fetch(`/api/profiles?ids=${encodeURIComponent(authorIds.join(','))}`)
      if (!res.ok) return
      const json = await res.json()
      if (json?.success && Array.isArray(json.data)) {
        const profileMap: Record<string, string> = {}
        json.data.forEach((p: any) => {
          profileMap[p.id] = p.display_name || '알 수 없는 사용자'
        })
        setProfiles(prev => ({ ...prev, ...profileMap }))
      }
    } catch (_) {
      // 네트워크 오류는 무시하고 기본 표시 유지
    }
  }, [comments])

  useEffect(() => {
    if (!initialComments) {
      // 초기 데이터가 없을 때만 전체 네트워크 조회(좋아요 상태 포함)
      fetchComments()
      return
    }

    // 초기 데이터가 제공되면 전체 조회는 생략하되, 작성자명을 즉시 매핑
    setComments(initialComments)
    const initialMap: Record<string, string> = {}
    ;(initialComments as any[]).forEach(c => {
      const name = c?.author?.display_name || c?.author?.name
      if (name) initialMap[c.author_id] = name
    })
    if (Object.keys(initialMap).length > 0) {
      setProfiles(prev => ({ ...prev, ...initialMap }))
    }

    // 상세 페이지 서버 셸은 ISR 캐시를 위해 is_liked를 채우지 않고 내려준다
    // (is_liked:false). 그래서 로그인 사용자에 한해 초기 댓글의 좋아요 상태를
    // 여기서 서버(comments-list API)에서 다시 조회해 병합한다 — 이게 없으면
    // 이미 좋아요한 댓글이 빈 하트로 표시되고, 다시 누르면 토글 RPC가 기존
    // 좋아요를 삭제해 버린다. currentUserId는 PostDetailClient가 세션 복원
    // 후 채우므로 그 시점에 effect가 재실행된다.
    //
    // 리뷰 대응(3차): liked인 것만 `true`로 덮어쓴다(옛 Supabase 구현과 동일
    // 방향) — like_count는 건드리지 않는다. SSR이 이미 정확한 like_count를
    // 내려주고(Task 6에서 재계산 방식으로 고쳐 항상 정확하다), 이 병합은
    // ISR 캐시가 생략한 is_liked만 채우는 게 목적이다. 양방향으로 덮으면
    // (is_liked/like_count를 이 fetch 시점의 스냅샷으로 무조건 교체) 이
    // 요청이 늦게 도착했을 때 그 사이 사용자가 낙관적으로 누른 좋아요를
    // 되돌려버린다 — 이 fetch는 요청 시작 시점의 낡은 스냅샷이라, 사용자의
    // 방금 클릭보다 먼저 만들어졌을 수 있기 때문이다. `true`만 덮는 단방향
    // 갱신은 이미 좋아요한 댓글을 놓치지 않는 목적은 그대로 달성하면서
    // 이 역전을 만들지 않는다(false로는 절대 덮지 않으므로 낙관적 토글이
    // 방금 true로 바꾼 값을 이 fetch가 되돌릴 수 없다).
    //
    // 남은 비효율(의도적으로 손대지 않음): is_liked만 필요한데 댓글 본문
    // 전체(최대 100건)를 다시 받는다 — 옛 Supabase 구현은 comment_likes의
    // id만 골라 받는 경량 조회였다. 전용 경량 엔드포인트(예: comment id
    // 배열 → 좋아요한 id 집합만 반환)를 새로 만들면 해결되지만, 새 공개
    // API 라우트 하나(인증·레이트리밋 배선 포함)를 추가하는 일이라 이번
    // 리뷰 라운드의 Minor 항목 범위를 넘는다고 판단했다 — "댓글 더보기"마다
    // 재실행되는 게 아니라 이 effect는 postId/currentUserId가 바뀔 때만
    // 도는데, initialComments가 바뀌어도 이 effect의 의존성 배열엔
    // initialComments가 들어있어 loadMore로 댓글이 늘어날 때마다도 다시
    // 실행된다는 점은 사실이다(회원 23명 커뮤니티 규모에서 댓글 최대
    // 100건 재조회의 실제 비용은 낮다고 보지만, 트래픽이 커지면 재검토
    // 대상).
    if (!currentUserId || initialComments.length === 0) return
    let cancelled = false
    ;(async () => {
      try {
        const rows = await fetchCommentsFromApi(postId)
        if (cancelled || rows.length === 0) return
        const likedIds = new Set(rows.filter(row => row.is_liked).map(row => row.id))
        if (likedIds.size === 0) return
        setComments(prev => prev.map(c => (likedIds.has(c.id) ? { ...c, is_liked: true } : c)))
      } catch (error) {
        // 네트워크 오류는 무시 — is_liked:false로 남고, 실제로 좋아요한
        // 댓글을 다시 누르면 서버가 진짜 상태로 토글해 자연 복구된다.
        console.error('초기 댓글 좋아요 상태 병합 실패:', error)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [postId, fetchComments, initialComments, currentUserId])

  useEffect(() => {
    if (comments.length > 0) {
      fetchProfiles()
    }
  }, [comments, fetchProfiles])

  const handleSubmitComment = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newComment.trim() || !currentUserId) return

    setLoading(true)

    try {
      const res = await fetch(`/api/posts/${postId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: newComment.trim() }),
      })
      if (!res.ok) throw new Error('댓글 작성 실패')
      const { data } = await res.json()
      // 활동 로깅
      try {
        await logCommentCreated((data as any).id, postId, {
          character_count: newComment.trim().length,
        })
      } catch (logError) {
        console.error('활동 로깅 오류:', logError)
        // 로깅 실패는 사용자 경험에 영향주지 않음
      }

      // 새 댓글에 좋아요 정보 추가
      const newCommentWithLikes = {
        ...data,
        like_count: 0,
        is_liked: false,
      }

      setComments(prev => [...prev, newCommentWithLikes as CommentWithLikes])
      setNewComment('')
    } catch (err) {
      console.error(err)
      alert('댓글 작성 중 오류가 발생했습니다.')
    } finally {
      setLoading(false)
    }
  }

  const handleDeleteComment = async (commentId: string) => {
    if (!confirm('댓글을 삭제하시겠습니까?')) return

    try {
      const res = await fetch(`/api/posts/${postId}/comments/${commentId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('삭제 실패')
      setComments(prev => prev.filter(comment => comment.id !== commentId))
    } catch (e) {
      alert('댓글 삭제 중 오류가 발생했습니다.')
    }
  }

  const { popularComment, regularComments } = useMemo(
    () => getPopularAndRegularComments(comments),
    [comments]
  )

  return (
    <div className="mt-6 border-t border-gray-200 pt-6">
      <h4 className="text-lg font-semibold mb-4">댓글 {comments.length}개</h4>

      {/* 댓글 목록 */}
      <div className="space-y-4 mb-6">
        <>
          {/* 인기 댓글 */}
          {popularComment && (
            <div className="mb-6">
              <div className="flex items-center gap-2 mb-3">
                <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800">
                  ⭐ 인기 댓글
                </span>
                <span className="text-xs text-gray-500">좋아요 {popularComment.like_count}개</span>
              </div>
              <div className="bg-red-50 border border-red-200 p-4 rounded-lg">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="font-medium text-sm text-gray-900">
                        {(popularComment as any)?.author?.display_name ||
                          profiles[popularComment.author_id] ||
                          '알 수 없는 사용자'}
                      </span>
                      <span className="text-xs text-gray-500">
                        {new Date(popularComment.created_at).toLocaleDateString('ko-KR', {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>
                    <p className="text-gray-700 text-sm leading-relaxed mb-2 whitespace-pre-line">
                      {popularComment.content}
                    </p>
                    <div className="flex items-center gap-2">
                      <CommentLikeButton
                        commentId={popularComment.id}
                        initialLikeCount={popularComment.like_count}
                        initialIsLiked={popularComment.is_liked}
                        size="sm"
                        onLikeChange={(liked, count) => {
                          setComments(prev =>
                            prev.map(c =>
                              c.id === popularComment.id
                                ? { ...c, like_count: count, is_liked: liked }
                                : c
                            )
                          )
                        }}
                      />
                    </div>
                  </div>
                  {currentUserId === popularComment.author_id && (
                    <button
                      onClick={() => handleDeleteComment(popularComment.id)}
                      className="text-gray-400 hover:text-red-600 text-sm ml-2"
                    >
                      삭제
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* 일반 댓글들 */}
          {regularComments.map(comment => (
            <div key={comment.id} className="bg-gray-50 p-4 rounded-lg">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="font-medium text-sm text-gray-900">
                      {(comment as any)?.author?.display_name ||
                        profiles[comment.author_id] ||
                        '알 수 없는 사용자'}
                    </span>
                    <span className="text-xs text-gray-500">
                      {new Date(comment.created_at).toLocaleDateString('ko-KR', {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                  <p className="text-gray-700 text-sm leading-relaxed mb-2 whitespace-pre-line">
                    {comment.content}
                  </p>
                  <div className="flex items-center gap-2">
                    <CommentLikeButton
                      commentId={comment.id}
                      initialLikeCount={comment.like_count}
                      initialIsLiked={comment.is_liked}
                      size="sm"
                      onLikeChange={(liked, count) => {
                        setComments(prev =>
                          prev.map(c =>
                            c.id === comment.id ? { ...c, like_count: count, is_liked: liked } : c
                          )
                        )
                      }}
                    />
                  </div>
                </div>
                {currentUserId === comment.author_id && (
                  <button
                    onClick={() => handleDeleteComment(comment.id)}
                    className="text-gray-400 hover:text-red-600 text-sm ml-2"
                  >
                    삭제
                  </button>
                )}
              </div>
            </div>
          ))}
        </>

        {comments.length === 0 && (
          <p className="text-gray-500 text-center py-4">첫 번째 댓글을 작성해보세요.</p>
        )}
      </div>

      {/* 댓글 작성 폼 */}
      {isMember && currentUserId ? (
        <form onSubmit={handleSubmitComment} className="space-y-3">
          <textarea
            value={newComment}
            onChange={e => setNewComment(e.target.value)}
            placeholder="댓글을 작성해주세요..."
            className="w-full p-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 resize-none"
            rows={3}
            disabled={loading}
          />
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={loading || !newComment.trim()}
              className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
            >
              {loading ? '작성 중...' : '댓글 작성'}
            </button>
          </div>
        </form>
      ) : (
        <div className="text-center py-4">
          <p className="text-gray-500 text-sm">
            {!currentUserId
              ? '로그인 후 댓글을 작성할 수 있습니다.'
              : '조합원 승인 후 댓글을 작성할 수 있습니다.'}
          </p>
        </div>
      )}
    </div>
  )
}

export default CommentSection
