'use client';

import { supabase } from '../../lib/supabase/client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import PostList from '../../components/PostList';
import CreatePostForm from '../../components/CreatePostForm';

interface Post {
  id: string;
  title: string;
  content: string;
  category: string;
  author_id: string;
  created_at: string;
}

export default function BoardPage() {
  const [user, setUser] = useState<any>(null);
  const [isMember, setIsMember] = useState<boolean>(false);
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true); // Add a loading state
  const router = useRouter();

  useEffect(() => {
    let mounted = true;

    const fetchUserAndPosts = async () => {
      try {
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();

        if (sessionError) {
          console.error('Error getting session:', sessionError);
          if (mounted) {
            setLoading(false);
            router.replace('/login');
          }
          return;
        }

        const currentUser = session?.user || null;
        
        if (!currentUser) {
          if (mounted) {
            setLoading(false);
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

        // 게시글 데이터 가져오기
        const { data: postsData, error: postsError } = await supabase
          .from('posts')
          .select('*')
          .order('created_at', { ascending: false });

        if (postsError) {
          console.error('Error fetching posts:', postsError);
        } else if (postsData && mounted) {
          setPosts(postsData);
        }

        if (mounted) {
          setLoading(false);
        }
      } catch (e) {
        console.error('Error in fetchUserAndPosts:', e);
        if (mounted) {
          setLoading(false);
        }
      }
    };

    fetchUserAndPosts();

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

  const handleNewPost = (newPost: Post) => {
    setPosts((prevPosts) => [newPost, ...prevPosts]);
  };

  if (loading) {
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
        <PostList posts={posts} currentUserId={user?.id} isMember={isMember} />
      </div>
    </div>
  );
}
