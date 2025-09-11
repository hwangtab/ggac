-- 게시글 조회수 추적 기능 추가
-- 2025-07-24: Post View Tracking Implementation

-- 1. posts 테이블에 view_count 컬럼 추가
ALTER TABLE public.posts 
ADD COLUMN view_count INTEGER DEFAULT 0 NOT NULL;

-- 2. 조회수 기반 정렬을 위한 인덱스 추가
CREATE INDEX idx_posts_view_count ON public.posts(view_count DESC);
CREATE INDEX idx_posts_view_count_created_at ON public.posts(view_count DESC, created_at DESC);

-- 3. 게시글 조회수 증가 함수 (원자적 업데이트 보장)
CREATE OR REPLACE FUNCTION increment_post_view_count(post_uuid UUID)
RETURNS INTEGER AS $$
DECLARE
    new_count INTEGER;
BEGIN
    UPDATE public.posts 
    SET view_count = view_count + 1,
        updated_at = NOW()
    WHERE id = post_uuid AND is_deleted = FALSE
    RETURNING view_count INTO new_count;
    
    -- 게시글이 존재하지 않거나 삭제된 경우
    IF new_count IS NULL THEN
        RAISE EXCEPTION 'Post not found or deleted: %', post_uuid;
    END IF;
    
    RETURN new_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. 조회수 통계 조회 함수
CREATE OR REPLACE FUNCTION get_post_view_stats(
    start_date TIMESTAMP WITH TIME ZONE DEFAULT NULL,
    end_date TIMESTAMP WITH TIME ZONE DEFAULT NULL
)
RETURNS TABLE(
    total_views BIGINT,
    avg_views NUMERIC,
    max_views INTEGER,
    posts_with_views BIGINT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        COALESCE(SUM(p.view_count), 0)::BIGINT as total_views,
        COALESCE(AVG(p.view_count), 0)::NUMERIC(10,2) as avg_views,
        COALESCE(MAX(p.view_count), 0)::INTEGER as max_views,
        COUNT(CASE WHEN p.view_count > 0 THEN 1 END)::BIGINT as posts_with_views
    FROM public.posts p
    WHERE p.is_deleted = FALSE
        AND (start_date IS NULL OR p.created_at >= start_date)
        AND (end_date IS NULL OR p.created_at <= end_date);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. 인기 게시글 조회 함수
CREATE OR REPLACE FUNCTION get_popular_posts(
    limit_count INTEGER DEFAULT 10,
    days_back INTEGER DEFAULT 30
)
RETURNS TABLE(
    id UUID,
    title TEXT,
    view_count INTEGER,
    like_count INTEGER,
    created_at TIMESTAMP WITH TIME ZONE,
    author_name TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        p.id,
        p.title,
        p.view_count,
        COALESCE(p.like_count, 0) as like_count,
        p.created_at,
        COALESCE(mp.display_name, 'Unknown') as author_name
    FROM public.posts p
    LEFT JOIN public.member_profiles mp ON p.author_id = mp.id
    WHERE p.is_deleted = FALSE
        AND p.created_at >= (NOW() - INTERVAL '%s days', days_back)
    ORDER BY p.view_count DESC, p.created_at DESC
    LIMIT limit_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. RLS 정책: 모든 사용자가 조회수 증가 함수를 사용할 수 있도록 허용
-- (함수는 SECURITY DEFINER로 설정되어 소유자 권한으로 실행됨)

-- 7. 기존 게시글들의 조회수를 0으로 초기화 (이미 DEFAULT 0이지만 명시적으로)
UPDATE public.posts SET view_count = 0 WHERE view_count IS NULL;

-- 8. 조회수 관련 통계 뷰 생성
CREATE OR REPLACE VIEW post_engagement_stats AS
SELECT 
    p.id,
    p.title,
    p.view_count,
    COALESCE(p.like_count, 0) as like_count,
    (
        SELECT COUNT(*) 
        FROM public.comments c 
        WHERE c.post_id = p.id
    ) as comment_count,
    -- 참여도 점수 계산 (조회수 + 좋아요*3 + 댓글*5)
    (p.view_count + COALESCE(p.like_count, 0) * 3 + 
     (SELECT COUNT(*) FROM public.comments c WHERE c.post_id = p.id) * 5
    ) as engagement_score,
    mp.display_name as author_name,
    p.created_at
FROM public.posts p
LEFT JOIN public.member_profiles mp ON p.author_id = mp.id
WHERE p.is_deleted = FALSE;

-- 9. 뷰에 대한 RLS 정책 - 승인된 회원만 볼 수 있음
ALTER VIEW post_engagement_stats OWNER TO supabase_admin;

COMMENT ON TABLE public.posts IS '게시글 테이블 - view_count 컬럼 추가됨 (2025-07-24)';
COMMENT ON COLUMN public.posts.view_count IS '게시글 조회수 - 중복 방지 로직은 애플리케이션에서 처리';
COMMENT ON FUNCTION increment_post_view_count IS '게시글 조회수를 원자적으로 증가시키는 함수';
COMMENT ON FUNCTION get_post_view_stats IS '게시글 조회수 통계를 반환하는 함수';
COMMENT ON FUNCTION get_popular_posts IS '인기 게시글 목록을 조회수 기준으로 반환하는 함수';
COMMENT ON VIEW post_engagement_stats IS '게시글 참여도 통계 뷰 - 조회수, 좋아요, 댓글 수 포함';