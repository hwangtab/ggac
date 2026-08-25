// 2026년 제1차·제3차 이사회는 안건지대로 회의가 진행·종료됐다. 안건지를 회의록 형식으로
// 다시 쓴 문서(..._회의록.md)를 board_minutes에 회의록으로 넣고, 해당 안건의 상태를
// proposed(제안) → resolved(의결)로 맞춰 회의록과 일관되게 한다.
// 멱등: 회의록이 이미 있으면 내용만 갱신.
//
// 실행: node scripts/restore-assembly-as-minutes.mjs
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
import path from 'node:path'

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

const items = [
  { date: '2026-01-30', file: 'docs/이사회/2026-01-30_2026년_제1차_이사회_회의록.md' },
  { date: '2026-04-02', file: 'docs/이사회/2026-04-02_2026년_제3차_이사회_회의록.md' },
]

for (const it of items) {
  const { data: meeting, error: mErr } = await db
    .from('board_meetings')
    .select('id, title')
    .eq('meeting_date', it.date)
    .maybeSingle()
  if (mErr || !meeting) {
    console.error(`[${it.date}] 회의 조회 실패:`, mErr?.message || '없음')
    process.exit(1)
  }

  const content = readFileSync(path.resolve(it.file), 'utf8')

  const { data: existing } = await db
    .from('board_minutes')
    .select('id')
    .eq('meeting_id', meeting.id)
    .maybeSingle()

  if (existing) {
    const { error } = await db
      .from('board_minutes')
      .update({ content, content_format: 'markdown' })
      .eq('meeting_id', meeting.id)
    if (error) {
      console.error(`${meeting.title} 회의록 갱신 실패:`, error.message)
      process.exit(1)
    }
    console.log(`${meeting.title}: 회의록 갱신`)
  } else {
    const { error } = await db
      .from('board_minutes')
      .insert({ meeting_id: meeting.id, content, content_format: 'markdown' })
    if (error) {
      console.error(`${meeting.title} 회의록 생성 실패:`, error.message)
      process.exit(1)
    }
    console.log(`${meeting.title}: 회의록 생성`)
  }

  // 회의가 종료됐으므로 제안(proposed) 안건을 의결(resolved)로 정리
  const { data: updatedAgendas, error: agErr } = await db
    .from('board_agendas')
    .update({ status: 'resolved' })
    .eq('meeting_id', meeting.id)
    .eq('status', 'proposed')
    .select('id')
  if (agErr) {
    console.error(`${meeting.title} 안건 상태 갱신 실패:`, agErr.message)
    process.exit(1)
  }
  console.log(`  안건 ${updatedAgendas?.length ?? 0}건 proposed → resolved`)
}

console.log('\n완료.')
