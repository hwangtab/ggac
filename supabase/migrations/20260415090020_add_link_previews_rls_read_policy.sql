-- Fix: link_previews 테이블 RLS 읽기 정책 누락
-- RLS는 활성화되어 있으나 읽기 정책이 없어서 authenticated/anon 클라이언트로 조회 시 빈 결과 반환
-- 링크 프리뷰는 게시판 글을 보는 모든 사용자가 읽을 수 있어야 함

-- authenticated 사용자 읽기 허용
CREATE POLICY "link_previews_read_authenticated"
  ON public.link_previews
  FOR SELECT
  TO authenticated
  USING (true);

-- 비로그인 사용자(anon)도 읽기 허용 (게시판 글 공개 접근 지원)
CREATE POLICY "link_previews_read_anon"
  ON public.link_previews
  FOR SELECT
  TO anon
  USING (true);
