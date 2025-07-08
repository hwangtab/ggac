import React, { useState } from 'react';
import { supabase } from '../lib/supabase/client';
import { BOARD_CATEGORIES } from '@/constants/categories';
import type { Post } from '@/types';

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
      if (showSuccessRedirect) {
        alert('게시글이 성공적으로 작성되었습니다!');
      }
      onNewPost(data);
      setTitle('');
      setContent('');
      setCategory('잡담');
    }
  };

  return (
    <div className="bg-white p-6 rounded-lg shadow-md mb-8">
      <h2 className="text-2xl font-semibold mb-4">새 게시글 작성</h2>
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
    </div>
  );
};

export default CreatePostForm;
