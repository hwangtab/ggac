import React, { useState, useCallback, useRef, useMemo } from 'react';
import { supabase } from '../lib/supabase/client';
import { BOARD_CATEGORIES } from '@/constants/categories';
import type { Post, PostAttachment } from '@/types';
import { logPostCreated } from '@/utils/activityLogger';
import { FiUpload, FiX, FiImage, FiFile, FiVideo, FiMusic, FiPaperclip } from 'react-icons/fi';
import dynamic from 'next/dynamic';

// TinyMCE를 동적으로 로드하여 SSR 이슈 방지
const RichTextEditor = dynamic(() => import('./RichTextEditor'), {
  ssr: false,
  loading: () => <div className="h-96 bg-gray-100 rounded-lg animate-pulse" />
});

interface CreatePostFormProps {
  authorId: string;
  onNewPost: (post: Post) => void;
  showSuccessRedirect?: boolean;
}

const CreatePostForm: React.FC<CreatePostFormProps> = ({ authorId, onNewPost, showSuccessRedirect = false }) => {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [category, setCategory] = useState('잡담');
  const [useRichEditor, setUseRichEditor] = useState(true);
  const [loading, setLoading] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // '전체'는 필터링용이므로 제외하고 실제 게시글 카테고리만 사용
  const postCategories = BOARD_CATEGORIES.slice(1);

  // 허용된 파일 타입
  const ALLOWED_TYPES = useMemo(() => [
    'image/jpeg',
    'image/png', 
    'image/gif',
    'image/webp',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'video/mp4',
    'video/webm',
    'audio/mpeg',
    'audio/wav'
  ], []);

  const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB per file
  const MAX_FILES = 10;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      // 1. 게시글 생성 (공지 카테고리인 경우 자동으로 핀 설정)
      const postData = {
        title,
        content,
        content_format: useRichEditor ? 'html' : 'plain',
        category,
        author_id: authorId,
        ...(category === '공지' && {
          is_pinned: true,
          pinned_at: new Date().toISOString()
        })
      };

      const { data, error } = await supabase
        .from('posts')
        .insert([postData])
        .select()
        .single();

      if (error) {
        throw new Error(error.message);
      }

      const postId = (data as any).id;

      // 2. 활동 로깅
      try {
        await logPostCreated(postId, {
          category,
          title: title.substring(0, 50),
          character_count: content.length
        });
      } catch (logError) {
        console.error('활동 로깅 오류:', logError);
      }

      // 3. 첨부파일 업로드 (선택된 파일이 있는 경우)
      if (selectedFiles.length > 0) {
        try {
          await uploadAttachments(postId);
          console.log('[Submit] 첨부파일 업로드 완료');
        } catch (uploadError) {
          console.error('[Submit] 첨부파일 업로드 실패:', uploadError);
          // 첨부파일 업로드 실패 시에도 게시글은 이미 생성됨을 알림
          alert(`게시글은 성공적으로 작성되었지만, 첨부파일 업로드에 실패했습니다.\n게시글 수정을 통해 나중에 첨부파일을 추가할 수 있습니다.`);
        }
      }

      // 4. 성공 처리
      if (showSuccessRedirect) {
        alert('게시글이 성공적으로 작성되었습니다!');
      }
      
      onNewPost(data as any);
      
      // 폼 초기화
      setTitle('');
      setContent('');
      setCategory('잡담');
      setUseRichEditor(true);
      setSelectedFiles([]);

    } catch (error) {
      console.error('게시글 작성 오류:', error);
      alert(error instanceof Error ? error.message : '게시글 작성에 실패했습니다.');
    } finally {
      setLoading(false);
    }
  };

  // 첨부파일 업로드 함수
  const uploadAttachments = async (postId: string) => {
    console.log(`[Upload] 시작: ${selectedFiles.length}개 파일 업로드`);
    
    const uploadPromises = selectedFiles.map(async (file, index) => {
      console.log(`[Upload] ${index + 1}/${selectedFiles.length}: ${file.name} (${file.type}, ${file.size} bytes)`);
      
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch(`/api/posts/${postId}/attachments`, {
        method: 'POST',
        body: formData
      });

      console.log(`[Upload] ${file.name} 응답: ${response.status} ${response.statusText}`);

      if (!response.ok) {
        const result = await response.json().catch(() => ({ error: '응답 파싱 실패' }));
        const errorMsg = result.error || `${file.name} 업로드에 실패했습니다.`;
        console.error(`[Upload] ${file.name} 실패:`, errorMsg);
        throw new Error(errorMsg);
      }

      const result = await response.json();
      console.log(`[Upload] ${file.name} 성공:`, result);
      return result;
    });

    try {
      const results = await Promise.all(uploadPromises);
      console.log(`[Upload] 전체 완료: ${results.length}개 파일 성공`);
      return results;
    } catch (error) {
      console.error('[Upload] 첨부파일 업로드 실패:', error);
      alert(`첨부파일 업로드 중 오류가 발생했습니다:\n${error instanceof Error ? error.message : '알 수 없는 오류'}`);
      throw error; // 오류를 다시 던져서 상위에서 처리할 수 있도록
    }
  };

  // 파일 선택 핸들러
  const handleFileSelect = useCallback((files: FileList) => {
    const fileArray = Array.from(files);
    const validFiles: File[] = [];
    const errors: string[] = [];

    // 파일 개수 체크
    if (selectedFiles.length + fileArray.length > MAX_FILES) {
      errors.push(`최대 ${MAX_FILES}개의 파일만 업로드할 수 있습니다.`);
    }

    // 파일 검증
    fileArray.forEach(file => {
      if (!ALLOWED_TYPES.includes(file.type)) {
        errors.push(`${file.name}: 지원하지 않는 파일 형식입니다.`);
        return;
      }

      if (file.size > MAX_FILE_SIZE) {
        errors.push(`${file.name}: 파일 크기가 너무 큽니다. (최대 50MB)`);
        return;
      }

      validFiles.push(file);
    });

    // 오류가 있으면 표시하고 중단
    if (errors.length > 0) {
      alert(errors.join('\n'));
      return;
    }

    // 중복 파일 제거
    const newFiles = validFiles.filter(newFile => 
      !selectedFiles.some(existingFile => 
        existingFile.name === newFile.name && existingFile.size === newFile.size
      )
    );

    setSelectedFiles(prev => [...prev, ...newFiles]);
  }, [selectedFiles, ALLOWED_TYPES, MAX_FILE_SIZE, MAX_FILES]);

  // 드래그 앤 드롭 핸들러
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleFileSelect(files);
    }
  }, [handleFileSelect]);

  // 파일 입력 클릭
  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      handleFileSelect(files);
    }
    e.target.value = '';
  }, [handleFileSelect]);

  // 개별 파일 삭제
  const removeFile = useCallback((index: number) => {
    setSelectedFiles(prev => prev.filter((_, i) => i !== index));
  }, []);

  // 파일 아이콘 선택
  const getFileIcon = (fileType: string) => {
    if (fileType.startsWith('image/')) return FiImage;
    if (fileType.startsWith('video/')) return FiVideo;
    if (fileType.startsWith('audio/')) return FiMusic;
    return FiFile;
  };

  // 파일 크기 포맷팅
  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  return (
    <div className="bg-white p-6 sm:p-8 rounded-xl shadow-lg mb-12">
      <h2 className="text-2xl font-semibold mb-6 text-gray-900">새 게시글 작성</h2>
      
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
        
        {/* 에디터 선택 */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="block text-sm font-medium text-gray-700">내용</label>
            <div className="flex items-center space-x-2">
              <label className="flex items-center text-sm text-gray-600">
                <input
                  type="checkbox"
                  checked={useRichEditor}
                  onChange={(e) => setUseRichEditor(e.target.checked)}
                  disabled={loading}
                  className="mr-2 rounded"
                />
                리치 에디터 사용 (이미지 삽입, 서식 지원)
              </label>
            </div>
          </div>
          
          {useRichEditor ? (
            <RichTextEditor
              value={content}
              onChange={setContent}
              placeholder="게시글 내용을 입력하세요..."
              disabled={loading}
              height={400}
            />
          ) : (
            <textarea
              id="content"
              rows={8}
              className="block w-full border border-gray-300 rounded-lg shadow-sm py-3 px-4 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 text-base transition-colors resize-vertical min-h-[200px]"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="게시글 내용을 입력하세요"
              required
              disabled={loading}
            />
          )}
        </div>

        {/* 첨부파일 섹션 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-3">첨부파일 (선택사항)</label>
          
          {/* 드래그 앤 드롭 영역 */}
          <div
            className={`
              border-2 border-dashed rounded-lg p-6 text-center transition-colors
              ${isDragOver 
                ? 'border-primary-400 bg-primary-50' 
                : 'border-gray-300 hover:border-gray-400'
              }
            `}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <FiPaperclip className="w-8 h-8 text-gray-400 mx-auto mb-3" />
            <p className="text-sm font-medium text-gray-900 mb-1">
              파일을 여기로 드래그하거나 클릭하여 선택하세요
            </p>
            <p className="text-xs text-gray-500 mb-3">
              이미지, 문서, 비디오, 오디오 파일 지원 (최대 {MAX_FILES}개, 파일당 50MB)
            </p>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={loading}
              className="inline-flex items-center px-3 py-2 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200 transition-colors disabled:opacity-50"
            >
              <FiUpload className="w-4 h-4 mr-2" />
              파일 선택
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept={ALLOWED_TYPES.join(',')}
              onChange={handleInputChange}
              className="hidden"
              disabled={loading}
            />
          </div>

          {/* 선택된 파일 목록 */}
          {selectedFiles.length > 0 && (
            <div className="mt-4 space-y-2">
              <p className="text-sm font-medium text-gray-700">선택된 파일 ({selectedFiles.length}개)</p>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {selectedFiles.map((file, index) => {
                  const FileIcon = getFileIcon(file.type);
                  return (
                    <div key={`${file.name}-${index}`} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                      <div className="flex items-center space-x-3 flex-1 min-w-0">
                        <FileIcon className="w-5 h-5 text-gray-600 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900 truncate">{file.name}</p>
                          <p className="text-xs text-gray-500">{formatFileSize(file.size)}</p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeFile(index)}
                        disabled={loading}
                        className="text-gray-400 hover:text-red-600 transition-colors disabled:opacity-50"
                      >
                        <FiX className="w-4 h-4" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
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
                {selectedFiles.length > 0 ? '게시글 작성 및 파일 업로드 중...' : '작성 중...'}
              </>
            ) : selectedFiles.length > 0 ? `게시글 작성 (${selectedFiles.length}개 파일 포함)` : '게시글 작성'}
          </button>
        </div>
      </form>
    </div>
  );
};

export default CreatePostForm;
