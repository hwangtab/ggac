/**
 * 업무 화면의 직함 규칙 — 순수 함수(로컬 import 금지: `node --test`가 이 파일을 직접 읽는다).
 *
 * 업무툴 직함(`work_member_prefs.work_title`, 0033)은 **업무 화면에만** 보인다. 비어 있으면 이사회 직함
 * (`member_profiles.director_title`)으로 떨어진다. 공식 직함은 출석·회의·관리자 회원 화면이 쓰고 업무툴은 쓰지 않는다
 * (docs/board-work/03-통합-재설계.md §10).
 */

function clean(v: string | null | undefined): string | null {
  const t = typeof v === 'string' ? v.trim() : ''
  return t === '' ? null : t
}

/** 화면에 보일 직함: 업무툴 직함 → 이사회 직함 → 없음 */
export function resolveWorkTitle(
  workTitle: string | null | undefined,
  directorTitle: string | null | undefined
): string | null {
  return clean(workTitle) ?? clean(directorTitle)
}
