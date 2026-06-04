// 입력된 이사회 회의를 목록 정렬(created_at desc = 최신 상단) 그대로 조회해 검증.
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

const env = {}
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const { data: meetings, error } = await db
  .from('board_meetings')
  .select('id, title, meeting_date, status, created_at')
  .order('created_at', { ascending: false })
if (error) {
  console.error(error.message)
  process.exit(1)
}

console.log('=== 목록 정렬 순서 (위 = 최신, 웹 표시 순서와 동일) ===')
for (const m of meetings) {
  const { count: agendas } = await db
    .from('board_agendas')
    .select('*', { count: 'exact', head: true })
    .eq('meeting_id', m.id)
  const { count: minutes } = await db
    .from('board_minutes')
    .select('*', { count: 'exact', head: true })
    .eq('meeting_id', m.id)
  console.log(`${m.meeting_date}  [${m.status}]  ${m.title}  · 안건 ${agendas} · 회의록 ${minutes}`)
}
console.log(`\n총 ${meetings.length}건`)
