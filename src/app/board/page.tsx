'use client';

import { supabase } from '../../lib/supabase/client';
import { useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import PostList from '../../components/PostList';
import CreatePostForm from '../../components/CreatePostForm';
import { usePagination } from '../../hooks/usePagination';
import { usePostsWithPagination } from '../../hooks/usePostsWithPagination';

function BoardContent() {
  const [user, setUser] = useState<any>(null);
  const [isMember, setIsMember] = useState<boolean>(false);
  const [userLoading, setUserLoading] = useState(true);
  const router = useRouter();
  const searchParams = useSearchParams();
  
  // 페이지네이션 상태 관리
  const category = searchParams.get('category') || '전체';
  const [paginationState, paginationActions] = usePagination({
    initialPage: 1,
    pageSize: 10,
    totalCount: 0,
  });
  
  // 페이지네이션된 게시글 데이터
  const { posts, totalCount, loading: postsLoading, error } = usePostsWithPagination({
    page: paginationState.currentPage,
    pageSize: paginationState.pageSize,
    category: category,
  });
  
  // 총 개수가 변경될 때마다 페이지네이션 상태 업데이트
  useEffect(() => {
    paginationActions.setTotalCount(totalCount);
  }, [totalCount, paginationActions]);

  useEffect(() => {
    let mounted = true;

    const fetchUserAndProfile = async () => {
      try {
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();

        if (sessionError) {
          console.error('Error getting session:', sessionError);
          if (mounted) {
            setUserLoading(false);
            router.replace('/login');
          }
          return;
        }

        const currentUser = session?.user || null;
        
        if (!currentUser) {
          if (mounted) {
            setUserLoading(false);
            router.replace('/login');
          }
          return;
        }

        if (mounted) {
          setUser(currentUser);
        }

        // 프로필 정보 가져오기
        const { data: profile, error: profileError } = await supabase
          .from('member_profiles')
          .select('registration_status, is_active')
          .eq('id', currentUser.id)
          .single();

        if (profileError) {
          console.error('Error fetching profile:', profileError);
          if (mounted) {
            setIsMember(false);
          }
        } else if (profile && mounted) {
          setIsMember(profile.registration_status === 'approved' && profile.is_active);
        }

        if (mounted) {
          setUserLoading(false);
        }
      } catch (e) {
        console.error('Error in fetchUserAndProfile:', e);
        if (mounted) {
          setUserLoading(false);
        }
      }
    };

    fetchUserAndProfile();

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (mounted) {
        const newUser = session?.user || null;
        setUser(newUser);
        
        if (!newUser) {
          router.replace('/login');
        }
      }
    });

    return () => {
      mounted = false;
      authListener?.subscription.unsubscribe();
    };
  }, [router]);

  const handleCategoryChange = (newCategory: string) => {
    // 카테고리 변경시 페이지를 1로 리셋
    paginationActions.goToPage(1);
    paginationActions.updateUrlParams(1, newCategory);
  };

  const handlePageChange = (page: number) => {
    paginationActions.goToPage(page);
  };

  if (userLoading) {
    return <div className="min-h-screen pt-24 md:pt-28 flex items-center justify-center">Loading...</div>;
  }

  // If not loading and no user, it means redirect should have happened.
  // This case should ideally not be reached if router.replace works.
  if (!user) {
    return null; // Or a more explicit message if redirect failed
  }

  return (
    <div className="min-h-screen bg-gray-50 pt-20 md:pt-24">
      <div className="container mx-auto px-4 py-8">
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">조합원 게시판</h1>
          <p className="text-gray-600">경기아트콜렉티브 협동조합 조합원들의 소통 공간입니다.</p>
        </div>
        
        {!isMember && user && (
          <div className="mb-6 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
            <p className="text-yellow-800">
              <strong>알림:</strong> 조합원 승인 대기 중입니다. 승인 후 게시글 작성이 가능합니다.
            </p>
          </div>
        )}
        
        {isMember && user && (
          <div className="mb-6">
            <button
              onClick={() => router.push('/board/write')}
              className="bg-primary-600 text-white px-6 py-3 rounded-lg hover:bg-primary-700 transition-colors font-medium"
            >
              새 게시글 작성
            </button>
          </div>
        )}
        <PostList 
          posts={posts} 
          currentUserId={user?.id} 
          isMember={isMember}
          currentPage={paginationState.currentPage}
          totalPages={paginationState.totalPages}
          totalCount={paginationState.totalCount}
          pageSize={paginationState.pageSize}
          loading={postsLoading}
          onPageChange={handlePageChange}
          onCategoryChange={handleCategoryChange}
        />
      </div>
    </div>
  );
}


interface Post {
  id: string;
  title: string;
  content: string;
  category: string;
  author_id: string;
  created_at: string;
}

export default function BoardPage() {
  return (
    <Suspense fallback={<div className="min-h-screen pt-24 md:pt-28 flex items-center justify-center">Loading...</div>}>
      <BoardContent />
    </Suspense>
  );
}
