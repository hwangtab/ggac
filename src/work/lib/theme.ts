/**
 * 다크모드 — 수동 지정(localStorage)이 있으면 <html data-theme>, 없으면 OS 설정(CSS 미디어쿼리).
 * 'system' 은 data-theme 속성을 지운다(globals.css 의 prefers-color-scheme 분기가 적용된다).
 */
export type ThemePreference = 'system' | 'light' | 'dark'

export const THEME_STORAGE_KEY = 'kw-theme'

export function parseThemePreference(raw: string | null | undefined): ThemePreference {
  return raw === 'light' || raw === 'dark' ? raw : 'system'
}

export function nextThemePreference(current: ThemePreference): ThemePreference {
  if (current === 'system') return 'light'
  if (current === 'light') return 'dark'
  return 'system'
}

export const THEME_LABEL: Record<ThemePreference, string> = {
  system: '시스템 설정',
  light: '라이트',
  dark: '다크',
}

/**
 * ggac 이식: 테마는 `<html data-theme>`가 아니라 **업무툴 루트(`[data-work-app]`)의 `data-work-theme`**에 둔다 —
 * 공개 사이트와 같은 문서를 쓰므로 바깥까지 어두워지지 않게(src/work/styles.css·tailwind.config.js darkMode).
 */
export const THEME_ATTRIBUTE = 'data-work-theme'

export function applyThemePreference(pref: ThemePreference, root: HTMLElement): void {
  if (pref === 'system') root.removeAttribute(THEME_ATTRIBUTE)
  else root.setAttribute(THEME_ATTRIBUTE, pref)
}

/** 업무툴 루트(없으면 null — 셸 밖) */
export function workThemeRoot(doc: Document = document): HTMLElement | null {
  return doc.querySelector<HTMLElement>('[data-work-app]')
}

// ggac 이식: 원본의 첫 페인트 전 인라인 스크립트(THEME_INIT_SCRIPT)는 두지 않는다 — ggac CSP가 인라인 스크립트를 막을 수 있다.
// 저장된 테마는 ThemeToggle이 마운트될 때 업무툴 루트에 적용한다(어두운 테마는 첫 페인트에 잠깐 밝게 보일 수 있다).
