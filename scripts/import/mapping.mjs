/**
 * 로컬 원본 파일과 데이터베이스 대상의 대응.
 *
 * 이 파일들은 git에 없다 — `.gitignore`가 `docs/*`를 의도적으로 제외한다.
 * 따라서 이 스크립트는 원본이 있는 컴퓨터에서만 돌아간다.
 */

/** 총회 자료 — 이미 있는 board_documents 행에 본문을 채운다. */
export const ASSEMBLY_DOCS = [
  {
    file: 'docs/2026 총회/2026년_정기총회_자료집.md',
    matchTitle: '2026 정기총회 자료집',
    visibility: 'members',
  },
  {
    file: 'docs/2026 총회/2026년_정기총회_회의록.md',
    matchTitle: '2026 정기총회 회의록',
    visibility: 'members',
  },
  {
    file: 'docs/2026 총회/감사보고서_초안.md',
    matchTitle: '2026 감사보고서 (초안)',
    visibility: 'members',
  },
]

/** 이사회 회의록 — board_meetings를 찾거나 만들고 board_minutes를 넣는다. */
export const BOARD_MINUTES = [
  {
    file: 'docs/이사회/2025-07-30_제1차_이사회.md',
    date: '2025-07-30',
    title: '2025년 제1차 이사회',
  },
  {
    file: 'docs/이사회/2025-08-26_제2차_이사회.md',
    date: '2025-08-26',
    title: '2025년 제2차 이사회',
  },
  {
    file: 'docs/이사회/2025-09-29_제3차_이사회.md',
    date: '2025-09-29',
    title: '2025년 제3차 이사회',
  },
  {
    file: 'docs/이사회/2025-10-31_제4차_이사회.md',
    date: '2025-10-31',
    title: '2025년 제4차 이사회',
  },
  {
    file: 'docs/이사회/2025-11-28_제5차_이사회.md',
    date: '2025-11-28',
    title: '2025년 제5차 이사회',
  },
  {
    file: 'docs/이사회/2025-12-28_제6차_이사회.md',
    date: '2025-12-28',
    title: '2025년 제6차 이사회',
  },
  {
    file: 'docs/이사회/2026-01-30_2026년_제1차_이사회_회의록.md',
    date: '2026-01-30',
    title: '2026년 제1차 이사회',
  },
  {
    file: 'docs/이사회/2026-03-06_2026년_제2차_이사회.md',
    date: '2026-03-06',
    title: '2026년 제2차 이사회',
  },
  {
    file: 'docs/이사회/2026-04-02_2026년_제3차_이사회_회의록.md',
    date: '2026-04-02',
    title: '2026년 제3차 이사회',
  },
]
