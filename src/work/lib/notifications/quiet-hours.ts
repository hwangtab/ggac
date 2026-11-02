import { z } from 'zod'

/**
 * 방해 금지(조용한 시간) — work.staff_prefs.quiet_*(0027). 시각은 Asia/Seoul 고정.
 * 규칙은 DB 의 work.in_quiet_hours() 와 같다(푸시 수신자 판정은 DB 가 한다 — 이 모듈은 UI 안내·검증용):
 *   매일 [start, end) 분(자정 기준, start > end 면 자정을 넘는 구간, 같으면 구간 없음) + weekends 면 토·일 종일.
 */
export type QuietPrefs = {
  enabled: boolean
  /** 자정부터의 분(0~1439) */
  start: number
  end: number
  weekends: boolean
}

export const DEFAULT_QUIET: QuietPrefs = {
  enabled: false,
  start: 22 * 60,
  end: 8 * 60,
  weekends: true,
}

const SEOUL = 'Asia/Seoul'

function seoulParts(at: Date): { dow: number; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: SEOUL,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at)
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? ''
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'))
  return { dow, minutes: Number(get('hour')) * 60 + Number(get('minute')) }
}

export function isQuietNow(prefs: QuietPrefs, at: Date = new Date()): boolean {
  if (!prefs.enabled) return false
  const { dow, minutes } = seoulParts(at)
  if (prefs.weekends && (dow === 0 || dow === 6)) return true
  if (prefs.start === prefs.end) return false
  return prefs.start < prefs.end
    ? minutes >= prefs.start && minutes < prefs.end
    : minutes >= prefs.start || minutes < prefs.end
}

/** 분 → "HH:mm" */
export function minutesToTime(minutes: number): string {
  const m = Math.min(Math.max(Math.trunc(minutes), 0), 1439)
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

/** "HH:mm" → 분(형식이 틀리면 null) */
export function timeToMinutes(value: string): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value)
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}

const timeSchema = z.string().transform((v, ctx) => {
  const minutes = timeToMinutes(v)
  if (minutes === null) {
    ctx.addIssue({ code: 'custom', message: '시각을 HH:mm 형식으로 입력해 주세요.' })
    return z.NEVER
  }
  return minutes
})

export const quietPrefsSchema = z.object({
  enabled: z.boolean(),
  start: timeSchema,
  end: timeSchema,
  weekends: z.boolean(),
})

export const DIGEST_MODES = ['normal', 'hourly', 'off'] as const
export type DigestMode = (typeof DIGEST_MODES)[number]
export const DIGEST_MODE_LABEL: Record<DigestMode, string> = {
  normal: '10분 넘게 안 읽으면 보내기',
  hourly: '1시간 넘게 안 읽으면 보내기',
  off: '메일로 받지 않기',
}
export const digestModeSchema = z.enum(DIGEST_MODES)
