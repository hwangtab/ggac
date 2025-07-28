/**
 * 게시물 관련 서버 사이드 데이터 조회 유틸리티
 * generateMetadata 및 Server Component에서 사용
 */

import { createClient } from '@supabase/supabase-js'
import type { PostAttachment } from '@/types'

// Service Role 클라이언트 생성
function getSupabaseAdmin() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.NEXT_PUBLIC_SUPABASE_URL) {
    throw new Error('Supabase configuration missing for server-side post queries')
  }
  
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

// 게시물 상세 정보 인터페이스
export interface PostDetail {
  id: string
  title: string
  content: string
  category: string
  author_id: string
  created_at: string
  view_count?: number
  is_deleted: boolean
}

// 작성자 프로필 정보 인터페이스
export interface AuthorProfile {
  id: string
  display_name: string
  profile_image_url?: string
}

/**
 * 게시물 상세 정보 조회 (서버 사이드)
 * 공개 정책에 따라 삭제되지 않은 게시물만 조회
 */
export async function getPostById(postId: string): Promise<PostDetail | null> {
  try {
    // UUID 형식 기본 검증
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(postId)) {
      console.log('[Posts] Invalid UUID format:', postId);
      return null;
    }

    const supabase = getSupabaseAdmin();

    const { data: post, error } = await supabase
      .from('posts')
      .select('*')
      .eq('id', postId)
      .eq('is_deleted', false)
      .single();

    if (error || !post) {
      console.log('[Posts] Post not found:', postId, error?.message);
      return null;
    }

    return post as PostDetail;
    
  } catch (error) {
    console.error('[Posts] Error fetching post:', error);
    return null;
  }
}

/**
 * 게시물의 작성자 프로필 조회
 */
export async function getPostAuthor(authorId: string): Promise<AuthorProfile | null> {
  try {
    const supabase = getSupabaseAdmin();

    // public_profiles 뷰에서 조회 (member_profiles와 매핑)
    const { data: profile, error } = await supabase
      .from('public_profiles')
      .select('id, display_name, profile_image_url')
      .eq('id', authorId)
      .single();

    if (error || !profile) {
      console.log('[Posts] Author profile not found:', authorId, error?.message);
      return {
        id: authorId,
        display_name: '알 수 없는 사용자'
      };
    }

    return profile as AuthorProfile;
    
  } catch (error) {
    console.error('[Posts] Error fetching author:', error);
    return {
      id: authorId,
      display_name: '알 수 없는 사용자'
    };
  }
}

/**
 * 게시물의 첨부 이미지 목록 조회
 */
export async function getPostImages(postId: string): Promise<PostAttachment[]> {
  try {
    const supabase = getSupabaseAdmin();

    const { data: images, error } = await supabase
      .from('post_attachments')
      .select('*')
      .eq('post_id', postId)
      .eq('file_type', 'image')
      .order('is_primary', { ascending: false }) // 대표 이미지 우선
      .order('created_at', { ascending: true });  // 그 다음 업로드 순서

    if (error) {
      console.error('[Posts] Error fetching images:', error);
      return [];
    }

    return images || [];
    
  } catch (error) {
    console.error('[Posts] Error fetching post images:', error);
    return [];
  }
}

/**
 * 게시물의 첫 번째 이미지 URL 조회
 */
export async function getPostThumbnail(postId: string): Promise<string | null> {
  try {
    const images = await getPostImages(postId);
    
    if (images.length > 0) {
      return images[0].file_url;
    }
    
    return null;
    
  } catch (error) {
    console.error('[Posts] Error fetching post thumbnail:', error);
    return null;
  }
}

/**
 * 게시물 내용에서 텍스트만 추출 (HTML 태그 제거)
 */
export function extractTextFromContent(content: string, maxLength: number = 150): string {
  if (!content) return '';
  
  // HTML 태그 제거
  const textOnly = content.replace(/<[^>]*>/g, '');
  
  // 연속된 공백과 줄바꿈 정리
  const cleaned = textOnly.replace(/\s+/g, ' ').trim();
  
  // 길이 제한
  if (cleaned.length <= maxLength) {
    return cleaned;
  }
  
  return cleaned.substring(0, maxLength) + '...';
}

/**
 * 카테고리별 이모지 반환
 */
export function getCategoryEmoji(category: string): string {
  const categoryEmojis: Record<string, string> = {
    '공지': '📢',
    '잡담': '💬',
    '홍보': '📣',
    '건의': '💡'
  };
  
  return categoryEmojis[category] || '📝';
}

/**
 * 게시물의 전체 메타데이터 정보 조회
 */
export async function getPostMetadata(postId: string) {
  try {
    const [post, thumbnail] = await Promise.all([
      getPostById(postId),
      getPostThumbnail(postId)
    ]);

    if (!post) {
      return null;
    }

    const author = await getPostAuthor(post.author_id);
    const description = extractTextFromContent(post.content);
    const categoryEmoji = getCategoryEmoji(post.category);

    return {
      post,
      author,
      thumbnail,
      description,
      categoryEmoji
    };
    
  } catch (error) {
    console.error('[Posts] Error fetching post metadata:', error);
    return null;
  }
}