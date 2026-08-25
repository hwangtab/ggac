// 2026년 제1차·제3차 이사회는 안건지대로 회의가 진행·종료됐다. 안건지를 회의록 형식으로
// 다시 쓴 문서(..._회의록.md)를 board_minutes에 회의록으로 넣고, 해당 안건의 상태를
// proposed(제안) → resolved(의결)로 맞춰 회의록과 일관되게 한다.
// 멱등: 회의록이 이미 있으면 내용만 갱신.
//
// 실행: node scripts/restore-assembly-as-minutes.mjs
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
