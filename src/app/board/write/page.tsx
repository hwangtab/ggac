'use client';

import { supabase } from '../../../lib/supabase/client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import type { MemberProfile } from '@/types';

// Lazy load the CreatePostForm component
const CreatePostForm = dynamic(() => import('../../../components/CreatePostForm'), {
  loading: () => (
    <div className="bg-white rounded-lg shadow-sm p-6">
      <div className="animate-pulse space-y-4">
        <div className="h-4 bg-gray-200 rounded w-1/4"></div>
        <div className="h-32 bg-gray-200 rounded"></div>
        <div className="h-4 bg-gray-200 rounded w-1/2"></div>
        <div className="h-10 bg-gray-200 rounded w-24"></div>
      </div>
    </div>
  )
});

export default function WritePage() {
  const [user, setUser] = useState<any>(null);
  const [isMember, setIsMember] = useState<boolean>(false);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    const fetchUserData = async () => {
      try {
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();

        if (sessionError || !session?.user) {
          router.replace('/login');
          return;
        }

        const currentUser = session.user;
        setUser(currentUser);

        const { data: profile, error: profileError } = await supabase
          .from('member_profiles')
          .select('registration_status, is_active')
          .eq('id', currentUser.id)
          .single();

        if (profileError) {
          console.error('Error fetching profile:', profileError);
        } else if (profile) {
          setIsMember((profile as MemberProfile).registration_status === 'approved' && (profile as MemberProfile).is_active);
        }

        setLoading(false);
      } catch (e) {
        console.error('Error fetching user data:', e);
        setLoading(false);
        router.replace('/login');
      }
    };

    fetchUserData();

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session?.user) {
        router.replace('/login');
      }
    });

    return () => {
      authListener?.subscription.unsubscribe();
    };
  }, [router]);

  const handlePostCreated = () => {
    router.push('/board');
  };

  if (loading) {
    return (
      <div className="min-h-screen pt-24 md:pt-28 flex items-center justify-center">
        <div className="text-lg">로딩 중...</div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  if (!isMember) {
    return (
      <div className="min-h-screen bg-gray-50 pt-20 md:pt-24">
        <div className="container mx-auto px-4 py-8">
          <div className="max-w-2xl mx-auto">
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6">
              <h1 className="text-2xl font-bold text-yellow-800 mb-4">접근 권한이 없습니다</h1>
              <p className="text-yellow-700 mb-4">
                게시글 작성은 승인된 조합원만 가능합니다. 조합원 승인을 기다려주세요.
              </p>
              <button
                onClick={() => router.push('/board')}
                className="bg-yellow-600 text-white px-4 py-2 rounded-lg hover:bg-yellow-700 transition-colors"
              >
                게시판으로 돌아가기
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 pt-20 md:pt-24 pb-16 md:pb-20">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="max-w-4xl mx-auto">
          <div className="mb-8 md:mb-12">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <h1 className="text-3xl md:text-4xl font-bold text-gray-900">게시글 작성</h1>
                <p className="text-gray-600 mt-2">새로운 게시글을 작성하고 조합원들과 소통해보세요.</p>
              </div>
              <button
                onClick={() => router.push('/board')}
                className="inline-flex items-center text-gray-600 hover:text-gray-800 transition-colors text-sm sm:text-base"
              >
                <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                게시판으로 돌아가기
              </button>
            </div>
          </div>
          
          <CreatePostForm 
            authorId={user.id} 
            onNewPost={handlePostCreated}
            showSuccessRedirect={true}
          />
        </div>
      </div>
    </div>
  );
}