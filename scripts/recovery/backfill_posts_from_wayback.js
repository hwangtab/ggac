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
