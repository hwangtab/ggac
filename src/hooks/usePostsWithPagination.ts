'use client';

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase/client';
import type { Post } from '@/types';

interface UsePostsWithPaginationProps {
  page: number;
  pageSize: number;
  category?: string;
}

interface PostsResult {
  posts: Post[];
  totalCount: number;
  loading: boolean;
  error: string | null;
}

export const usePostsWithPagination = ({
  page,
  pageSize,
  category,
}: UsePostsWithPaginationProps): PostsResult => {
  const [posts, setPosts] = useState<Post[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPosts = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      // 현재 로그인한 사용자 확인
      const { data: { user } } = await supabase.auth.getUser();

      // 1. 총 개수 조회 (카테고리 필터 적용)
      let countQuery = supabase
        .from('posts')
        .select('*', { count: 'exact', head: true })
        .eq('is_deleted', false);

      if (category && category !== '전체') {
        countQuery = countQuery.eq('category', category);
      }

      const { count, error: countError } = await countQuery;

      if (countError) {
        throw countError;
      }

      setTotalCount(count || 0);

      // 2. 페이지네이션된 게시글 조회
      const startIndex = (page - 1) * pageSize;
      const endIndex = startIndex + pageSize - 1;

      let postsQuery = supabase
        .from('posts')
        .select('*')
        .eq('is_deleted', false)
        .range(startIndex, endIndex);

      // 카테고리 필터 적용
      if (category && category !== '전체') {
        postsQuery = postsQuery.eq('category', category);
      }

      // 정렬: 첫 페이지에서는 공지사항 우선, 그 다음 최신순
      if (page === 1) {
        postsQuery = postsQuery.order('created_at', { ascending: false });
      } else {
        postsQuery = postsQuery.order('created_at', { ascending: false });
      }

      const { data: postsData, error: postsError } = await postsQuery;

      if (postsError) {
        throw postsError;
      }

      // 3. 각 게시글의 좋아요 정보를 API를 통해 가져오기 (최적화된 배치 처리)
      const postsWithLikes = await Promise.all(
        (postsData || []).map(async (post) => {
          try {
            // API 라우트를 통해서 좋아요 정보 조회
            const response = await fetch(`/api/posts/${post.id}/likes`, {
              // 캐시 전략 추가로 불필요한 요청 줄이기
              cache: 'no-store',
              next: { revalidate: 30 } // 30초 캐시
            });
            
            if (response.ok) {
              const likeData = await response.json();
              return {
                ...post,
                like_count: likeData.like_count || 0,
                is_liked: likeData.is_liked || false
              } as any;
            } else {
              // API 호출 실패 시 기본값 사용
              return {
                ...post,
                like_count: 0,
                is_liked: false
              } as any;
            }
          } catch (error) {
            console.error(`좋아요 정보 조회 실패 (Post ${post.id}):`, error);
            // 에러 발생 시 기본값 사용
            return {
              ...post,
              like_count: 0,
              is_liked: false
            } as any;
          }
        })
      );

      // 공지사항 상단 고정 정렬 (첫 페이지에만 적용)
      let sortedPosts = postsWithLikes;
      if (page === 1) {
        sortedPosts = sortedPosts.sort((a, b) => {
          // 공지사항을 최상단에 고정
          if (a.category === '공지' && b.category !== '공지') return -1;
          if (a.category !== '공지' && b.category === '공지') return 1;
          
          // 같은 카테고리 내에서는 최신순
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        });
      }

      setPosts(sortedPosts);
    } catch (err) {
      console.error('Error fetching posts:', err);
      setError(err instanceof Error ? err.message : '게시글을 불러오는 중 오류가 발생했습니다.');
      setPosts([]);
      setTotalCount(0);
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, category]);

  // 실시간 업데이트 구독 (모바일에서 비활성화)
  const subscribeToChanges = useCallback(() => {
    // 모바일 디바이스나 iOS Safari에서는 WebSocket 연결을 비활성화
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    
    // 🚨 임시: 좋아요 새로고침 문제 해결을 위해 실시간 업데이트 완전 비활성화
    const disableRealtime = true;
    
    if (isMobile || isIOS || disableRealtime) {
      console.log('[REALTIME] 실시간 업데이트 비활성화됨:', { isMobile, isIOS, disableRealtime });
      return () => {}; // 빈 함수 반환
    }

    try {
      const subscription = supabase
        .channel('posts_changes')
        .on('postgres_changes', 
          { 
            event: '*', 
            schema: 'public', 
            table: 'posts' 
          }, 
          (payload) => {
            
            // 마이너 업데이트 필터링 (좋아요, 조회수 등)
            const eventType = (payload as any).eventType || (payload as any).event_type;
            const oldRecord = (payload as any).old || (payload as any).old_record;
            const newRecord = (payload as any).new || (payload as any).new_record;
            
            console.log('[REALTIME] 실시간 업데이트 수신 - 전체 페이로드:', {
              eventType,
              payload: payload,
              oldRecord: oldRecord,
              newRecord: newRecord,
              postId: newRecord?.id
            });
            
            if (eventType === 'UPDATE' && oldRecord && newRecord) {
              // 변경된 필드 분석
              const changedFields = [];
              for (const key in newRecord) {
                if (oldRecord[key] !== newRecord[key]) {
                  changedFields.push(key);
                }
              }
              
              console.log('[REALTIME] 변경된 필드들:', changedFields);
              
              // 좋아요나 조회수만 변경된 마이너 업데이트 감지 (더 안전한 방식)
              const isLikeOnlyUpdate = changedFields.length <= 2 && 
                (changedFields.includes('like_count') || changedFields.includes('updated_at'));
              
              const isViewOnlyUpdate = changedFields.length <= 2 && 
                (changedFields.includes('view_count') || changedFields.includes('updated_at'));
              
              // 중요한 필드 변경 여부 확인 (제목, 내용, 카테고리 등)
              const hasMajorFieldChanges = changedFields.some(field => 
                ['title', 'content', 'category', 'is_deleted', 'author_id'].includes(field)
              );
              
              if ((isLikeOnlyUpdate || isViewOnlyUpdate) && !hasMajorFieldChanges) {
                console.log('[REALTIME] 마이너 업데이트 감지 - 새로고침 건너뜀:', {
                  changedFields,
                  isLikeOnlyUpdate,
                  isViewOnlyUpdate,
                  postId: newRecord.id
                });
                return;
              }
              
              console.log('[REALTIME] 메이저 필드 변경 감지:', {
                changedFields,
                hasMajorFieldChanges,
                postId: newRecord.id
              });
            }
            
            console.log('[REALTIME] 메이저 업데이트 감지 - 게시글 목록 새로고침');
            fetchPosts();
          }
        )
        .subscribe();

      
      return () => {
        subscription.unsubscribe();
      };
    } catch (error) {
      console.error('❌ [REALTIME] Failed to create subscription:', error);
      return () => {};
    }
  }, [fetchPosts]);

  useEffect(() => {
    fetchPosts();
  }, [fetchPosts]);

  // 실시간 업데이트 구독 (데스크탑에서만)
  useEffect(() => {
    const unsubscribe = subscribeToChanges();
    return unsubscribe;
  }, [subscribeToChanges]);

  return {
    posts,
    totalCount,
    loading,
    error,
  };
};

// 공지사항만 별도 조회하는 훅 (첫 페이지 고정용)
export const useAnnouncementPosts = () => {
  const [announcements, setAnnouncements] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchAnnouncements = async () => {
      try {
        const { data, error } = await supabase
          .from('posts')
          .select('*')
          .eq('category', '공지')
          .eq('is_deleted', false)
          .order('created_at', { ascending: false });

        if (error) throw error;
        setAnnouncements((data as any) || []);
      } catch (err) {
        console.error('Error fetching announcements:', err);
        setAnnouncements([]);
      } finally {
        setLoading(false);
      }
    };

    fetchAnnouncements();
  }, []);

  return { announcements, loading };
};