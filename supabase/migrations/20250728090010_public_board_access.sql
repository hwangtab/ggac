-- 게시판 공개 접근을 위한 RLS 정책 수정
-- 게시물 조회는 모든 사용자가 가능하지만, 작성/수정/삭제는 승인된 조합원만 가능

-- ===== POSTS 테이블 정책 수정 =====

-- 기존 조합원 전용 조회 정책 제거
DROP POLICY IF EXISTS "Approved members can view posts" ON public.posts;

-- 새로운 공개 조회 정책 생성 (삭제되지 않은 게시물만)
CREATE POLICY "Anyone can view posts" ON public.posts 
  FOR SELECT 
  USING (is_deleted = false);

-- 글 작성/수정/삭제는 여전히 승인된 조합원만 가능 (기존 정책 유지)
-- "Approved members can create posts" 정책은 그대로 유지
-- "Authors can update own posts" 정책은 그대로 유지 (있다면)
-- "Authors can delete own posts" 정책은 그대로 유지 (있다면)

-- ===== COMMENTS 테이블 정책 수정 =====

-- 기존 조합원 전용 조회 정책 제거 (있다면)
DROP POLICY IF EXISTS "Approved members can view comments" ON public.comments;

-- 새로운 공개 조회 정책 생성
CREATE POLICY "Anyone can view comments" ON public.comments 
  FOR SELECT 
  USING (true);

-- 댓글 작성은 여전히 승인된 조합원만 가능 (기존 정책 유지)
-- "Allow members to create comments" 정책은 그대로 유지

-- ===== POST_LIKES 테이블 정책 수정 =====

-- 기존 조합원 전용 조회 정책 제거 (있다면)
DROP POLICY IF EXISTS "Approved members can view likes" ON public.post_likes;

-- 새로운 공개 조회 정책 생성 (좋아요 수 확인용)
CREATE POLICY "Anyone can view likes" ON public.post_likes 
  FOR SELECT 
  USING (true);

-- 좋아요 추가/제거는 여전히 승인된 조합원만 가능 (기존 정책 유지)
-- 좋아요 관련 INSERT/DELETE 정책들은 그대로 유지

-- ===== POST_ATTACHMENTS 테이블 정책 수정 (있다면) =====

-- 첨부파일 조회도 공개로 변경
DROP POLICY IF EXISTS "Approved members can view attachments" ON public.post_attachments;

CREATE POLICY "Anyone can view attachments" ON public.post_attachments 
  FOR SELECT 
  USING (true);

-- 첨부파일 업로드는 여전히 승인된 조합원만 가능 (기존 정책 유지)

-- ===== 인덱스 최적화 (공개 접근으로 인한 성능 대비) =====

-- 게시물 조회 성능 향상을 위한 인덱스
CREATE INDEX IF NOT EXISTS idx_posts_created_at_not_deleted 
ON posts(created_at DESC) 
WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS idx_posts_category_not_deleted 
ON posts(category, created_at DESC) 
WHERE is_deleted = false;

-- 댓글 조회 성능 향상을 위한 인덱스
CREATE INDEX IF NOT EXISTS idx_comments_post_id_created_at 
ON comments(post_id, created_at);

-- 좋아요 조회 성능 향상을 위한 인덱스 (이미 있을 수 있지만 확인차 추가)
CREATE INDEX IF NOT EXISTS idx_post_likes_post_id 
ON post_likes(post_id);

-- ===== 마이그레이션 확인 로그 =====
DO $$
BEGIN
  RAISE NOTICE '✅ 게시판 공개 접근 정책 적용 완료';
  RAISE NOTICE '📖 게시물/댓글/좋아요 조회: 모든 사용자 가능';
  RAISE NOTICE '✏️ 게시물/댓글 작성, 좋아요: 승인된 조합원만 가능';
  RAISE NOTICE '🚀 성능 최적화 인덱스 추가 완료';
END $$;