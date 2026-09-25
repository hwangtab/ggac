import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

/**
 * 펀딩 알림 **호출부**의 계약 — 응답 뒤에도 살아서 끝나는가.
 *
 * 서버리스 함수는 응답을 돌려주는 순간 얼 수 있다. 맨 promise로 띄운 알림은
 * 그때 그대로 죽는다 — 개설자는 승인·반려·마감·정산 준비·정산 지급 소식을
 * 영영 못 받고, 로그에도 실패가 남지 않는다(시작조차 못 했으므로).
 * `after()`가 응답 뒤까지 함수를 살려 두고, `maxDuration`이 그 시간을 준다.
 *
 * ## 왜 소스를 읽는가
 *
 * 라우트 모듈은 `@/` 별칭과 `next/headers`를 타므로 `node --test`가 그대로
 * 불러올 수 없다. 대신 **문법 구조**를 본다 — 주석과 문자열을 걷어낸 뒤 괄호를
 * 세어, 알림 호출이 정말 지연 실행 안에 들어 있는지 확인한다. "after라는 낱말이
 * 파일 어딘가에 있다"를 보는 검사가 아니다. 지연 밖으로 한 줄만 빼내도 걸린다.
 *
 * 필요한 시간은 **대량 발송기의 상한에서 계산한다** — 한 번에 최대
 * `MAX_BULK_RECIPIENTS`명에게, `BULK_MIN_INTERVAL_MS` 간격으로 보낸다.
 */

const content = await import('../../src/lib/funding/notifyContent.ts')
const notify = await import('../../src/lib/funding/notify.ts')

const NOTIFY_FUNCTIONS = Object.keys(notify).filter(name => name.startsWith('notify'))

/** 대량 발송기를 타는 알림 — 한 번에 수백 명에게 나간다. */
const BULK_NOTIFIERS = new Set([
  'notifyCampaignSubmitted',
  'notifyRewardDeliveryChanged',
  'notifyPledgesShipped',
])

/** 상한까지 갔을 때 발송에만 걸리는 시간(초). */
const BULK_SECONDS = Math.ceil((content.MAX_BULK_RECIPIENTS * content.BULK_MIN_INTERVAL_MS) / 1000)
/** 한 통짜리 알림도 예산을 적어 둔다 — 플랫폼 기본값은 10~15초다. */
const SINGLE_SECONDS = 30

const API_ROOT = path.resolve('src/app/api')

function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else if (entry.endsWith('.ts')) out.push(full)
  }
  return out
}

/** 주석과 문자열을 같은 길이의 공백으로 바꾼다 — 괄호 세기를 망치지 않게. */
function blankCommentsAndStrings(src) {
  const out = src.split('')
  let i = 0
  const blank = (from, to) => {
    for (let k = from; k < to && k < out.length; k++) if (out[k] !== '\n') out[k] = ' '
  }
  while (i < src.length) {
    const two = src.slice(i, i + 2)
    if (two === '//') {
      const end = src.indexOf('\n', i)
      blank(i, end === -1 ? src.length : end)
      i = end === -1 ? src.length : end
    } else if (two === '/*') {
      const end = src.indexOf('*/', i + 2)
      const stop = end === -1 ? src.length : end + 2
      blank(i, stop)
      i = stop
    } else if (src[i] === "'" || src[i] === '"' || src[i] === '`') {
      const quote = src[i]
      let j = i + 1
      while (j < src.length) {
        if (src[j] === '\\') j += 2
        else if (src[j] === quote) break
        else j += 1
      }
      blank(i + 1, j)
      i = j + 1
    } else {
      i += 1
    }
  }
  return out.join('')
}

/**
 * 이 위치의 호출이 **응답 뒤로 미뤄져 있는가**.
 *
 * 바깥으로 걸어 나가 아직 닫히지 않은 첫 구분자를 찾는다. 중괄호면 그냥 문장이라
 * 미뤄지지 않은 것이고(응답과 함께 죽는다), 괄호면 그 괄호를 여는 호출이
 * `after`이거나 그 사이에 화살표 함수가 있어야 한다(만료 크론처럼 클로저를
 * 모아 두었다 `after`에 한꺼번에 넘기는 모양).
 */
function isDeferred(src, at) {
  let depth = 0
  for (let i = at - 1; i >= 0; i--) {
    const c = src[i]
    if (c === ')' || c === '}' || c === ']') depth += 1
    else if (c === '(' || c === '{' || c === '[') {
      if (depth > 0) {
        depth -= 1
        continue
      }
      if (c !== '(') return false
      const head = src.slice(0, i)
      const callee = /([A-Za-z_$][\w$]*)\s*$/.exec(head)
      if (callee && callee[1] === 'after') return true
      return src.slice(i, at).includes('=>')
    }
  }
  return false
}

const routeFiles = walk(API_ROOT).filter(f =>
  readFileSync(f, 'utf8').includes('@/lib/funding/notify')
)

test('펀딩 알림을 부르는 라우트를 찾아낸다', () => {
  assert.ok(routeFiles.length >= 6, `호출부를 ${routeFiles.length}개밖에 못 찾았다`)
})

for (const file of routeFiles) {
  const rel = path.relative(process.cwd(), file)
  const raw = readFileSync(file, 'utf8')
  const src = blankCommentsAndStrings(raw)

  test(`${rel} — 알림이 응답 뒤로 미뤄져 있다`, () => {
    let found = 0
    for (const name of NOTIFY_FUNCTIONS) {
      const re = new RegExp(`\\b${name}\\s*\\(`, 'g')
      let m
      while ((m = re.exec(src)) !== null) {
        // import 문의 이름은 호출이 아니다.
        const lineStart = src.lastIndexOf('\n', m.index) + 1
        if (/^\s*import\b/.test(src.slice(lineStart, m.index))) continue
        found += 1
        assert.ok(
          isDeferred(src, m.index),
          `${name}이 맨 promise로 떠 있다 — 응답과 함께 얼어 아무에게도 가지 않는다`
        )
      }
    }
    assert.ok(found > 0, '알림 모듈을 임포트해 놓고 부르지 않는다')
  })

  test(`${rel} — 알림이 끝날 시간을 예산으로 적어 두었다`, () => {
    const declared = /export\s+const\s+maxDuration\s*=\s*(\d+)/.exec(src)
    assert.ok(declared, 'maxDuration이 없다 — 플랫폼 기본값(10~15초)에 알림이 잘린다')
    const needsBulk = [...BULK_NOTIFIERS].some(name =>
      new RegExp(`\\b${name}\\s*\\(`).test(src.replace(/^\s*import[\s\S]*?from.*$/gm, ''))
    )
    const required = needsBulk ? BULK_SECONDS : SINGLE_SECONDS
    assert.ok(
      Number(declared[1]) >= required,
      `maxDuration=${declared[1]}초로는 모자란다 — 최소 ${required}초가 필요하다`
    )
  })
}
