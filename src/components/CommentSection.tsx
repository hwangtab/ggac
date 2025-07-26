import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase/client';
import { logCommentCreated } from '@/utils/activityLogger';
import CommentLikeButton from './CommentLikeButton';

interface Comment {
  id: string;
  post_id: string;
  author_id: string;
  content: string;
  created_at: string;
  updated_at: string;
  like_count: number;
  is_liked: boolean;
}

interface Profile {
  id: string;
  display_name: string;
}

interface CommentSectionProps {
  postId: string;
  currentUserId?: string;
  isMember: boolean;
}

const CommentSection: React.FC<CommentSectionProps> = ({ postId, currentUserId, isMember }) => {
  const [comments, setComments] = useState<Comment[]>([]);
  const [newComment, setNewComment] = useState('');
  const [loading, setLoading] = useState(false);
  const [profiles, setProfiles] = useState<Record<string, string>>({});

  // 인기 댓글과 일반 댓글 분리 (3개 이상 좋아요 받은 댓글 중 최고)
  const getPopularAndRegularComments = (allComments: Comment[]) => {
    // 3개 이상 좋아요 받은 댓글들 중에서 가장 많은 좋아요 받은 댓글 찾기
    const eligibleForPopular = allComments.filter(comment => comment.like_count >= 3);
    const popularComment = eligibleForPopular.length > 0 
      ? eligibleForPopular.reduce((prev, current) => 
          (prev.like_count > current.like_count) ? prev : current
        )
      : null;

    // 인기 댓글을 제외한 나머지 댓글들 (원래 순서 유지)
    const regularComments = popularComment 
      ? allComments.filter(comment => (comment as any).id !== (popularComment as any).id)
      : allComments;

    return { popularComment, regularComments };
  };

  const fetchComments = useCallback(async () => {
    try {
      // 현재 로그인한 사용자 확인
      const { data: { user } } = await supabase.auth.getUser();

      const { data, error } = await supabase
        .from('comments')
        .select('*')
        .eq('post_id', postId)
        .order('created_at', { ascending: true });

      if (error) {
        console.error('Error fetching comments:', error);
        return;
      }

      if (data) {
        // 각 댓글의 좋아요 정보 가져오기
        const commentsWithLikes = await Promise.all(
          data.map(async (comment) => {
            // 좋아요 수 조회
            const { count: likeCount } = await supabase
              .from('comment_likes')
              .select('*', { count: 'exact', head: true })
              .eq('comment_id', (comment as any).id);

            // 현재 사용자의 좋아요 여부 조회
            let isLiked = false;
            if (user) {
              const { data: userLike } = await supabase
                .from('comment_likes')
                .select('id')
                .eq('comment_id', (comment as any).id)
                .eq('user_id', user.id)
                .single();
              
              isLiked = !!userLike;
            }

            return {
              ...comment,
              like_count: likeCount || 0,
              is_liked: isLiked
            };
          })
        );

        setComments(commentsWithLikes as any);
      }
    } catch (error) {
      console.error('Error fetching comments with likes:', error);
    }
  }, [postId]);

  const fetchProfiles = useCallback(async () => {
    const authorIds = Array.from(new Set(comments.map(comment => comment.author_id)));
    
    const { data, error } = await supabase
      .from('member_profiles')
      .select('id, display_name')
      .in('id', authorIds);

    if (data && !error) {
      const profileMap: Record<string, string> = {};
      data.forEach((profile: any) => {
        profileMap[profile.id] = profile.display_name || 'Unknown';
      });
      setProfiles(profileMap);
    }
  }, [comments]);

  useEffect(() => {
    fetchComments();
  }, [postId, fetchComments]);

  useEffect(() => {
    if (comments.length > 0) {
      fetchProfiles();
    }
  }, [comments, fetchProfiles]);

  const handleSubmitComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newComment.trim() || !currentUserId) return;

    setLoading(true);

    const { data, error } = await supabase
      .from('comments')
      .insert([{
        post_id: postId,
        author_id: currentUserId,
        content: newComment.trim()
      }])
      .select()
      .single();

    if (data && !error) {
      // 활동 로깅
      try {
        await logCommentCreated((data as any).id, postId, {
          character_count: newComment.trim().length
        });
      } catch (logError) {
        console.error('활동 로깅 오류:', logError);
        // 로깅 실패는 사용자 경험에 영향주지 않음
      }

      // 새 댓글에 좋아요 정보 추가
      const newCommentWithLikes = {
        ...data,
        like_count: 0,
        is_liked: false
      };

      setComments(prev => [...prev, newCommentWithLikes] as any);
      setNewComment('');
    } else {
      alert('댓글 작성 중 오류가 발생했습니다.');
    }

    setLoading(false);
  };

  const handleDeleteComment = async (commentId: string) => {
    if (!confirm('댓글을 삭제하시겠습니까?')) return;

    const { error } = await supabase
      .from('comments')
      .delete()
      .eq('id', commentId);

    if (!error) {
      setComments(prev => prev.filter(comment => (comment as any).id !== commentId));
    } else {
      alert('댓글 삭제 중 오류가 발생했습니다.');
    }
  };

  return (
    <div className="mt-6 border-t border-gray-200 pt-6">
      <h4 className="text-lg font-semibold mb-4">
        댓글 {comments.length}개
      </h4>

      {/* 댓글 목록 */}
      <div className="space-y-4 mb-6">
        {(() => {
          const { popularComment, regularComments } = getPopularAndRegularComments(comments);
          
          return (
            <>
              {/* 인기 댓글 */}
              {popularComment && (
                <div className="mb-6">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800">
                      ⭐ 인기 댓글
                    </span>
                    <span className="text-xs text-gray-500">
                      좋아요 {popularComment.like_count}개
                    </span>
                  </div>
                  <div className="bg-red-50 border border-red-200 p-4 rounded-lg">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="font-medium text-sm text-gray-900">
                            {profiles[popularComment.author_id] || 'Loading...'}
                          </span>
                          <span className="text-xs text-gray-500">
                            {new Date(popularComment.created_at).toLocaleDateString('ko-KR', {
                              month: 'short',
                              day: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit'
                            })}
                          </span>
                        </div>
                        <p className="text-gray-700 text-sm leading-relaxed mb-2">
                          {popularComment.content}
                        </p>
                        <div className="flex items-center gap-2">
                          <CommentLikeButton
                            commentId={popularComment.id}
                            initialLikeCount={popularComment.like_count}
                            initialIsLiked={popularComment.is_liked}
                            size="sm"
                            onLikeChange={(liked, count) => {
                              setComments(prev => prev.map(c => 
                                c.id === popularComment.id 
                                  ? { ...c, like_count: count, is_liked: liked }
                                  : c
                              ));
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
              {regularComments.map((comment) => (
                <div key={(comment as any).id} className="bg-gray-50 p-4 rounded-lg">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="font-medium text-sm text-gray-900">
                          {profiles[comment.author_id] || 'Loading...'}
                        </span>
                        <span className="text-xs text-gray-500">
                          {new Date(comment.created_at).toLocaleDateString('ko-KR', {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit'
                          })}
                        </span>
                      </div>
                      <p className="text-gray-700 text-sm leading-relaxed mb-2">
                        {comment.content}
                      </p>
                      <div className="flex items-center gap-2">
                        <CommentLikeButton
                          commentId={(comment as any).id}
                          initialLikeCount={comment.like_count}
                          initialIsLiked={comment.is_liked}
                          size="sm"
                          onLikeChange={(liked, count) => {
                            setComments(prev => prev.map(c => 
                              (c as any).id === (comment as any).id 
                                ? { ...c, like_count: count, is_liked: liked }
                                : c
                            ));
                          }}
                        />
                      </div>
                    </div>
                    {currentUserId === comment.author_id && (
                      <button
                        onClick={() => handleDeleteComment((comment as any).id)}
                        className="text-gray-400 hover:text-red-600 text-sm ml-2"
                      >
                        삭제
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </>
          );
        })()}
        
        {comments.length === 0 && (
          <p className="text-gray-500 text-center py-4">
            첫 번째 댓글을 작성해보세요.
          </p>
        )}
      </div>

      {/* 댓글 작성 폼 */}
      {isMember && currentUserId ? (
        <form onSubmit={handleSubmitComment} className="space-y-3">
          <textarea
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
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
            {!currentUserId ? '로그인 후 댓글을 작성할 수 있습니다.' : '조합원 승인 후 댓글을 작성할 수 있습니다.'}
          </p>
        </div>
      )}
    </div>
  );
};

export default CommentSection;