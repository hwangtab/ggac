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

      // 3. 각 게시글의 좋아요 정보 가져오기
      const postsWithLikes = await Promise.all(
        (postsData || []).map(async (post) => {
          // 좋아요 수 조회
          const { count: likeCount } = await supabase
            .from('post_likes')
            .select('*', { count: 'exact', head: true })
            .eq('post_id', post.id);

          // 현재 사용자의 좋아요 여부 조회
          let isLiked = false;
          if (user) {
            const { data: userLike } = await supabase
              .from('post_likes')
              .select('id')
              .eq('post_id', post.id)
              .eq('user_id', user.id)
              .single();
            
            isLiked = !!userLike;
          }

          return {
            ...post,
            like_count: likeCount || 0,
            is_liked: isLiked
          };
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
    
    if (isMobile || isIOS) {
      console.log('📱 [REALTIME] Skipping realtime subscription on mobile device');
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
            console.log('Posts changed:', payload);
            // 현재 페이지를 다시 로드
            fetchPosts();
          }
        )
        .subscribe();

      console.log('🔄 [REALTIME] Subscription activated for desktop');
      
      return () => {
        console.log('🔄 [REALTIME] Unsubscribing from posts changes');
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
        setAnnouncements(data || []);
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