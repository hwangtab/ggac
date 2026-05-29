-- 이사회 도메인 테이블. 모든 읽기/쓰기는 service-role API(requireBoardMember)를 거친다.
-- RLS는 활성화하되 permissive 정책을 두지 않아 직접 클라이언트 접근을 차단한다.
BEGIN;

-- 1) 회의 (중심 엔티티)
CREATE TABLE IF NOT EXISTS public.board_meetings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  meeting_date DATE,                       -- polling 중 NULL, 확정 시 채움
  location TEXT,
  status TEXT NOT NULL DEFAULT 'polling',  -- 'polling' | 'scheduled' | 'completed'
  vote_deadline TIMESTAMPTZ,               -- 투표 마감(날짜+시각)
  created_by UUID REFERENCES public.member_profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2) 후보 날짜 (관리자가 지정)
CREATE TABLE IF NOT EXISTS public.board_meeting_date_options (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  meeting_id UUID NOT NULL REFERENCES public.board_meetings(id) ON DELETE CASCADE,
  candidate_date DATE NOT NULL             -- 시각 없이 날짜만 (21:00 고정)
);

-- 3) 후보별 투표 (이사 1명당 후보별 1표)
CREATE TABLE IF NOT EXISTS public.board_meeting_date_votes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  option_id UUID NOT NULL REFERENCES public.board_meeting_date_options(id) ON DELETE CASCADE,
  voter_id UUID NOT NULL REFERENCES public.member_profiles(id),
  is_available BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(option_id, voter_id)
);

-- 4) 출석 (정족수 계산용)
CREATE TABLE IF NOT EXISTS public.board_meeting_attendees (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  meeting_id UUID NOT NULL REFERENCES public.board_meetings(id) ON DELETE CASCADE,
  member_id UUID NOT NULL REFERENCES public.member_profiles(id),
  attended BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(meeting_id, member_id)
);

-- 5) 안건
CREATE TABLE IF NOT EXISTS public.board_agendas (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  meeting_id UUID NOT NULL REFERENCES public.board_meetings(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content TEXT,
  sort_order INT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'proposed', -- 'proposed' | 'discussed' | 'resolved'
  proposed_by UUID REFERENCES public.member_profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6) 회의록 (회의에 1:1)
CREATE TABLE IF NOT EXISTS public.board_minutes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  meeting_id UUID NOT NULL UNIQUE REFERENCES public.board_meetings(id) ON DELETE CASCADE,
  content TEXT,
  content_format TEXT,
  author_id UUID REFERENCES public.member_profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7) 서류함 (회의와 독립)
CREATE TABLE IF NOT EXISTS public.board_documents (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  category TEXT NOT NULL,                  -- '등록증' | '정관' | '계약' | '기타'
  file_url TEXT NOT NULL,
  file_name TEXT,
  file_size INT,
  mime_type TEXT,
  uploaded_by UUID REFERENCES public.member_profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- CHECK 제약 (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='chk_board_meeting_status') THEN
    ALTER TABLE public.board_meetings ADD CONSTRAINT chk_board_meeting_status
      CHECK (status IN ('polling','scheduled','completed'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='chk_board_agenda_status') THEN
    ALTER TABLE public.board_agendas ADD CONSTRAINT chk_board_agenda_status
      CHECK (status IN ('proposed','discussed','resolved'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='chk_board_document_category') THEN
    ALTER TABLE public.board_documents ADD CONSTRAINT chk_board_document_category
      CHECK (category IN ('등록증','정관','계약','기타'));
  END IF;
END$$;

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_board_meetings_status ON public.board_meetings (status);
CREATE INDEX IF NOT EXISTS idx_board_meetings_date ON public.board_meetings (meeting_date DESC);
CREATE INDEX IF NOT EXISTS idx_board_date_options_meeting ON public.board_meeting_date_options (meeting_id);
CREATE INDEX IF NOT EXISTS idx_board_date_votes_option ON public.board_meeting_date_votes (option_id);
CREATE INDEX IF NOT EXISTS idx_board_attendees_meeting ON public.board_meeting_attendees (meeting_id);
CREATE INDEX IF NOT EXISTS idx_board_agendas_meeting ON public.board_agendas (meeting_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_board_documents_category ON public.board_documents (category, created_at DESC);

-- updated_at 트리거 (기존 public.update_updated_at_column 재사용)
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'board_meetings','board_meeting_date_votes','board_meeting_attendees',
    'board_agendas','board_minutes'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger WHERE tgname = format('update_%s_updated_at', t)
    ) THEN
      EXECUTE format(
        'CREATE TRIGGER update_%1$s_updated_at BEFORE UPDATE ON public.%1$s
         FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column()', t);
    END IF;
  END LOOP;
END$$;

-- RLS 활성화 (permissive 정책 없음 → 직접 클라이언트 접근 차단, service-role만 우회)
ALTER TABLE public.board_meetings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.board_meeting_date_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.board_meeting_date_votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.board_meeting_attendees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.board_agendas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.board_minutes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.board_documents ENABLE ROW LEVEL SECURITY;

COMMIT;
