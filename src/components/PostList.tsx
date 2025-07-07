import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../lib/supabase/client';
import CommentSection from './CommentSection';

interface Post {
  id: string;
  title: string;
  content: string;
  category: string;
  author_id: string;
  created_at: string;
}

interface PostListProps {
  posts: Post[];
  currentUserId?: string;
  isMember: boolean;
}

interface Profile {
  id: string;
  display_name: string;
}

const PostList: React.FC<PostListProps> = ({ posts, currentUserId, isMember }) => {
  const [profiles, setProfiles] = useState<Record<string, string>>({});
  const [selectedCategory, setSelectedCategory] = useState<string>('전체');
  const [expandedPosts, setExpandedPosts] = useState<Set<string>>(new Set());
  const router = useRouter();

  const categories = ['전체', '공지', '잡담', '홍보', '건의'];

  useEffect(() => {
    const fetchProfiles = async () => {
      const authorIds = Array.from(new Set(posts.map(post => post.author_id)));
      if (authorIds.length === 0) return;

      const { data, error } = await supabase
        .from('member_profiles')
        .select('id, display_name')
        .in('id', authorIds);

      if (data && !error) {
        const profileMap: Record<string, string> = {};
        data.forEach((profile: Profile) => {
          profileMap[profile.id] = profile.display_name || 'Unknown';
        });
        setProfiles(profileMap);
      }
    };

    fetchProfiles();
  }, [posts]);

  const filteredPosts = selectedCategory === '전체' 
    ? posts 
    : posts.filter(post => post.category === selectedCategory);

  const getCategoryBadgeColor = (category: string) => {
    switch (category) {
      case '공지': return 'bg-red-100 text-red-800';
      case '잡담': return 'bg-blue-100 text-blue-800';
      case '홍보': return 'bg-green-100 text-green-800';
      case '건의': return 'bg-yellow-100 text-yellow-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  // 공지사항을 상단에 고정
  const sortedPosts = filteredPosts.sort((a, b) => {
    if (a.category === '공지' && b.category !== '공지') return -1;
    if (a.category !== '공지' && b.category === '공지') return 1;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  const toggleComments = (postId: string) => {
    setExpandedPosts(prev => {
      const newSet = new Set(prev);
      if (newSet.has(postId)) {
        newSet.delete(postId);
      } else {
        newSet.add(postId);
      }
      return newSet;
    });
  };

  return (
    <div className="mt-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-6">
        <h2 className="text-2xl font-semibold mb-4 sm:mb-0">게시글 목록</h2>
        <div className="flex flex-wrap gap-2">
          {categories.map((category) => (
            <button
              key={category}
              onClick={() => setSelectedCategory(category)}
              className={`px-3 py-1 rounded-full text-sm font-medium transition-colors ${
                selectedCategory === category
                  ? 'bg-primary-600 text-white'
                  : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
              }`}
            >
              {category}
            </button>
          ))}
        </div>
      </div>
      
      {
        sortedPosts.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-gray-500">
              {selectedCategory === '전체' ? '게시글이 없습니다.' : `${selectedCategory} 게시글이 없습니다.`}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {sortedPosts.map((post) => (
              <div key={post.id} className="bg-white p-6 rounded-lg shadow-md hover:shadow-lg transition-shadow">
                <div className="flex items-center gap-2 mb-2">
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${getCategoryBadgeColor(post.category)}`}>
                    {post.category}
                  </span>
                  {post.category === '공지' && (
                    <span className="text-red-600 text-xs font-bold">📌</span>
                  )}
                </div>
                <h3 
                  className="text-xl font-bold text-gray-900 mb-2 cursor-pointer hover:text-primary-600 transition-colors"
                  onClick={() => router.push(`/board/${post.id}`)}
                >
                  {post.title}
                </h3>
                {isMember ? (
                  <div 
                    className="text-gray-700 mt-2 leading-relaxed cursor-pointer hover:bg-gray-50 p-2 rounded transition-colors"
                    onClick={() => router.push(`/board/${post.id}`)}
                  >
                    <p className="line-clamp-3">
                      {post.content.length > 150 ? `${post.content.substring(0, 150)}...` : post.content}
                    </p>
                    {post.content.length > 150 && (
                      <span className="text-primary-600 text-sm mt-1 inline-block">더 보기</span>
                    )}
                  </div>
                ) : (
                  <div className="mt-2 p-4 bg-gray-100 rounded-md text-center">
                    <p className="text-gray-600 text-sm">
                      🔒 조합원 승인 후 내용을 볼 수 있습니다
                    </p>
                  </div>
                )}
                <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-100">
                  <span className="text-sm text-gray-600">
                    작성자: <span className="font-medium">{profiles[post.author_id] || 'Loading...'}</span>
                  </span>
                  <div className="flex items-center gap-4">
                    {isMember && (
                      <button
                        onClick={() => toggleComments(post.id)}
                        className="text-sm text-gray-500 hover:text-primary-600 transition-colors"
                      >
                        💬 댓글 {expandedPosts.has(post.id) ? '접기' : '보기'}
                      </button>
                    )}
                    <span className="text-sm text-gray-500">
                      {new Date(post.created_at).toLocaleDateString('ko-KR', {
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                    </span>
                  </div>
                </div>
                
                {isMember && expandedPosts.has(post.id) && (
                  <CommentSection 
                    postId={post.id} 
                    currentUserId={currentUserId}
                    isMember={isMember}
                  />
                )}
              </div>
            ))}
          </div>
        )
      }
    </div>
  );
};

export default PostList;
