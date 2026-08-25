// 이사회 회의 제목을 'YYYY년 제N차 이사회' 형식으로 통일.
// 2025년 회의(제1~6차)는 연도 접두사가 없어 '2025년 '을 붙인다. 2026년 회의는 이미 형식 일치.
// 멱등: 이미 변경된 제목('2025년 제N차 이사회')은 매칭되지 않아 영향 없음.
//
// 실행: node scripts/rename-board-meeting-titles.mjs
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

const renames = [
  ['제1차 이사회', '2025년 제1차 이사회'],
  ['제2차 이사회', '2025년 제2차 이사회'],
  ['제3차 이사회', '2025년 제3차 이사회'],
  ['제4차 이사회', '2025년 제4차 이사회'],
  ['제5차 이사회', '2025년 제5차 이사회'],
  ['제6차 이사회', '2025년 제6차 이사회'],
]

for (const [oldTitle, newTitle] of renames) {
  const { data, error } = await db
    .from('board_meetings')
    .update({ title: newTitle })
    .eq('title', oldTitle)
    .select('id')
  if (error) {
    console.error(`[${oldTitle}] 실패:`, error.message)
    process.exit(1)
  }
  console.log(`${oldTitle} → ${newTitle}  (${data?.length ?? 0}건)`)
}
console.log('\n완료.')
