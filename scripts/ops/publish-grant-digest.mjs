/**
 * 지원사업 회차를 로그인 없이 발행한다.
 *
 * 관리자 화면(`/admin/grants`)의 발행 버튼과 **같은 일**을 한다 —
 * `src/app/api/admin/grants/[id]/publish/route.ts`의 배선을 그대로 재현하며,
 * 게시글 생성·인앱 알림·이메일 발송·회차 상태 기록과 중복 발행을 막는 선점
 * (`claimGrantDigestForPublish`)까지 동일하다. 빠진 것은 HTTP·세션 인증·레이트리밋뿐이다.
 *
 * **왜 있나**: 관리자 브라우저 세션이 풀렸을 때 회차를 제때 내보내려면 손이 하나 더
 * 필요하다(2026-09-28 실측 — 세션 만료로 W40 발행이 막혔다). 발행은 주간 운영이라
 * 로그인 상태에 묶여 있으면 안 된다.
 *
 * **권한**: 이 스크립트는 인증을 검사하지 않는다. 대신 실행하려면 운영 Turso 자격증명과
 * Resend 키가 있어야 하고(`.env.local`), 그 둘을 가진 사람은 이미 무엇이든 할 수 있다.
 * 인증 계층을 대신하지 않으므로 **웹에서 부르는 경로로 만들지 마라.**
 *
 * 사용법 (저장소 어디서 실행해도 된다):
 *   node --experimental-strip-types scripts/ops/publish-grant-digest.mjs 2026-W40
 *   node --experimental-strip-types scripts/ops/publish-grant-digest.mjs 2026-W40 --real
 *   node --experimental-strip-types scripts/ops/publish-grant-digest.mjs 2026-W40 --real --author hwangtab@gmail.com
 *
 * **인자가 없으면 드라이런이다** — 아무것도 쓰지 않고 무엇이 나갈지만 센다. 실제 발송은
 * `--real`을 붙여야 한다. 메일은 회수되지 않으므로 기본값을 안전한 쪽에 둔다.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

/** 게시글 작성자 기본값. 조합 공식 계정 — 회차 글은 개인이 아니라 조합 명의로 나간다. */
const DEFAULT_AUTHOR_EMAIL = 'contact@ggac.kr'

function parseArgs(argv) {
  const rest = argv.slice(2)
  const weekKey = rest.find(a => !a.startsWith('--'))
  const real = rest.includes('--real')
  const ai = rest.indexOf('--author')
  const authorEmail = ai >= 0 ? rest[ai + 1] : DEFAULT_AUTHOR_EMAIL
  if (!weekKey || !/^\d{4}-W\d{2}$/.test(weekKey)) {
    throw new Error('주차를 YYYY-Www 형식으로 주세요. 예: 2026-W40')
  }
  if (ai >= 0 && !authorEmail) throw new Error('--author 뒤에 이메일을 주세요.')
  return { weekKey, real, authorEmail }
}

/**
 * `.env.local`을 process.env에 싣는다. **이미 있는 값은 덮지 않는다** — 셸에서 준 값이
 * 파일보다 우선이어야 임시로 다른 DB를 겨냥할 수 있다.
 */
function loadEnv() {
  const file = path.join(ROOT, '.env.local')
  if (!fs.existsSync(file)) throw new Error(`${file}이 없습니다. 운영 자격증명이 필요합니다.`)
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"|"$/g, '')
  }
  // 메일 본문 링크와 회신 주소. 없으면 각각 localhost와 noreply로 떨어져 **조용히**
  // 쓸모없는 메일이 나간다(회신은 유실된다). 운영 값으로 채운다.
  process.env.NEXT_PUBLIC_SITE_URL ||= 'https://ggac.kr'
  process.env.MAILBOX_REPLY_TO ||= 'contact@ggac.kr'
}

const { weekKey, real, authorEmail } = parseArgs(process.argv)
loadEnv()

const { getGrantDigestByWeekKey, claimGrantDigestForPublish, updateGrantDigest } = await import(
  '../../src/db/queries/grantDigests.ts'
)
const { createBulkNotifications } = await import('../../src/db/queries/notifications.ts')
const { createPost } = await import('../../src/db/queries/posts.ts')
const { listProfiles } = await import('../../src/db/queries/profiles.ts')
const { getUserSettingsByUserIds } = await import('../../src/db/queries/settings.ts')
const { sendEmail } = await import('../../src/lib/mail/send.ts')
const { runGrantPublish, summarizeMatchCounts } = await import(
  '../../src/lib/server/grantPublish.ts'
)
const { getSiteUrl } = await import('../../src/utils/site.ts')

const digest = await getGrantDigestByWeekKey(weekKey)
if (!digest) throw new Error(`${weekKey} 회차가 없습니다.`)
if (digest.status !== 'draft') {
  // 드라이런은 아무것도 쓰지 않으므로 막지 않는다 — 이미 나간 회차가 무엇이었는지
  // 되짚어 보는 데 쓴다. 실제 발행은 draft만 허용한다: publishing에 갇힌 회차를 여기서
  // 되살리면 재발행이 가능해지고, 그 재발행은 조합원 전원에게 메일을 **두 번** 보낸다
  // (회수되지 않는다). 라우트도 같은 이유로 draft만 선점한다.
  if (real) throw new Error(`상태가 '${digest.status}'입니다. draft만 발행할 수 있습니다.`)
  console.log(`(상태가 '${digest.status}'입니다 — 드라이런이라 그대로 진행합니다.)`)
}

