// 이사회 회의 location에서 '온라인 (Zoom)', '온라인 (Lark 화상회의)' 등 플랫폼명(추정/가짜)을
// 제거하고 '온라인'으로 통일. 오프라인 장소(ACME 등)는 건드리지 않는다.
// 멱등: 이미 '온라인'이면 제외.
//
// 실행: node scripts/clean-board-meeting-locations.mjs
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
