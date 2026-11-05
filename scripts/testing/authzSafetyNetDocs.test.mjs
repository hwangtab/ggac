import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * 적대 감사(2026-08-27) — 정적 가드가 인가를 강제하지 않는다. 우회 15가지 중
 * **11가지가 초록불**이었다. 문제는 가드의 한계 자체가 아니라(정적 분석의
 * 원리적 한계다) **문서가 그 한계를 말하지 않아 과신을 부른 것**이다.
 * 실제로 컷오버 수행자가 "가드가 인가를 지킨다"고 믿고 보고했다.
 *
 * 이 테스트는 **그 정정이 문서에서 사라지지 않게** 못박는다. 코드가 아니라
 * 문서를 고정하는 것이 이상해 보일 수 있지만, 이 저장소에서 가장 비싼 실패는
 * 전부 "문서가 사실과 달라서 다음 사람이 잘못된 것을 믿은" 형태였다.
 */
const guard = readFileSync('scripts/testing/assert-runtime-risks.mjs', 'utf8')
const claudeMd = readFileSync('CLAUDE.md', 'utf8')
const tursoReadme = readFileSync('scripts/turso/README.md', 'utf8')

test('가드 파일이 자기 한계를 서두에 밝힌다', () => {
  const head = guard.slice(0, 4000)
  assert.match(head, /지키지 않는 것/, '무엇을 못 지키는지 없으면 다음 사람이 과신한다')
  assert.match(head, /도달 가능성·실행 순서·데이터 흐름/, '못 보는 것을 구체적으로 적어야 한다')
  assert.match(head, /test:e2e:authz/, '진짜 안전망이 어디인지 가리켜야 한다')
})

test('CLAUDE.md가 인가 안전망을 E2E로 안내한다', () => {
  assert.match(claudeMd, /권한의 안전망은 E2E다/, '인가를 바꾸는 사람이 가장 먼저 보는 문서다')
  assert.match(claudeMd, /test:e2e:authz/)
})

test('컷오버 절차서에도 같은 정정이 있다', () => {
  assert.match(tursoReadme, /인가는 E2E가 지킨다/)
})

