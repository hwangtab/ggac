'use client'

import { useEffect, useState } from 'react'
import { MonitorIcon, MoonIcon, SunIcon } from 'lucide-work'
import { Button } from '@work/components/ui/button'
import {
  THEME_LABEL,
  THEME_STORAGE_KEY,
  applyThemePreference,
  nextThemePreference,
  parseThemePreference,
  workThemeRoot,
  type ThemePreference,
} from '@work/lib/theme'
import { withEuro } from '@work/lib/text/josa'

function readStored(): ThemePreference {
  try {
    return parseThemePreference(window.localStorage.getItem(THEME_STORAGE_KEY))
  } catch {
    return 'system'
  }
}

/** 시스템 → 라이트 → 다크 순환 토글. */
export default function ThemeToggle({ className }: { className?: string }) {
  const [pref, setPref] = useState<ThemePreference>('system')

  useEffect(() => {
    const stored = readStored()
    setPref(stored)
    // ggac 이식: 첫 페인트 전 스크립트가 없어서 저장된 테마를 여기서 업무툴 루트에 적용한다
    const root = workThemeRoot()
    if (root) applyThemePreference(stored, root)
  }, [])

  function cycle() {
    const next = nextThemePreference(pref)
    setPref(next)
    const root = workThemeRoot()
    if (root) applyThemePreference(next, root)
    try {
      if (next === 'system') window.localStorage.removeItem(THEME_STORAGE_KEY)
      else window.localStorage.setItem(THEME_STORAGE_KEY, next)
    } catch {
      // 저장 불가(사생활 보호 모드 등) — 이번 방문에만 적용된다.
    }
  }

  const Icon = pref === 'dark' ? MoonIcon : pref === 'light' ? SunIcon : MonitorIcon
  const label = `화면 테마: ${THEME_LABEL[pref]} (눌러서 ${withEuro(THEME_LABEL[nextThemePreference(pref)])} 바꾸기)`

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={cycle}
      aria-label={label}
      className={className}
    >
      <Icon aria-hidden="true" />
    </Button>
  )
}
