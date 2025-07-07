import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase/client';

interface Comment {
  id: string;
  post_id: string;
  author_id: string;
  content: string;
  created_at: string;
  updated_at: string;
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

  useEffect(() => {
    fetchComments();
  }, [postId]);

  useEffect(() => {
    if (comments.length > 0) {
      fetchProfiles();
    }
  }, [comments]);

  const fetchComments = async () => {
    const { data, error } = await supabase
      .from('comments')
      .select('*')
      .eq('post_id', postId)
      .order('created_at', { ascending: true });

    if (data && !error) {
      setComments(data);
    }
  };

  const fetchProfiles = async () => {
    const authorIds = Array.from(new Set(comments.map(comment => comment.author_id)));
    
    const { data, error } = await supabase
      .from('profiles')
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
      setComments(prev => [...prev, data]);
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
      setComments(prev => prev.filter(comment => comment.id !== commentId));
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
        {comments.map((comment) => (
          <div key={comment.id} className="bg-gray-50 p-4 rounded-lg">
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
                <p className="text-gray-700 text-sm leading-relaxed">
                  {comment.content}
                </p>
              </div>
              {currentUserId === comment.author_id && (
                <button
                  onClick={() => handleDeleteComment(comment.id)}
                  className="text-gray-400 hover:text-red-600 text-sm ml-2"
                >
                  삭제
                </button>
              )}
            </div>
          </div>
        ))}
        
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