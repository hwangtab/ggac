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
    <div className="bg-white p-6 sm:p-8 rounded-xl shadow-lg mb-12">
      <h2 className="text-2xl font-semibold mb-6 text-gray-900">새 게시글 작성</h2>
      
      {!showAttachmentUploader ? (
        <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label htmlFor="category" className="block text-sm font-medium text-gray-700 mb-2">카테고리</label>
          <select
            id="category"
            className="block w-full border border-gray-300 rounded-lg shadow-sm py-3 px-4 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 text-base transition-colors"
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
          <label htmlFor="title" className="block text-sm font-medium text-gray-700 mb-2">제목</label>
          <input
            type="text"
            id="title"
            className="block w-full border border-gray-300 rounded-lg shadow-sm py-3 px-4 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 text-base transition-colors"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="게시글 제목을 입력하세요"
            required
            disabled={loading}
          />
        </div>
        <div>
          <label htmlFor="content" className="block text-sm font-medium text-gray-700 mb-2">내용</label>
          <textarea
            id="content"
            rows={8}
            className="block w-full border border-gray-300 rounded-lg shadow-sm py-3 px-4 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 text-base transition-colors resize-vertical min-h-[200px]"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="게시글 내용을 입력하세요"
            required
            disabled={loading}
          ></textarea>
        </div>
        <div className="pt-4">
          <button
            type="submit"
            className="w-full sm:w-auto inline-flex justify-center items-center py-3 px-8 border border-transparent shadow-sm text-base font-medium rounded-lg text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            disabled={loading}
          >
            {loading ? (
              <>
                <svg className="animate-spin -ml-1 mr-3 h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                작성 중...
              </>
            ) : '게시글 작성'}
          </button>
        </div>
        </form>
      ) : (
        <div className="space-y-6 animate-in slide-in-from-top-2 duration-300">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div>
              <h3 className="text-lg font-medium text-gray-900">첨부파일 추가</h3>
              <p className="text-sm text-gray-600 mt-1">
                게시글이 성공적으로 작성되었습니다!
              </p>
            </div>
            <button
              onClick={closeAttachmentUploader}
              className="text-sm text-gray-500 hover:text-gray-700 transition-colors"
            >
              나중에 추가하기
            </button>
          </div>
          
          <div className="bg-green-50 border border-green-200 rounded-lg p-4">
            <div className="flex items-start">
              <svg className="flex-shrink-0 h-5 w-5 text-green-400 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              <div className="ml-3">
                <p className="text-sm text-green-800">
                  이제 이미지나 문서 파일을 첨부할 수 있습니다. 파일을 드래그하거나 업로드 버튼을 클릭하세요.
                </p>
              </div>
            </div>
          </div>

          {createdPostId && (
            <div className="border border-gray-200 rounded-lg p-4">
              <PostAttachmentUploader
                postId={createdPostId}
                onUploadComplete={handleAttachmentUploadComplete}
                onUploadError={handleAttachmentUploadError}
              />
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-3 sm:justify-end pt-4 border-t border-gray-200">
            <button
              onClick={closeAttachmentUploader}
              className="w-full sm:w-auto px-6 py-3 bg-gray-600 text-white rounded-lg hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500 transition-colors"
            >
              첨부파일 업로드 완료
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default CreatePostForm;
