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
    console.log('useEffect started');
    const fetchUserAndPosts = async () => {
      console.log('fetchUserAndPosts started');
      try {
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();
        console.log('supabase.auth.getSession() result:', session, sessionError);

        if (sessionError) {
          console.error('Error getting session:', sessionError);
          setLoading(false); // Ensure loading is set to false on error
          router.replace('/login'); // Redirect if session fetch fails
          return;
        }

        const currentUser = session?.user || null; // Use a local variable for the current user
        setUser(currentUser); // Update state

        if (!currentUser) { // Check the local variable
          console.log('No user found in session, redirecting to /login');
          router.replace('/login');
          setLoading(false);
          return;
        }

        console.log('User found:', currentUser.id); // Use currentUser.id

        const { data: profile, error: profileError } = await supabase
          .from('member_profiles') // Changed from 'profiles' to 'member_profiles'
          .select('registration_status, is_active') // Changed from 'is_member'
          .eq('id', currentUser.id)
          .single();

        console.log('Profile fetch result:', profile, profileError);

        if (profileError) {
          console.error('Error fetching profile:', profileError);
        } else if (profile) {
          // is_member 대신 registration_status와 is_active 사용
          setIsMember(profile.registration_status === 'approved' && profile.is_active);
        }

        const { data: postsData, error: postsError } = await supabase
          .from('posts')
          .select('*')
          .order('created_at', { ascending: false });

        console.log('Posts fetch result:', postsData, postsError);

        if (postsError) {
          console.error('Error fetching posts:', postsError);
        } else if (postsData) {
          setPosts(postsData);
        }
        setLoading(false);
        console.log('Loading set to false');
      } catch (e) {
        console.error('Caught error in fetchUserAndPosts:', e);
        setLoading(false);
      }
    };

    fetchUserAndPosts();

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      console.log('Auth state changed:', _event, session);
      setUser(session?.user || null);
      if (!session?.user) {
        console.log('Auth state changed to no user, redirecting to /login');
        router.replace('/login');
      }
    });

    return () => {
      console.log('Auth listener unsubscribed');
      authListener?.subscription.unsubscribe();
    };
  }, [router]); // Depend on router to ensure effect re-runs if router changes (unlikely but good practice)

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
        
        {isMember && user && <CreatePostForm authorId={user.id} onNewPost={handleNewPost} />}
        <PostList posts={posts} currentUserId={user?.id} isMember={isMember} />
      </div>
    </div>
  );
}
