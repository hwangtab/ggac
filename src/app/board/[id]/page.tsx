'use client';

import { supabase } from '../../../lib/supabase/client';
import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import CommentSection from '../../../components/CommentSection';

interface Post {
  id: string;
  title: string;
  content: string;
  category: string;
  author_id: string;
  created_at: string;
}

interface Profile {
  id: string;
  display_name: string;
  profile_image_url?: string;
}

export default function PostDetailPage() {
  const [post, setPost] = useState<Post | null>(null);
  const [authorProfile, setAuthorProfile] = useState<Profile | null>(null);
  const [user, setUser] = useState<any>(null);
  const [isMember, setIsMember] = useState<boolean>(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const params = useParams();
  const postId = params.id as string;

  useEffect(() => {
    const fetchData = async () => {
      try {
        // 사용자 인증 확인
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();

        if (sessionError || !session?.user) {
          router.replace('/login');
          return;
        }

        const currentUser = session.user;
        setUser(currentUser);

        // 사용자 권한 확인
        const { data: profile, error: profileError } = await supabase
          .from('member_profiles')
          .select('registration_status, is_active')
          .eq('id', currentUser.id)
          .single();

        if (profileError) {
          console.error('Error fetching profile:', profileError);
        } else if (profile) {
          setIsMember(profile.registration_status === 'approved' && profile.is_active);
        }

        // 게시글 가져오기
        const { data: postData, error: postError } = await supabase
          .from('posts')
          .select('*')
          .eq('id', postId)
          .single();

        if (postError) {
          setError('게시글을 찾을 수 없습니다.');
          setLoading(false);
          return;
        }

        setPost(postData);

        // 작성자 프로필 가져오기
        const { data: authorData, error: authorError } = await supabase
          .from('member_profiles')
          .select('id, display_name, profile_image_url')
          .eq('id', postData.author_id)
          .single();

        if (!authorError && authorData) {
          setAuthorProfile(authorData);
        }

        setLoading(false);
      } catch (e) {
        console.error('Error fetching data:', e);
        setError('데이터를 불러오는 중 오류가 발생했습니다.');
        setLoading(false);
      }
    };

    if (postId) {
      fetchData();
    }

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session?.user) {
        router.replace('/login');
      }
    });

    return () => {
      authListener?.subscription.unsubscribe();
    };
  }, [postId, router]);

  const handleDeletePost = async () => {
    if (!post || !user || post.author_id !== user.id) return;

    if (!confirm('정말로 이 게시글을 삭제하시겠습니까?')) return;

    const { error } = await supabase
      .from('posts')
      .delete()
      .eq('id', post.id);

    if (error) {
      alert('게시글 삭제 중 오류가 발생했습니다.');
    } else {
      alert('게시글이 삭제되었습니다.');
      router.push('/board');
    }
  };

  const handleEditPost = () => {
    if (!post || !user || post.author_id !== user.id) return;
    router.push(`/board/${post.id}/edit`);
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('ko-KR', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getCategoryColor = (category: string) => {
    switch (category) {
      case '공지':
        return 'bg-red-100 text-red-800';
      case '잡담':
        return 'bg-blue-100 text-blue-800';
      case '홍보':
        return 'bg-green-100 text-green-800';
      case '건의':
        return 'bg-yellow-100 text-yellow-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen pt-24 md:pt-28 flex items-center justify-center">
        <div className="text-lg">로딩 중...</div>
      </div>
    );
  }

  if (error || !post) {
    return (
      <div className="min-h-screen bg-gray-50 pt-20 md:pt-24">
        <div className="container mx-auto px-4 py-8">
          <div className="max-w-4xl mx-auto">
            <div className="bg-red-50 border border-red-200 rounded-lg p-6">
              <h1 className="text-2xl font-bold text-red-800 mb-4">오류</h1>
              <p className="text-red-700 mb-4">{error || '게시글을 찾을 수 없습니다.'}</p>
              <button
                onClick={() => router.push('/board')}
                className="bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 transition-colors"
              >
                게시판으로 돌아가기
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isMember) {
    return (
      <div className="min-h-screen bg-gray-50 pt-20 md:pt-24">
        <div className="container mx-auto px-4 py-8">
          <div className="max-w-4xl mx-auto">
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6">
              <h1 className="text-2xl font-bold text-yellow-800 mb-4">접근 권한이 없습니다</h1>
              <p className="text-yellow-700 mb-4">
                게시글 열람은 승인된 조합원만 가능합니다.
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
    <div className="min-h-screen bg-gray-50 pt-20 md:pt-24">
      <div className="container mx-auto px-4 py-8">
        <div className="max-w-4xl mx-auto">
          {/* 뒤로가기 버튼 */}
          <div className="mb-6">
            <button
              onClick={() => router.push('/board')}
              className="text-gray-600 hover:text-gray-800 transition-colors flex items-center"
            >
              ← 게시판으로 돌아가기
            </button>
          </div>

          {/* 게시글 내용 */}
          <div className="bg-white rounded-lg shadow-md overflow-hidden">
            {/* 게시글 헤더 */}
            <div className="p-6 border-b border-gray-200">
              <div className="flex items-center justify-between mb-4">
                <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${getCategoryColor(post.category)}`}>
                  {post.category}
                </span>
                {user && post.author_id === user.id && (
                  <div className="flex space-x-2">
                    <button
                      onClick={handleEditPost}
                      className="text-blue-600 hover:text-blue-800 text-sm"
                    >
                      수정
                    </button>
                    <button
                      onClick={handleDeletePost}
                      className="text-red-600 hover:text-red-800 text-sm"
                    >
                      삭제
                    </button>
                  </div>
                )}
              </div>
              
              <h1 className="text-3xl font-bold text-gray-900 mb-4">{post.title}</h1>
              
              <div className="flex items-center space-x-4 text-sm text-gray-600">
                <div className="flex items-center space-x-2">
                  {authorProfile?.profile_image_url ? (
                    <img
                      src={authorProfile.profile_image_url}
                      alt={authorProfile.display_name}
                      className="w-8 h-8 rounded-full"
                    />
                  ) : (
                    <div className="w-8 h-8 bg-gray-300 rounded-full flex items-center justify-center">
                      <span className="text-gray-600 text-sm">
                        {authorProfile?.display_name?.charAt(0) || '?'}
                      </span>
                    </div>
                  )}
                  <span className="font-medium">{authorProfile?.display_name || '알 수 없음'}</span>
                </div>
                <span>•</span>
                <span>{formatDate(post.created_at)}</span>
              </div>
            </div>

            {/* 게시글 본문 */}
            <div className="p-6">
              <div className="prose max-w-none">
                <div className="whitespace-pre-wrap text-gray-800 leading-relaxed">
                  {post.content}
                </div>
              </div>
            </div>
          </div>

          {/* 댓글 섹션 */}
          <div className="mt-8">
            <CommentSection postId={post.id} currentUserId={user?.id} isMember={isMember} />
          </div>
        </div>
      </div>
    </div>
  );
}