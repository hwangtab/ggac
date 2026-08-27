// ⛔ 무해화됨 — Supabase→Turso 컷오버 잔재. **실행해도 즉시 중단된다.**
//
// 이 스크립트는 Wayback Machine 스냅샷에서 본문을 긁어 Supabase
// `posts.content`·`comments.content`를 UPDATE한다.
// `scripts/recovery/README.md`가 복붙용 명령으로 안내하고 있었다(같은 커밋에서 수정).
//
// 컷오버(2026-08-26) 이후 앱은 Supabase를 어디에서도 읽지 않는다. 그런데
// `.env.local`에 Supabase 값이 남아 있으면 이 스크립트는 **버려진 사본을
// 건드리고 성공 메시지를 내고 끝난다** — 화면은 그대로인데 아무도 이유를
// 모른다. 조용한 성공이 이 저장소에서 가장 비싼 실패이므로 아래 가드가
// 무조건 막는다. 지금 이걸 막고 있는 건 `dotenv` 미설치나 따옴표 파싱
// 실패 같은 **우연**이었다 — `npm i dotenv` 한 번이나
// `set -a; source .env.local; set +a`(scripts/turso/README.md가 DB 작업 전에
// 하라고 안내하는 바로 그 명령)면 그 우연은 사라진다.
//
// 게시글·댓글 본문의 권위는 Turso `posts`·`comments`다
// (`src/db/schema/content.ts`, 쿼리 계층 `src/db/queries/posts.ts`·
// `src/db/queries/comments.ts`). "본문이 비었다"를 실제로 고치려면 Turso를
// 대상으로 하는 백필을 새로 써야 한다 — Wayback 파싱 로직(아래)은 그대로
// 재사용할 수 있고, DB 접근부만 `@libsql/client`로 바꾸면 된다.
//
// 실행 흐름은 그대로 남겨 둔다(다시 필요해지면 포팅할 때 원본 로직이 필요하다).
console.error(
  '[중단] 이 스크립트는 Supabase `posts.content`·`comments.content`를 덮어씁니다. ' +
    '본문의 권위는 Turso입니다 — 실행해도 운영 화면은 그대로입니다. ' +
    'Turso를 대상으로 포팅한 뒤에 쓰십시오(src/db/queries/posts.ts·comments.ts).'
)
process.exit(1)
/**
 * GGAC 데이터 복구 보완 스크립트
 * - Wayback Machine 스냅샷에서 /board/[id] 페이지를 가져와
 *   embedded JSON(initial-post-data)로 게시글/댓글 내용을 보강합니다.
 * - 2025-09-10 23:59:59 KST 이전의 게시물만 대상으로 합니다.
 *
 * 사용법:
 *   1) .env.local에 NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 설정
 *   2) node scripts/recovery/backfill_posts_from_wayback.js [--dry]
 */

/* eslint-disable no-console */
const fs = require('fs')
const path = require('path')
const { createClient } = require('@supabase/supabase-js')

// Load .env.local manually (no dotenv dependency)
try {
  const envPath = path.join(process.cwd(), '.env.local')
  if (fs.existsSync(envPath)) {
    const env = fs.readFileSync(envPath, 'utf8')
    env.split('\n').forEach(line => {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) return
      const [k, v] = trimmed.split('=')
      if (k && v && !process.env[k]) process.env[k] = v
    })
    console.log('✅ Loaded .env.local')
  }
} catch (e) {
  console.warn('⚠️ Could not load .env.local:', e.message)
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('❌ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})
const DRY_RUN = process.argv.includes('--dry')

// Helpers
const CUTOFF_ISO = '2025-09-10T14:59:59.000Z' // 2025-09-10 23:59:59+09 in UTC

async function getWaybackSnapshotUrl(postId) {
  const target = `https://ggac.kr/board/${postId}`
  const ts = '20250910' // YYYYMMDD
  const api = `https://archive.org/wayback/available?url=${encodeURIComponent(target)}&timestamp=${ts}`
  const res = await fetch(api)
  if (!res.ok) return null
  const json = await res.json()
  const closest = json?.archived_snapshots?.closest
  if (!closest || !closest.available || !closest.url) return null
  return closest.url
}

function extractInitialJson(html) {
  const m = html.match(/<script id="initial-post-data"[^>]*>([\s\S]*?)<\/script>/i)
  if (!m) return null
  try {
    return JSON.parse(m[1])
  } catch (e) {
    return null
  }
}

async function backfillOne(post) {
  const postId = post.id
  const snapUrl = await getWaybackSnapshotUrl(postId)
  if (!snapUrl) return { postId, status: 'no_snapshot' }

  const res = await fetch(snapUrl)
  if (!res.ok) return { postId, status: 'fetch_failed', code: res.status }

  const html = await res.text()
  const initial = extractInitialJson(html)
  if (!initial || !initial.post) return { postId, status: 'json_missing' }

  const fullPost = initial.post
  const comments = Array.isArray(initial.comments) ? initial.comments : []

  if (DRY_RUN) {
    return {
      postId,
      status: 'dry_ok',
      title: fullPost.title?.slice(0, 60),
      contentLen: (fullPost.content || '').length,
      comments: comments.length,
    }
  }

  // Update post content/title/category if available
  const { error: upPostErr } = await supabase
    .from('posts')
    .update({
      title: fullPost.title || post.title,
      content: fullPost.content || post.content,
      content_format: fullPost.content_format || 'html',
      category: fullPost.category || post.category,
      updated_at: new Date().toISOString(),
    })
    .eq('id', postId)

  if (upPostErr) return { postId, status: 'update_failed', error: upPostErr.message }

  // Update comments content if any
  let updatedComments = 0
  for (const c of comments) {
    if (!c?.id || !c?.content) continue
    const { error: upCErr } = await supabase
      .from('comments')
      .update({ content: c.content, updated_at: new Date().toISOString() })
      .eq('id', c.id)
    if (!upCErr) updatedComments++
  }

  return {
    postId,
    status: 'ok',
    contentLen: (fullPost.content || '').length,
    updatedComments,
  }
}

async function main() {
  console.log('🔄 Fetching target posts to backfill (<= 2025-09-10 KST)...')
  const { data: posts, error } = await supabase
    .from('posts')
    .select('id,title,content,category,created_at')
    .lte('created_at', CUTOFF_ISO)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('❌ Failed to query posts:', error.message)
    process.exit(1)
  }

  const targets = (posts || []).filter(p => !p.content || p.content.startsWith('[복구됨]'))
  console.log(`🎯 Targets: ${targets.length} posts`)

  const results = []
  for (const post of targets) {
    try {
      const r = await backfillOne(post)
      results.push(r)
      console.log(`• ${post.id}: ${r.status}${r.contentLen ? ` (len=${r.contentLen})` : ''}`)
    } catch (e) {
      console.log(`• ${post.id}: exception ${e.message}`)
    }
    // Small delay to be polite to archive.org
    await new Promise(r => setTimeout(r, 500))
  }

  const summary = results.reduce((acc, r) => {
    acc[r.status] = (acc[r.status] || 0) + 1
    return acc
  }, {})
  console.log('\n📊 Summary:', summary)
}

main().catch(err => {
  console.error('💥 Fatal:', err)
  process.exit(1)
})
