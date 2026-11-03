/**
 * 화면 테마 — ggac 이식 R2(docs/board-work/03-통합-재설계.md §4-4)부터 **포스터 다크 한 벌로 고정**이다.
 * 원본은 시스템/라이트/다크를 순환했지만, 업무툴은 이제 ggac 포스터 테마 하나만 쓴다(src/work/styles.css).
 *
 * 아래 이름들은 기존 임포트(ThemeToggle 등)가 깨지지 않게 남긴 껍데기다 — 어떤 입력이 와도 결과는 'dark'이고,
 * `applyThemePreference`는 예전에 저장돼 남은 `data-work-theme` 속성을 지울 뿐이다. 토글 UI는 R1에서 걷는다.
 */
export type ThemePreference = 'system' | 'light' | 'dark'

export const THEME_STORAGE_KEY = 'kw-theme'

/** 고정 테마 */
export const FIXED_THEME: ThemePreference = 'dark'

export function parseThemePreference(_raw?: string | null): ThemePreference {
  return FIXED_THEME
}

export function nextThemePreference(_current?: ThemePreference): ThemePreference {
  return FIXED_THEME
}

export const THEME_LABEL: Record<ThemePreference, string> = {
  system: '시스템 설정',
  light: '라이트',
  dark: '다크',
}

/** 예전 수동 지정이 남긴 속성 이름 — styles.css는 더 이상 이 속성을 보지 않는다 */
export const THEME_ATTRIBUTE = 'data-work-theme'

export function applyThemePreference(_pref: ThemePreference, root: HTMLElement): void {
  root.removeAttribute(THEME_ATTRIBUTE)
}

/** 업무툴 루트(없으면 null — 셸 밖) */
export function workThemeRoot(doc: Document = document): HTMLElement | null {
  return doc.querySelector<HTMLElement>('[data-work-app]')
}
