-- Phase 3 T1 (2026-07-10 전수감사): 게시판 목록 집계 뷰
--
-- fetchBoardPosts가 목록 1회에 4쿼리(posts 전본문 + 첨부 전행 + 댓글 전행 +
-- 좋아요 전행)를 발행하고 JS에서 집계하던 것을 뷰 1쿼리로 대체한다.
-- (posts.like_count 컬럼이 이미 관리되는데도 post_likes 전행을 세던 것이
-- post_likes seq scan 18.6만 회의 원인이었다.)
--
-- 보안: 이 뷰는 서버(service role) 전용이다. security_invoker=true로 생성해
-- SECURITY DEFINER 뷰 advisor ERROR를 만들지 않고, anon/authenticated에는
-- SELECT를 부여하지 않는다(기본 GRANT 없음 + 명시 REVOKE로 idempotent 보장).

CREATE OR REPLACE VIEW public.board_posts_with_stats
WITH (security_invoker = true) AS
SELECT
  p.id,
  p.title,
  p.category,
  p.author_id,
  p.created_at,
  p.updated_at,
  p.is_pinned,
  -- 목록 미리보기(텍스트 150자)용 본문 앞부분만 — HTML 태그 여유분 포함 2000자.
  -- 전체 본문 전송(게시글당 수십 KB)을 제거하는 것이 이 뷰의 핵심 목적 중 하나.
  left(p.content, 2000) AS content_head,
  p.like_count,
  mp.display_name AS author_display_name,
  (SELECT count(*)::int FROM public.comments c WHERE c.post_id = p.id) AS comment_count,
  COALESCE(att.total_attachments, 0)::int AS total_attachments,
  COALESCE(att.total_size, 0)::bigint AS total_size,
  COALESCE(att.image_count, 0)::int AS image_count,
  COALESCE(att.document_count, 0)::int AS document_count,
  COALESCE(att.video_count, 0)::int AS video_count,
  COALESCE(att.audio_count, 0)::int AS audio_count
FROM public.posts p
LEFT JOIN public.member_profiles mp ON mp.id = p.author_id
LEFT JOIN LATERAL (
  SELECT
    count(*) AS total_attachments,
    sum(a.file_size) AS total_size,
    count(*) FILTER (WHERE a.file_type = 'image') AS image_count,
    count(*) FILTER (WHERE a.file_type = 'document') AS document_count,
    count(*) FILTER (WHERE a.file_type = 'video') AS video_count,
    count(*) FILTER (WHERE a.file_type = 'audio') AS audio_count
  FROM public.post_attachments a
  WHERE a.post_id = p.id
    AND (a.is_temporary IS NOT TRUE)
) att ON true
WHERE p.is_deleted IS NOT TRUE;

REVOKE ALL ON public.board_posts_with_stats FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.board_posts_with_stats TO service_role;