// 승인·활성 조합원. 라우트와 같은 상한·필터를 쓴다.
const { rows } = await listProfiles({ status: 'approved', limit: 1000, offset: 0 })
const members = rows
  .filter(r => r.is_active && !r.is_suspended)
  .map(r => ({
    id: r.id,
    email: r.email,
    display_name: r.display_name,
    interest_genres: r.interest_genres ?? [],
    interest_regions: r.interest_regions ?? [],
  }))

const author = rows.find(r => r.email === authorEmail)
if (!author) throw new Error(`작성자 ${authorEmail}를 승인 회원에서 찾을 수 없습니다.`)
if (!author.is_admin) throw new Error(`작성자 ${authorEmail}가 관리자가 아닙니다.`)

// 조회가 통째로 실패해도 발송을 막지 않는다 — 라우트와 같게 미설정으로 취급한다.
let settingsByUserId = new Map()
try {
  settingsByUserId = await getUserSettingsByUserIds(members.map(m => m.id))
} catch (error) {
  console.error('  회원 설정 조회 실패 — 전원 미설정으로 취급합니다:', error.message)
}

const siteUrl = getSiteUrl()
console.log(
  `회차 ${weekKey} · 항목 ${digest.items.length}건(제외 안 된 것 ${digest.items.filter(i => !i.excluded).length}건)`
)
console.log(`대상 ${members.length}명 · 작성자 ${author.display_name} <${authorEmail}>`)
console.log(`siteUrl=${siteUrl} · replyTo=${process.env.MAILBOX_REPLY_TO}`)
console.log(
  real
    ? '모드: 실제 발행 — 메일이 나갑니다\n'
    : '모드: 드라이런 (--real을 붙여야 실제로 나갑니다)\n'
)

const mask = to => to.replace(/^(.{2}).*(@.*)$/, '$1***$2')
const dryRun = {
  createPost: async input => {
    console.log(
      `  (dry) 게시글 "${input.title}" · ${input.content.length}자 · ${input.content_format}`
    )
    return { id: 'dry-run-post' }
  },
  createBulkNotifications: async input => {
    console.log(`  (dry) 알림 ${input.user_ids.length}명 · "${input.message}"`)
    return input.user_ids.length
  },
  sendEmail: async input => {
    console.log(`  (dry) 메일 → ${mask(input.to)} · "${input.subject}"`)
    return null
  },
}

const log = {
  info: (msg, meta) => console.log('  [info]', msg, meta ? JSON.stringify(meta) : ''),
  error: (msg, meta) => console.error('  [error]', msg, meta ? JSON.stringify(meta) : ''),
}

// 선점은 실제 발행일 때만. 드라이런이 회차를 publishing으로 바꾸면 안 된다.
const digestToPublish = real ? await claimGrantDigestForPublish(digest.id) : digest
if (!digestToPublish) throw new Error('선점에 실패했습니다 — 이미 발행 중이거나 발행된 회차입니다.')

let result
try {
  result = await runGrantPublish({
    digest: digestToPublish,
    authorId: author.id,
    members,
    settingsByUserId,
    siteUrl,
    now: new Date(),
    createPost: real ? input => createPost(input) : dryRun.createPost,
    createBulkNotifications: real
      ? input => createBulkNotifications(input)
      : dryRun.createBulkNotifications,
    sendEmail: real ? sendEmail : dryRun.sendEmail,
    log,
  })
} catch (error) {
  // 게시글 생성 실패(runGrantPublish가 던지는 유일한 지점). 되돌리지 않으면 회차가
  // publishing에 갇혀 다시 발행할 수 없다 — 라우트와 같은 복구다.
  if (real) {
    try {
      await updateGrantDigest(digest.id, { status: 'draft' })
      console.error('  게시글 생성 실패 — 회차를 draft로 되돌렸습니다.')
    } catch (rollbackError) {
      console.error(
        `  !! draft 되돌리기 실패 — 회차 ${digest.id}가 publishing에 갇혔습니다:`,
        rollbackError.message
      )
    }
  }
  throw error
}

if (real) {
  try {
    await updateGrantDigest(digest.id, {
      status: 'published',
      post_id: result.post_id,
      published_at: new Date().toISOString(),
    })
  } catch (error) {
    // 게시글도 메일도 이미 나갔다. draft로 되돌리면 재발행이 가능해지고 메일이 두 번
    // 나간다 — 회수되지 않는다. 사람이 손으로 고칠 수 있게 필요한 것만 남기고 죽는다.
    console.error(
      `\n!! 게시글(${result.post_id})은 발행됐지만 회차 상태 기록에 실패했습니다.\n` +
        `   회차 ${digest.id}가 'publishing'에 갇혔습니다. **다시 발행하지 마세요**(메일이 두 번 나갑니다).\n` +
        `   상태를 손으로 'published'로 고치고 post_id를 채워 주세요.`
    )
    throw error
  }
}

const stats = summarizeMatchCounts(result.per_member.map(p => p.matched))
console.log('\n=== 결과 ===')
console.log(
  `게시글 ${result.post_id} · 실린 공고 ${result.post_item_count}건 · 알림 ${result.notified}명`
)
console.log(
  `메일 성공 ${result.email_sent} · 실패 ${result.email_failed} · ` +
    `수신거부 ${result.email_skipped_optout} · 주소오류 ${result.email_skipped_address} · ` +
    `0건매치 ${result.email_skipped_nomatch}`
)
console.log(`수신 건수: 최소 ${stats.min} · 중앙값 ${stats.median} · 최대 ${stats.max}`)
if (result.email_errors.length > 0) {
  console.log('실패 상세:')
  for (const e of result.email_errors) console.log(`  · ${e.to} — ${e.error}`)
}
if (!real) console.log('\n드라이런이었습니다. 실제로 보내려면 --real을 붙이세요.')
