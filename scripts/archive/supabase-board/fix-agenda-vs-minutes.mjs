// 안건지(사전 검토본)였던 회의의 board_minutes(회의록 란)에 안건지 본문이 잘못 들어가 있다.
// 안건지 ≠ 회의록이므로 해당 회의의 회의록을 제거한다(안건은 board_agendas에 보존됨).
// 대상: 2026년 제1차(2026-01-30), 2026년 제3차(2026-04-02) — 원본이 '_안건지.md'였던 회의.
//
// 실행: node scripts/fix-agenda-vs-minutes.mjs
// ⛔ 보관용(archive). **실행하지 마라 — 실행해도 즉시 중단된다.**
//
// 이 스크립트는 이사회 데이터를 **Supabase**에 쓴다. 단계 4에서 이사회
// 데이터(board_meetings·board_agendas·board_minutes·board_documents)의 권위는
// Turso로 옮겨졌고, 앱은 더 이상 Supabase를 읽지 않는다. 그런데 `.env.local`에
// Supabase 값이 남아 있으면 이 스크립트는 **버려진 사본에 쓰고 성공 메시지를
// 내고 끝난다** — 국장이 회의 제목을 고쳐도 화면은 안 변하고, 아무도 이유를
// 모른다(최종 리뷰 B-6). 검증 스크립트는 더 나쁘다: 버려진 사본을 "검증"해 준다.
//
// 조용한 성공이 제일 나쁘므로, 포팅되기 전까지는 아래 가드가 무조건 막는다.
// 다시 필요해지면 `src/db/queries/board.ts`(Turso 쿼리 계층)를 쓰도록 포팅해
// `scripts/`로 되돌린다. 그때 이 가드를 지운다.
//
// 실행 흐름은 그대로 남겨 둔다(포팅할 때 원본 로직이 필요하다).
console.error(
  '[archive] 이 스크립트는 Supabase에 씁니다. 이사회 데이터의 권위는 Turso입니다 — ' +
    '실행해도 운영 화면에는 아무 영향이 없고, 버려진 사본만 바꿉니다. ' +
    'src/db/queries/board.ts 기반으로 포팅한 뒤에 쓰십시오.'
)
process.exit(1)

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
