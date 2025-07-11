'use client';

import { supabase } from '../../../../lib/supabase/client';
import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';

interface Post {
  id: string;
  title: string;
  content: string;
  category: string;
  author_id: string;
}

export default function PostEditPage() {
  const [post, setPost] = useState<Post | null>(null);
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

        // 작성자 확인
        if (postData.author_id !== currentUser.id) {
          setError('수정 권한이 없습니다.');
          setLoading(false);
          return;
        }

        setPost(postData);
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
  }, [postId, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!post || !user) return;

    const { error } = await supabase
      .from('posts')
      .update({
        title: post.title,
        content: post.content,
        category: post.category,
        updated_at: new Date().toISOString()
      })
      .eq('id', post.id);

    if (error) {
      alert('게시글 수정 중 오류가 발생했습니다.');
    } else {
      alert('게시글이 수정되었습니다.');
      router.push(`/board/${post.id}`);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setPost(prev => prev ? { ...prev, [name]: value } : null);
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
                게시글 수정은 승인된 조합원만 가능합니다.
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
          <div className="mb-6">
            <button
              onClick={() => router.push(`/board/${post.id}`)}
              className="text-gray-600 hover:text-gray-800 transition-colors flex items-center"
            >
              ← 게시글로 돌아가기
            </button>
          </div>

          <div className="bg-white rounded-lg shadow-md overflow-hidden">
            <form onSubmit={handleSubmit}>
              <div className="p-6 border-b border-gray-200">
                <h1 className="text-2xl font-bold text-gray-900 mb-6">게시글 수정</h1>
                
                <div className="mb-4">
                  <label htmlFor="title" className="block text-sm font-medium text-gray-700 mb-1">
                    제목
                  </label>
                  <input
                    type="text"
                    id="title"
                    name="title"
                    value={post.title}
                    onChange={handleChange}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                    required
                  />
                </div>

                <div className="mb-4">
                  <label htmlFor="category" className="block text-sm font-medium text-gray-700 mb-1">
                    카테고리
                  </label>
                  <select
                    id="category"
                    name="category"
                    value={post.category}
                    onChange={handleChange}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                    required
                  >
                    <option value="공지">공지</option>
                    <option value="잡담">잡담</option>
                    <option value="홍보">홍보</option>
                    <option value="건의">건의</option>
                  </select>
                </div>

                <div className="mb-4">
                  <label htmlFor="content" className="block text-sm font-medium text-gray-700 mb-1">
                    내용
                  </label>
                  <textarea
                    id="content"
                    name="content"
                    value={post.content}
                    onChange={handleChange}
                    rows={10}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                    required
                  />
                </div>

                <div className="flex justify-end space-x-3">
                  <button
                    type="button"
                    onClick={() => router.push(`/board/${post.id}`)}
                    className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
                  >
                    취소
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                  >
                    수정 완료
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}