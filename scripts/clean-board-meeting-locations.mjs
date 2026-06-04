// 이사회 회의 location에서 '온라인 (Zoom)', '온라인 (Lark 화상회의)' 등 플랫폼명(추정/가짜)을
// 제거하고 '온라인'으로 통일. 오프라인 장소(ACME 등)는 건드리지 않는다.
// 멱등: 이미 '온라인'이면 제외.
//
// 실행: node scripts/clean-board-meeting-locations.mjs
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

// '온라인'으로 시작하지만 정확히 '온라인'은 아닌 항목만 → '온라인'으로 정리
const { data, error } = await db
  .from('board_meetings')
  .update({ location: '온라인' })
  .like('location', '온라인%')
  .neq('location', '온라인')
  .select('title, meeting_date')

if (error) {
  console.error('실패:', error.message)
  process.exit(1)
}

if (!data || data.length === 0) {
  console.log('정리할 항목이 없습니다 (이미 모두 정리됨).')
} else {
  for (const m of data) {
    console.log(`${m.meeting_date}  ${m.title}  → location: 온라인`)
  }
  console.log(`\n완료: ${data.length}건 정리.`)
}
