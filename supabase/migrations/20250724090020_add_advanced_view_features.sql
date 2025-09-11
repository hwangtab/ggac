-- 조회수 추적 고급 기능 추가 (관리자 권한 필요)
-- 2025-07-24: Advanced View Tracking Features

-- 1. 조회수 관련 통계 뷰 생성
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

-- 2. 뷰에 대한 소유권 설정
ALTER VIEW post_engagement_stats OWNER TO supabase_admin;

-- 3. 문서화 추가
COMMENT ON TABLE public.posts IS '게시글 테이블 - view_count 컬럼 추가됨 (2025-07-24)';
COMMENT ON COLUMN public.posts.view_count IS '게시글 조회수 - 중복 방지 로직은 애플리케이션에서 처리';
COMMENT ON FUNCTION increment_post_view_count IS '게시글 조회수를 원자적으로 증가시키는 함수';
COMMENT ON FUNCTION get_post_view_stats IS '게시글 조회수 통계를 반환하는 함수';
COMMENT ON FUNCTION get_popular_posts IS '인기 게시글 목록을 조회수 기준으로 반환하는 함수';
COMMENT ON VIEW post_engagement_stats IS '게시글 참여도 통계 뷰 - 조회수, 좋아요, 댓글 수 포함';

-- 4. 성능 모니터링을 위한 추가 인덱스
CREATE INDEX IF NOT EXISTS idx_posts_engagement_score ON public.posts(
    (view_count + COALESCE(like_count, 0) * 3) DESC
);

-- 5. 조회수 관련 RLS 정책 (기본적으로 읽기는 모든 승인된 사용자에게 허용)
-- 뷰는 기본적으로 테이블의 RLS를 상속받으므로 별도 설정 불필요