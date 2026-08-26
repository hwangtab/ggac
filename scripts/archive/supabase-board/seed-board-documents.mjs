// 조합 기본 서류(docs/기본자료)와 2026 정기총회 자료(docs/2026 총회)를
// board-documents 비공개 버킷에 업로드하고 board_documents 메타를 등록한다.
// 기본 서류는 서류함 카테고리(등록증/정관/계약/기타), 총회 자료는 '총회' 카테고리.
// 멱등: 같은 title+category가 이미 있으면 건너뛴다.
//
// 실행: node scripts/seed-board-documents.mjs
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
import { readFileSync, statSync } from 'node:fs'
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
const BUCKET = 'board-documents'

const mimeOf = f =>
  f.toLowerCase().endsWith('.pdf')
    ? 'application/pdf'
    : f.toLowerCase().endsWith('.png')
      ? 'image/png'
      : 'application/octet-stream'

const docs = [
  // === 기본자료 → 서류함 ===
  {
    dir: 'docs/기본자료',
    file: '경아콜_사업자등록증.pdf',
    title: '사업자등록증',
    category: '등록증',
  },
  {
    dir: 'docs/기본자료',
    file: '경기아트콜렉티브_등기부등본.pdf',
    title: '등기부등본',
    category: '등록증',
  },
  {
    dir: 'docs/기본자료',
    file: '경아콜_법인등기부등본.pdf',
    title: '법인 등기부등본',
    category: '등록증',
  },
  {
    dir: 'docs/기본자료',
    file: '경기아트콜렉티브_신고확인증.pdf',
    title: '협동조합 설립신고확인증',
    category: '등록증',
  },
  {
    dir: 'docs/기본자료',
    file: '경아콜_법인인감증명서.pdf',
    title: '법인 인감증명서',
    category: '등록증',
  },
  {
    dir: 'docs/기본자료',
    file: '경기아트콜렉티브_정관_원본.pdf',
    title: '정관 (원본)',
    category: '정관',
  },
  {
    dir: 'docs/기본자료',
    file: '임대차계약서_경기아트콜렉티브.pdf',
    title: '임대차계약서',
    category: '계약',
  },
  {
    dir: 'docs/기본자료',
    file: '경아콜_사업제안서_v3_조직도_살짝수정.pdf',
    title: '사업제안서 (조직도 포함)',
    category: '기타',
  },
  {
    dir: 'docs/기본자료',
    file: '경기아트콜렉티브_로고투명.png',
    title: '조합 로고 (투명 배경)',
    category: '기타',
  },
  // === 2026 총회 → 정기총회('총회') ===
  {
    dir: 'docs/2026 총회',
    file: '2026년_정기총회_자료집.pdf',
    title: '2026 정기총회 자료집',
    category: '총회',
  },
  {
    dir: 'docs/2026 총회',
    file: '2026년_정기총회_회의록.pdf',
    title: '2026 정기총회 회의록',
    category: '총회',
  },
  {
    dir: 'docs/2026 총회',
    file: '감사보고서_초안.pdf',
    title: '2026 감사보고서 (초안)',
    category: '총회',
  },
  {
    dir: 'docs/2026 총회',
    file: '94404414801013_20250422-20260421_거래내역서.pdf',
    title: '거래내역서 (2025.4~2026.4)',
    category: '총회',
  },
  {
    dir: 'docs/2026 총회',
    file: '2026경아콜총회.png',
    title: '2026 정기총회 포스터',
    category: '총회',
  },
]

let inserted = 0
let skipped = 0
for (let i = 0; i < docs.length; i++) {
  const d = docs[i]
  const { data: existing, error: exErr } = await db
    .from('board_documents')
    .select('id')
    .eq('title', d.title)
    .eq('category', d.category)
    .maybeSingle()
  if (exErr) {
    console.error(`[${d.title}] 중복 조회 실패:`, exErr.message)
    process.exit(1)
  }
  if (existing) {
    console.log(`[skip] ${d.category} / ${d.title} 이미 존재`)
    skipped++
    continue
  }

  const filePath = path.join(d.dir, d.file)
  const buf = readFileSync(filePath)
  const size = statSync(filePath).size
  const mime = mimeOf(d.file)
  // Supabase Storage 키는 ASCII만 허용 → 경로는 인덱스+확장자로, 원본 한글명은 file_name에 보존
  const ext = (path.extname(d.file) || '.bin').toLowerCase()
  const storagePath = `seed/doc_${i}${ext}`

  const { error: upErr } = await db.storage
    .from(BUCKET)
    .upload(storagePath, buf, { contentType: mime, upsert: true })
  if (upErr) {
    console.error(`[${d.title}] 스토리지 업로드 실패:`, upErr.message)
    process.exit(1)
  }

  const { error: insErr } = await db.from('board_documents').insert({
    title: d.title,
    category: d.category,
    file_path: storagePath,
    file_name: d.file,
    file_size: size,
    mime_type: mime,
    uploaded_by: null,
  })
  if (insErr) {
    // 메타 등록 실패 시 업로드한 파일 롤백
    await db.storage.from(BUCKET).remove([storagePath])
    console.error(`[${d.title}] 메타 insert 실패:`, insErr.message)
    process.exit(1)
  }

  console.log(`[ok] ${d.category} / ${d.title}  (${(size / 1024).toFixed(0)}KB)`)
  inserted++
}

console.log(`\n완료: ${inserted}건 업로드, ${skipped}건 스킵 (총 ${docs.length})`)
