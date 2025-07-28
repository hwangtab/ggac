import { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getPostMetadata } from '@/lib/posts'
import PostDetailClient from './PostDetailClient'

// 동적 메타데이터 생성
export async function generateMetadata(
  { params }: { params: Promise<{ id: string }> }
): Promise<Metadata> {
  const resolvedParams = await params;
  const postId = resolvedParams.id;
  
  try {
    const metadata = await getPostMetadata(postId);
    
    if (!metadata) {
      return {
        title: '게시물을 찾을 수 없습니다 - 경기아트콜렉티브',
        description: '요청하신 게시물을 찾을 수 없습니다.',
      };
    }

    const { post, author, thumbnail, description, categoryEmoji } = metadata;
    
    const title = `${categoryEmoji} [${post.category}] ${post.title} - 경기아트콜렉티브`;
    const ogImageUrl = thumbnail 
      ? `/api/og/post/${postId}`
      : '/images/logo/gac_og.webp';

    return {
      title,
      description,
      authors: [{ name: author?.display_name || '경기아트콜렉티브' }],
      openGraph: {
        title,
        description,
        url: `https://ggac.kr/board/${postId}`,
        siteName: '경기아트콜렉티브',
        images: [
          {
            url: ogImageUrl,
            width: 1200,
            height: 630,
            alt: `${post.title} - 경기아트콜렉티브`,
          },
        ],
        type: 'article',
        publishedTime: post.created_at,
        authors: [author?.display_name || '경기아트콜렉티브'],
        section: post.category,
      },
      twitter: {
        card: 'summary_large_image',
        title,
        description,
        images: [ogImageUrl],
      },
      alternates: {
        canonical: `/board/${postId}`,
      },
    };
  } catch (error) {
    console.error('[Metadata] Error generating metadata:', error);
    return {
      title: '게시물 - 경기아트콜렉티브',
      description: '경기아트콜렉티브 협동조합 조합원들의 소통 공간입니다.',
    };
  }
}

// 서버 컴포넌트 (메타데이터 생성용)
export default async function PostDetailPage({ 
  params 
}: { 
  params: Promise<{ id: string }> 
}) {
  const resolvedParams = await params;
  const postId = resolvedParams.id;

  // 게시물 존재 여부 확인
  const metadata = await getPostMetadata(postId);
  
  if (!metadata) {
    notFound();
  }

  // 클라이언트 컴포넌트에 렌더링 위임
  return <PostDetailClient postId={postId} />;
}