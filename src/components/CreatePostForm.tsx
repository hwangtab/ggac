import React, { useState } from 'react';
import { supabase } from '../lib/supabase/client';
import { BOARD_CATEGORIES } from '@/constants/categories';
import type { Post, PostAttachment } from '@/types';
import PostAttachmentUploader from './PostAttachmentUploader';
import { logPostCreated } from '@/utils/activityLogger';

interface CreatePostFormProps {
  authorId: string;
  onNewPost: (post: Post) => void;
  showSuccessRedirect?: boolean;
}

const CreatePostForm: React.FC<CreatePostFormProps> = ({ authorId, onNewPost, showSuccessRedirect = false }) => {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [category, setCategory] = useState('잡담');
  const [loading, setLoading] = useState(false);
  const [showAttachmentUploader, setShowAttachmentUploader] = useState(false);
  const [createdPostId, setCreatedPostId] = useState<string | null>(null);

  // '전체'는 필터링용이므로 제외하고 실제 게시글 카테고리만 사용
  const postCategories = BOARD_CATEGORIES.slice(1);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    const { data, error } = await supabase
      .from('posts')
      .insert([{ title, content, category, author_id: authorId }])
      .select()
      .single();

    setLoading(false);

    if (error) {
      alert(error.message);
    } else if (data) {
      setCreatedPostId((data as any).id);
      
      // 활동 로깅
      try {
        await logPostCreated((data as any).id, {
          category,
          title: title.substring(0, 50), // 제목 앞부분만 저장
          character_count: content.length
        });
      } catch (logError) {
        console.error('활동 로깅 오류:', logError);
        // 로깅 실패는 사용자 경험에 영향주지 않음
      }
      
      if (showSuccessRedirect) {
        alert('게시글이 성공적으로 작성되었습니다! 첨부파일을 추가할 수 있습니다.');
      }
      
      // 첨부파일 업로더 표시
      setShowAttachmentUploader(true);
      
      onNewPost(data as any);
      setTitle('');
      setContent('');
      setCategory('잡담');
    }
  };

  // 첨부파일 업로드 완료 핸들러
  const handleAttachmentUploadComplete = (attachments: PostAttachment[]) => {
    console.log('첨부파일 업로드 완료:', attachments);
  };

  // 첨부파일 업로드 오류 핸들러
  const handleAttachmentUploadError = (error: string) => {
    alert('첨부파일 업로드 오류: ' + error);
  };

  // 첨부파일 업로더 닫기
  const closeAttachmentUploader = () => {
    setShowAttachmentUploader(false);
    setCreatedPostId(null);
  };

  return (
    <div className="bg-white p-6 rounded-lg shadow-md mb-8">
      <h2 className="text-2xl font-semibold mb-4">새 게시글 작성</h2>
      
      {!showAttachmentUploader ? (
        <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="category" className="block text-sm font-medium text-gray-700">카테고리</label>
          <select
            id="category"
            className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            disabled={loading}
          >
            {postCategories.map((cat) => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="title" className="block text-sm font-medium text-gray-700">제목</label>
          <input
            type="text"
            id="title"
            className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            disabled={loading}
          />
        </div>
        <div>
          <label htmlFor="content" className="block text-sm font-medium text-gray-700">내용</label>
          <textarea
            id="content"
            rows={5}
            className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            required
            disabled={loading}
          ></textarea>
        </div>
        <div>
          <button
            type="submit"
            className="inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
            disabled={loading}
          >
            {loading ? '작성 중...' : '게시글 작성'}
          </button>
        </div>
        </form>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-medium text-gray-900">첨부파일 추가</h3>
            <button
              onClick={closeAttachmentUploader}
              className="text-gray-500 hover:text-gray-700"
            >
              나중에 추가하기
            </button>
          </div>
          
          <p className="text-sm text-gray-600">
            게시글이 작성되었습니다. 이제 이미지나 문서 파일을 첨부할 수 있습니다.
          </p>

          {createdPostId && (
            <PostAttachmentUploader
              postId={createdPostId}
              onUploadComplete={handleAttachmentUploadComplete}
              onUploadError={handleAttachmentUploadError}
            />
          )}

          <div className="flex justify-end">
            <button
              onClick={closeAttachmentUploader}
              className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700"
            >
              완료
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default CreatePostForm;