test('세 문서가 같은 기준선(331)을 말한다', () => {
  // 이름은 "세 문서"인데 가드 파일(`assert-runtime-risks.mjs`)은 빠져 있었다 —
  // 그래서 기준선을 올린 첫 회차에 그 파일만 낡은 숫자로 남았는데도 초록이었다.
  //
  // 331은 2026-11-05(앱 편집 버그 수정 — 이사회 서류 중복 저장·zod eval CSP 거짓 경보 — 뒤, 운영 빌드 서버) 실측이다: 총 333건 중
  // 331 passed, 1 failed(정책 36), 1 skipped. 328에서 늘어난 3건은 board-work-layout 의 CSP 회귀 1건과 main 메일함 2건이다.
  //
  // 328은 2026-11-05(main의 메일함 발신자 필터 0037·PR #73~#75 를 받은 뒤, 운영 빌드 서버) 실측이다: 총 330건 중 328 passed,
  // 1 failed(정책 36), 1 skipped. 326에서 늘어난 2건은 main 의 메일함 테스트다. 아래 326은 그 직전 회차다.
  //
  // 326은 2026-11-05(이사회 서류 앱 편집(당시 번호 0037, 지금 0038) 뒤, HWPX 플래그를 준 실행, 운영 빌드 서버, PLAYWRIGHT_PORT=3103) 실측이다:
  // 총 328건 중 326 passed, 1 failed(정책 36), 1 skipped(메일함 첨부 다운로드 기록). 313에서 늘어난 13건은
  // authz-board-document-edit.spec.ts 8건, board-document-edit.spec.ts 2건이고, 나머지 3건은 main 쪽 313 실측과의 차이다(이 브랜치 스펙이 아니다).
  // 아래 313은 그 직전 회차다.
  //
  // 313은 2026-11-05(새 한글 문서(HWPX) 켜기, HWPX 플래그를 준 실행, 운영 빌드 서버) 실측이다: 총 315건 중 313 passed,
  // 1 failed(정책 36), 1 skipped(메일함 첨부 다운로드 기록). 305에서 늘어난 7건은 authz-mailbox-compose.spec.ts 5건(PR #68·#69)과
  // board-work-editors.spec.ts 의 HWPX 2건이다. 아래 305는 그 직전 회차다.
  //
  // 305는 2026-11-04(조합원 내 문서함 0036·메일함 새 메일 0035와 PR #66 보강 뒤, 운영 빌드 서버) 실측이다: 총 308건 중 305 passed,
  // 1 failed(정책 36), 2 skipped(메일함 첨부 다운로드 기록·HWPX 플래그 없는 새 HWPX 문서). 275에서 늘어난 30건은
  // authz-mailbox-compose.spec.ts 18건(main이 넣었고 기준선은 재지 않았다)과 authz-member-documents.spec.ts 7건,
  // member-documents.spec.ts 5건이다. 287·302는 main 병합 전 같은 브랜치의 중간 실측이라 기준선으로 쓴 적이 없다.
  // 아래 275는 그 직전 회차다.
  //
  // 275는 2026-11-03(R4 마무리 — 이사회 서류 삭제 시 미리보기 캐시 정리·파일 속 글자 검색(0034) 뒤, 운영 빌드 서버)
  // 실측이다: 총 277건 중 275 passed, 1 failed(정책 36), 1 skipped(메일함 첨부 다운로드 기록). 늘어난 1건은
  // board-work-library.spec.ts의 파일 속 글자 검색이다. 아래 274는 그 직전 회차다.
  //
  // 274는 2026-11-03(통합 재설계 R4 — 이사 메뉴 재편·업무툴 직함·자료실 이사회 서류 뒤, 운영 빌드 서버) 실측이다: 총 276건 중
  // 274 passed, 1 failed(정책 36), 1 skipped(메일함 첨부 다운로드 기록). 늘어난 6건은 board-work-library.spec.ts다.
  // 아래 268은 그 직전 회차다.
  //
  // 268은 2026-11-03(이사회 업무툴 통합 재설계 R1~R3 뒤, 운영 빌드 서버) 실측이다: 총 270건 중 268 passed, 1 failed
  // (정책 36), 1 skipped(메일함 첨부 다운로드 기록) — 시드를 다시 돌리며 연달아 두 번 같았다. 늘어난 4건은 R1의
  // board-work-layout.spec.ts다. 아래 264는 그 직전 회차다.
  //
  // 264는 2026-11-03(이사회 업무툴 1~5단계와 타임뱅크·장터 경매를 합친 뒤, 운영 빌드 서버) 실측이다: 총 266건 중
  // 264 passed, 1 failed(정책 36 — 공개 Blob 토큰 없이 돌림), 1 skipped(메일함 첨부 다운로드 기록). 시험 Blob 저장소
  // 토큰과 편집기 env를 준 실행이다. 아래 "206 passed·4 failed·1 skipped"(환경 의존 실패) 문구는 세 문서가 이력으로 계속 밝힌다.
  //
  // 198은 2026-11-02(권한 E2E를 운영 빌드 서버로 옮긴 뒤) 실측이다: 총 200건 중
  // 198 passed, 1 failed(정책 36), 1 skipped(메일함 첨부 다운로드 기록) — 업무툴
  // 실제 업로드 스펙은 시험 저장소 토큰을 줬을 때다. 아래는 이전 회차의 기록이다.
  //
  // 98은 2026-09-14(정관 전용 화면을 내고 사이드 메뉴 맨 위에 올린 뒤)
  // 실측이다: 총 100건 중 98 passed, 1 failed(`authz-remaining.spec.ts` 정책
  // 36 — `PUBLIC_BLOB_READ_WRITE_TOKEN` 부재를 단언하는 기존 테스트로 이
  // 저장소의 다른 변경과 무관하다), 1 skipped(`authz-mailbox.spec.ts`의 첨부
  // 다운로드 기록 테스트 — 실제 Blob 객체가 있어야 검증 가능해서 스킵).
  // 70·89·92·93·94·96·97이었을 때도 마찬가지로 이 실패 1건은 별도였다.
  //
  // 210은 2026-11-03(타임뱅크 인가 스펙과 장터 경매를 합친 뒤)의 기준선이다: 총 211건 중
  // 210 passed, 1 skipped(위 첨부 다운로드 기록). Blob 토큰·토스 키가 없는
  // 환경에서는 4건이 환경 탓으로 더 빨간불이다(정책 36, 메일함 다운로드 2,
  // 펀딩 settle — 같은 날 실측 206 passed·4 failed·1 skipped). 세 문서 모두 그
  // 4건을 "환경 의존"으로 밝혀야 다음 사람이 197을 회귀로 읽지 않는다.
  //
  // 로컬에서는 하나 더 빨간불일 수 있다(`authz-mailbox.spec.ts`의 "관리자는
  // 화면에 들어가 메일함을 본다" — 본문 iframe 대기). main 기준으로도 같은
  // 자리에서 실패하는 환경 의존 실패다(2026-09-11 대조 실측).
  for (const [name, src] of [
    ['CLAUDE.md', claudeMd],
    ['scripts/turso/README.md', tursoReadme],
    ['scripts/testing/assert-runtime-risks.mjs', guard],
  ]) {
    assert.match(src, /331 passed/, `${name}의 기준선이 사라지면 "몇 건이 정상인지"를 잃는다`)
    // 낡은 숫자가 **함께** 남아 있으면 위 match만으로는 못 잡는다.
    assert.doesNotMatch(
      src,
      // `(?<![0-9])`: 새 기준선이 옛 두 자리 숫자에 걸리지 않게 숫자 경계를 둔다.
      /기준선[^\n]*(?<![0-9])(50|64|70|89|92|93|94|96|97|98|105|110|112|115|116|117|118|125|130|131|141|142|143|144|145|146|147|198|201|210|264|268|274|275|287|302|305|313|326|328) passed/,
      `${name}에 옛 기준선이 살아 있으면 다음 사람이 어느 쪽을 믿을지 알 수 없다`
    )
    assert.match(
      src,
      /206 passed·4 failed·1 skipped/,
      `${name}이 환경 의존 실패 4건을 말하지 않으면 197이 회귀로 읽힌다`
    )
  }
})
