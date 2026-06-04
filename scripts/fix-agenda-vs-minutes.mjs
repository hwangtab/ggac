// 안건지(사전 검토본)였던 회의의 board_minutes(회의록 란)에 안건지 본문이 잘못 들어가 있다.
// 안건지 ≠ 회의록이므로 해당 회의의 회의록을 제거한다(안건은 board_agendas에 보존됨).
// 대상: 2026년 제1차(2026-01-30), 2026년 제3차(2026-04-02) — 원본이 '_안건지.md'였던 회의.
//
// 실행: node scripts/fix-agenda-vs-minutes.mjs
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

const env = {}
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}
const url = env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !serviceKey || url.includes('54321')) {
  console.error('운영 URL/서비스 키 확인 필요')
  process.exit(1)
}
const db = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const assemblyDates = ['2026-01-30', '2026-04-02']

for (const date of assemblyDates) {
  const { data: meeting, error: mErr } = await db
    .from('board_meetings')
    .select('id, title')
    .eq('meeting_date', date)
    .maybeSingle()
  if (mErr) {
    console.error(`[${date}] 회의 조회 실패:`, mErr.message)
    process.exit(1)
  }
  if (!meeting) {
    console.log(`[${date}] 회의 없음 — 건너뜀`)
    continue
  }

  const { data: minutes } = await db
    .from('board_minutes')
    .select('id, content')
    .eq('meeting_id', meeting.id)
    .maybeSingle()

  if (!minutes) {
    console.log(`${meeting.title}: 회의록 없음 (이미 정리됨)`)
    continue
  }

  const firstLine = (minutes.content || '').split('\n').find(l => l.trim()) || '(빈 내용)'
  console.log(`${meeting.title}: 회의록 란 첫 줄 = "${firstLine.trim().slice(0, 50)}"`)

  const { error: delErr } = await db.from('board_minutes').delete().eq('meeting_id', meeting.id)
  if (delErr) {
    console.error(`  → 삭제 실패:`, delErr.message)
    process.exit(1)
  }
  console.log(`  → 회의록 란 비움 (안건은 안건 목록에 유지)`)
}

console.log('\n완료.')
