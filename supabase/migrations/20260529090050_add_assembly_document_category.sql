-- 서류 카테고리에 '총회'를 추가한다. 정기총회 자료(자료집·회의록·감사보고서·
-- 거래내역서 등)는 일반 서류함과 분리된 별도 '정기총회' 메뉴에서 다룬다.
BEGIN;

ALTER TABLE public.board_documents DROP CONSTRAINT IF EXISTS chk_board_document_category;
ALTER TABLE public.board_documents ADD CONSTRAINT chk_board_document_category
  CHECK (category IN ('등록증', '정관', '계약', '총회', '기타'));

COMMIT;
