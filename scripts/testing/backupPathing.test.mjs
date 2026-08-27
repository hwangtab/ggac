import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * 적대 감사(2026-08-27)가 백업 경로 처리에서 셋을 잡았다. 전부 **복구 수단을
 * 조용히 없애는** 부류라 회귀를 못박는다.
 *
 *  ① 같은 UTC 날짜 재실행이 그날의 정상본을 덮어썼다. 사고 직후 "새 백업이나
 *    떠 두자"고 수동 트리거를 누르면 마지막 정상본을 스스로 지운다.
 *  ② 접미사가 붙은 백업을 최신 선택 정규식이 안 받아 **그날 최신본이 목록에서
 *    빠지고** 더 오래된 것을 최신이라고 집는다.
 *  ③ 접미사가 붙은 백업을 90일 정리가 안 받아 영원히 남는다.
 *
 * 정규식은 소스에서 뽑아 **실제 파일명**으로 돌린다 — 사본을 만들면 원본이
 * 갈라져도 통과하는, 이 저장소가 반복해 당한 형태가 된다.
 */
function extractRegex(source, marker) {
  // `pathname.match(/…/)` 형태에서 정규식 리터럴을 뽑는다.
  const idx = source.indexOf(marker)
  assert.ok(idx > 0, `${marker}를 찾지 못했다(소스가 바뀌었다)`)
  const m = source.slice(idx).match(/match\((\/(?:[^/\\]|\\.)+\/)\)/)
  assert.ok(m, '정규식 리터럴을 뽑지 못했다')
  return new RegExp(m[1].slice(1, -1))
}

const downloadSrc = readFileSync('scripts/turso/download-latest-backup.mjs', 'utf8')
const uploadSrc = readFileSync('scripts/turso/upload-backup.mjs', 'utf8')

const NAMES = {
  plain: 'backups/20260827.sql.gz',
  suffixed: 'backups/20260827-2.sql.gz',
  suffixed10: 'backups/20260827-10.sql.gz',
  notBackup: 'backups/README.txt',
}

test('최신 선택이 접미사 붙은 백업을 받는다', () => {
  const re = extractRegex(downloadSrc, 'const match = blob.pathname.match')
  assert.ok(re.test(NAMES.plain), '기본 이름을 받아야 한다')
  assert.ok(re.test(NAMES.suffixed), '접미사 백업을 놓치면 그날 최신본이 목록에서 빠진다')
  assert.ok(re.test(NAMES.suffixed10), '두 자리 접미사도 받아야 한다')
  assert.ok(!re.test(NAMES.notBackup), '백업이 아닌 파일을 집으면 안 된다')
})

test('최신 선택이 같은 날에는 접미사가 큰 쪽을 고른다', () => {
  assert.match(
    downloadSrc,
    /b\.stamp\.localeCompare\(a\.stamp\) \|\| b\.seq - a\.seq/,
    '날짜만 비교하면 같은 날 두 번째 백업이 최신으로 뽑히지 않는다'
  )
})

test('90일 정리가 접미사 붙은 백업도 만료시킨다', () => {
  const re = extractRegex(uploadSrc, 'const match = blob.pathname.match')
  assert.ok(re.test(NAMES.plain))
  assert.ok(re.test(NAMES.suffixed), '안 받으면 접미사 백업이 영원히 남아 보존 기간이 무의미해진다')
})

test('업로드가 기존 백업을 덮어쓰지 않는다', () => {
  assert.match(
    uploadSrc,
    /allowOverwrite:\s*false/,
    '덮어쓰기를 허용하면 사고 직후 수동 트리거가 마지막 정상본을 지운다'
  )
  assert.match(uploadSrc, /resolveUploadPath/, '빈 경로를 고르는 단계가 있어야 한다')
})

test('야간 백업이 껍데기 덤프를 통과시키지 않는다', () => {
  const wf = readFileSync('.github/workflows/turso-backup.yml', 'utf8')
  assert.match(wf, /MIN_TABLES=/, '표 개수 하한이 없으면 스키마만 있는 덤프가 통과한다')
  assert.match(wf, /MIN_INSERTS=/, 'INSERT 하한이 없으면 데이터가 빈 덤프가 통과한다')
  assert.match(
    wf,
    /for T in member_profiles posts user artists board_documents/,
    '핵심 표별 확인이 없으면 "표는 많은데 회원만 비었다"를 못 잡는다'
  )
})
