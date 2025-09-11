-- 조회수 추적 고급 기능 추가 (제한된 권한 버전)
-- 2025-07-24: Advanced View Tracking Features (Limited Permissions)

-- 1. 조회수 관련 통계 뷰 생성 (소유권 설정 제외)
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

-- 2. 성능 모니터링을 위한 추가 인덱스
CREATE INDEX IF NOT EXISTS idx_posts_engagement_score ON public.posts(
    (view_count + COALESCE(like_count, 0) * 3) DESC
);

-- 3. 조회수와 생성일 복합 인덱스 (이미 있으면 건너뜀)
CREATE INDEX IF NOT EXISTS idx_posts_view_count_created_at_2 ON public.posts(
    view_count DESC, 
    created_at DESC
) WHERE is_deleted = FALSE;

-- 4. 문서화 추가 (COMMENT는 현재 권한으로 가능)
COMMENT ON TABLE public.posts IS '게시글 테이블 - view_count 컬럼 추가됨 (2025-07-24)';
COMMENT ON COLUMN public.posts.view_count IS '게시글 조회수 - 중복 방지 로직은 애플리케이션에서 처리';
COMMENT ON FUNCTION increment_post_view_count IS '게시글 조회수를 원자적으로 증가시키는 함수';
COMMENT ON FUNCTION get_post_view_stats IS '게시글 조회수 통계를 반환하는 함수';
COMMENT ON FUNCTION get_popular_posts IS '인기 게시글 목록을 조회수 기준으로 반환하는 함수';
COMMENT ON VIEW post_engagement_stats IS '게시글 참여도 통계 뷰 - 조회수, 좋아요, 댓글 수 포함';

-- 5. 추가 통계 함수 (현재 권한으로 생성 가능)
CREATE OR REPLACE FUNCTION get_engagement_summary()
RETURNS TABLE(
    total_posts BIGINT,
    total_views BIGINT,
    total_likes BIGINT,
    total_comments BIGINT,
    avg_engagement_score NUMERIC
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        COUNT(*)::BIGINT as total_posts,
        COALESCE(SUM(p.view_count), 0)::BIGINT as total_views,
        COALESCE(SUM(p.like_count), 0)::BIGINT as total_likes,
        (SELECT COUNT(*) FROM public.comments c 
         JOIN public.posts p2 ON c.post_id = p2.id 
         WHERE p2.is_deleted = FALSE)::BIGINT as total_comments,
        COALESCE(AVG(
            p.view_count + COALESCE(p.like_count, 0) * 3 + 
            (SELECT COUNT(*) FROM public.comments c WHERE c.post_id = p.id) * 5
        ), 0)::NUMERIC(10,2) as avg_engagement_score
    FROM public.posts p
    WHERE p.is_deleted = FALSE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. 기능 검증 쿼리
SELECT 'Advanced view features installation completed' as status;
SELECT COUNT(*) as total_posts_with_view_count FROM public.posts WHERE view_count IS NOT NULL;