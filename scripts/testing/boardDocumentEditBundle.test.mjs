import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * 이사회 서류 앱 편집의 업로드 라우트(`/edit-uploads`)가 kordoc 을 끌어오지 않게 못박는다. 2026-11-05 Vercel 배포에서
 * 이 라우트가 `@/lib/boardDocuments/versions`(HWP·HWPX 저장본 검사·웹 본문 다시 만들기 — kordoc)를 import 해 함수
 * 번들이 400MB(한도 250MB)가 되어 배포가 실패했다. 업로드 준비·토큰 판정은 `editUploads.ts`로 떼어 냈다.
 */
const HEAVY = [
  "'@/lib/boardDocuments/versions'",
  "'./versions'",
  "'@work/lib/files/extract-text'",
  "'@work/lib/files/editor-save-inspect'",
  "'@work/lib/files/extract-schedule'",
  "'kordoc'",
]

for (const file of [
  'src/app/api/board-room/documents/[id]/edit-uploads/route.ts',
  'src/lib/boardDocuments/editUploads.ts',
]) {
  test(`${file} 는 kordoc 을 부르는 모듈을 import 하지 않는다`, () => {
    const src = readFileSync(file, 'utf8')
    for (const h of HEAVY) {
      assert.ok(
        !src.includes(`from ${h}`),
        `${file} 가 ${h} 를 import 한다 — 함수 번들이 250MB 를 넘는다`
      )
    }
  })
}
