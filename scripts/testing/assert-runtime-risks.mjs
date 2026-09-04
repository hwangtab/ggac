/**
 * # 이 파일이 지키는 것과 **지키지 않는 것**
 *
 * 여기 있는 검사는 **소스 텍스트를 훑는 정적 가드**다. "이 파일에 이 모양의
 * 코드가 있는가"를 본다. 그 이상을 하지 않는다.
 *
 * ## 못 지키는 것 — 적대 감사(2026-08-27)가 실증했다
 *
 * 인가 우회 15가지를 주입해 `test:runtime-risks`와 `tsc`를 돌린 결과
 * **11가지가 초록불**로 통과했다. 예를 들면:
 *
 * - `src/lib/server/authz.ts`의 `isApprovedActive` 맨 앞에 `if (profile) return true`
 *   한 줄 — 고정된 문구는 **그대로 남긴 채** 죽은 코드로 만든다. 이 한 줄로
 *   `isApprovedActiveAdmin`·`canAccessBoardRoom`·`requireActiveMember`·
 *   `requireAdmin`·`checkAdminPermission`이 전부 참이 된다
 * - `defineApiRoute`의 `auth` 디스패치를 `return undefined`로 — `auth: 'admin'`
 *   라우트 26개가 열리는데 특권 글롭 검사는 41개 전부 "정상"으로 보고한다
 * - 실제 게이트를 지우고 **호출되지 않는 헬퍼**에 같은 텍스트를 붙여 개수 맞추기
 * - 임포트와 같은 이름의 로컬 함수로 게이트 섀도잉
 * - 게이트 **앞에** 조기 반환 삽입 (순서를 안 본다)
 * - 고정된 게이트가 읽는 **변수**를 클라이언트 헤더와 OR
 *
 * 즉 이 가드는 **도달 가능성·실행 순서·데이터 흐름을 전혀 보지 않는다.**
 * 부작용으로, 보안을 보존하는 정당한 리팩터링(게이트를 헬퍼로 추출)은 빨간불이
 * 난다 — 그게 가드를 지우고 싶게 만드는 압력이 된다.
 *
 * ## 그럼 인가는 무엇이 지키는가 — **E2E다**
 *
 * `npm run test:e2e:authz`(기준선 70 passed). 같은 감사에서 **E2E는 관리자 게이트
 * 무력화를 실제로 잡았다.** 인가를 바꿨으면 그걸 돌려라. 이 파일이 초록불인 것은
 * 인가가 지켜진다는 증거가 아니다.
 *
 * ## 그래도 이 파일이 값을 하는 자리
 *
 * - **지워진 것**을 잡는다(게이트를 통째로 삭제하면 개수가 0이 되어 실패)
 * - **되살아나는 것**을 잡는다(Supabase 임포트·쓰기, 죽은 스크립트 부활)
 * - **문자열 계약**을 잡는다(허용목록, 파라미터 이름, 마이그레이션 관례)
 *
 * 새 계약을 추가할 때는 **깨뜨려 보고 실제로 실패하는지 확인해라.** 이 저장소는
 * "통과하지만 아무것도 안 지키는" 검사를 여러 번 만들었다(주석에 매치, 표본
 * 배열이 비면 공허 통과, 사본을 만들어 원본과 갈라짐).
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { globSync } from 'node:fs'
import { basename, join, relative } from 'node:path'
import ts from 'typescript'
import { stripComments } from './strip-comments.mjs'

const root = process.cwd()

/**
 * 소스 파일을 읽되 **자바스크립트/타입스크립트는 주석을 걷어내고** 돌려준다
 * (`.ts`·`.tsx`·`.js`·`.mjs`·`.cjs`).
 *
 * 이 파일의 검사는 대부분 정규식으로 소스를 훑는다. 원본을 그대로 훑으면
 * 인가 조건문을 `//`로 통째로 주석 처리해도 그 줄의 **텍스트는 그대로 남아**
 * 양의 단정이 거짓 통과한다 — 리뷰어가 `posts/[id]` 소유권 게이트 두 개를
 * 지우고 주석에 같은 문자열만 남겨 실증한 실패 모드다. 예전에는 `stripComments`가
 * 234개 읽기 지점 중 26개(약 11%)에만 붙어 있었고, 나머지 208개는 전부 그
 * 실패 모드에 노출돼 있었다.
 *
 * 그래서 읽기 자체를 안전한 기본값으로 바꾼다. 개별 검사가 "주석을 걷어낼지"
 * 를 매번 기억해야 하는 구조에서는 다음 사람이 반드시 잊는다.
 *
 * `.js`/`.mjs`/`.cjs`도 같은 기본값에 넣는다. `scripts/` 아래의 Supabase 가드는
 * 이 확장자만 훑는데, 이 저장소는 컷오버 잔재를 **긴 주석으로 설명해 두는**
 * 관례가 있어(무해화 배너가 금지 패턴을 그대로 인용한다) 원본을 훑으면 그
 * 설명글이 전부 위반으로 잡히거나, 반대로 "포팅했다"는 주석만 남기고 실제
 * 가드를 지워도 통과한다. `stripComments`는 TypeScript 파서 기반이지만 JS도
 * 그대로 파싱하고 셔뱅(`#!`)도 처리한다.
 *
 * 그 밖의 파일(.md·.json·설정 파일)은 그대로 돌려준다 — `stripComments`는
 * 그런 파일에서는 fail-closed로 던진다. 문자열·템플릿·정규식 리터럴은 보호되고
 * 길이·위치도 보존되므로, 메시지 문구를 찾는 부정 단정이나 `indexOf` 순서
 * 비교는 영향을 받지 않는다.
 */
/**
 * `readSourceAt`이 주석을 걷어낼지 결정하는 판정. **따로 뽑아 둔 이유는 그
 * 판정 자체를 단정할 수 있게 하기 위해서다.**
 *
 * 이 확장자 목록이 조용히 `.ts`/`.tsx`로 되돌아가도(원래 그랬다) 지금 저장소
 * 상태에서는 아무 검사도 안 터진다 — 실증했다. `scripts/` 아래 파일이 전부
 * Supabase를 코드로도 언급하고 있어서, 주석까지 함께 읽어도 분류가 그대로이기
 * 때문이다. 그러나 되돌아간 순간 **"Supabase를 주석으로만 언급하는 파일"이
 * 전부 위반으로 뒤집힌다.** 이 저장소는 컷오버 잔재를 긴 주석으로 설명해 두는
 * 관례가 있고(무해화 배너가 금지 모양을 그대로 인용한다), 그때 사람이 손을
 * 대는 곳은 패턴 쪽이다 — 가드를 약하게 만드는 방향으로.
 *
 * 그래서 회귀를 "언젠가 오탐이 터지면 안다"에 맡기지 않고 여기서 못박는다.
 */
function shouldStripComments(path) {
  return /\.(tsx?|[cm]?js)$/.test(String(path))
}

function readSourceAt(path) {
  const text = readFileSync(path, 'utf8')
  return shouldStripComments(path) ? stripComments(text) : text
}

/**
 * 주석을 **걷어내지 않은** 원본. 검사 대상이 코드가 아니라 **주석·문서 문구
 * 자체**일 때만 쓴다(예: rate limiter 래퍼가 "운영에서는 503으로 fail-closed"를
 * 설명하고 있는가). 그 계약은 사람이 읽는 설명이므로 주석을 지우면 검사할 게
 * 남지 않는다.
 *
 * **코드 로직을 보는 검사에는 절대 쓰지 마라** — 인가 조건문을 주석 처리해도
 * 텍스트가 남아 통과하는 실패 모드가 정확히 이 함수로 돌아온다. 아래
 * `readRawSourceAt` 호출부는 전부 문구 검사 전용이고, 이 파일 자기검사
 * (rawSourceReadSites)가 그 개수를 못박는다.
 */
function readRawSourceAt(path) {
  return readFileSync(path, 'utf8')
}

// ---------------------------------------------------------------------------
// 자기검사: 이 파일의 **모든** 소스 읽기가 주석을 걷어내는가.
//
// 예전에는 `stripComments`가 234개 읽기 지점 중 26개(약 11%)에만 붙어 있었다.
// 나머지 208개는 "인가 조건문을 주석 처리하고 텍스트만 남기면 양의 단정이
// 통과한다"는 실패 모드에 그대로 노출돼 있었고, 리뷰어가 `posts/[id]`의
// 소유권 게이트 두 개로 그걸 실증했다.
//
// 이제 읽기는 `readSourceAt`(안전한 기본값) 하나로 모았고, 주석 문구 자체가
// 계약인 검사만 `readRawSourceAt`으로 예외 처리한다. 이 자기검사가 그 구조를
// 못박는다 — 새 `readFileSync` 직접 호출이나 이름 없는 raw 읽기가 들어오면
// 여기서 막힌다. 목록이 아니라 **구조**를 고정하므로, 다음 사람이 읽기 지점을
// 늘려도 자동으로 안전한 쪽에 놓인다.
const guardSelfSource = stripComments(
  readRawSourceAt(join(root, 'scripts/testing/assert-runtime-risks.mjs'))
)
// 원본 `readFileSync` 직접 호출은 위 두 리더의 본문 안에만 있어야 한다.
const RAW_READ_FILE_CALL_SITES = 2
const rawReadFileCallSites = (guardSelfSource.match(/readFileSync\(/g) ?? []).length
// `readRawSourceAt`으로 읽는 변수는 아래 넷뿐이다.
// 앞의 셋은 rate limiter 문구 검사이고, `credentialScanSource`는 하드코딩
// 자격 증명 스캔이다 — 후자가 주석을 걷어내면 안 되는 이유는 명확하다:
// **주석 안에 박힌 키도 커밋된 키다.** 여기에 `readSourceAt`을 쓰면
// `// const key = 'eyJ...'` 형태가 통째로 사라져 가드가 조용히 통과한다.
// 자기 소스 읽기는 변수 대입이 아니라 `stripComments(...)` 인자라 여기 안 걸린다.
const ALLOWED_RAW_SOURCE_BINDINGS = [
  'rateLimiterCompatDocSource',
  'rateLimitWrapperDocSource',
  'rateLimiterDocSource',
  'credentialScanSource',
]
const rawSourceBindings = [...guardSelfSource.matchAll(/const (\w+) = readRawSourceAt\(/g)].map(
  match => match[1]
)
const unexpectedRawSourceBindings = rawSourceBindings.filter(
  name => !ALLOWED_RAW_SOURCE_BINDINGS.includes(name)
)
const missingRawSourceBindings = ALLOWED_RAW_SOURCE_BINDINGS.filter(
  name => !rawSourceBindings.includes(name)
)

/**
 * 주석에 더해 `import` 문 줄도 걷어낸 소스. "실제 코드에 이 로직이 있고, A가
 * B보다 먼저 나오는가"를 검사할 때 쓴다.
 *
 * `stripComments`만으로는 두 가지가 새 나간다.
 *
 * 1. import 문. 순서 검사(`indexOf` 비교)에서 `import { requireBoardMember }
 *    from '...'` 같은 줄이 실제 호출부보다 거의 항상 먼저 나오므로, "인증이
 *    조회보다 먼저"를 확인하려던 검사가 최상단 import 줄에 걸려 무조건
 *    참이 돼버린다.
 * 2. 주석으로 지워진 실제 로직. 인가 조건문 같은 코드를 `//`로 통째로
 *    주석 처리해도 그 줄의 텍스트는 여전히 소스에 남아 있어서, 원본
 *    소스를 그대로 정규식으로 훑는 존재 검사는 "주석 처리됐다"는 사실을
 *    구분하지 못한다. `stripComments`가 그 줄 자체를 지워야 이 문제가
 *    없어진다.
 *
 * URL 문자열의 `//`(`stripComments`가 이미 `:` 앞뒤로 보호)는 그대로 살아있고,
 * import가 아닌 일반 코드 줄은 건드리지 않는다.
 *
 * 알려진 한계: import 줄 제거는 `^\s*import\b`로 시작하는 줄 하나만 지운다.
 * 여러 줄로 접힌 import(`import {\n  a,\n  b,\n} from '...'`)는 첫 줄만
 * 지워지고 나머지 식별자 줄(`  a,`, `  b,`, `} from '...'`)은 그대로 남는다.
 * 지금 이 파일의 모든 board-document 검사는 괄호·인자까지 포함한 완전한
 * 호출 문자열(`requireBoardMember()`, `isSafeBoardDocumentFilePath(doc.file_path)`
 * 등)만 찾으므로 이 잔여물에 걸리지 않지만, 앞으로 여기 bare identifier(예:
 * 그냥 `isSafeBoardDocumentFilePath`)로 존재를 검사하는 코드를 추가하면 여러
 * 줄 import의 잔여 줄이 거짓 양성을 만들 수 있다. 그런 검사를 추가할 때는
 * 반드시 완전한 호출 형태로 매칭하거나, 이 필터를 여러 줄 import까지 지우도록
 * 먼저 고칠 것.
 */
function stripCommentsAndImports(source) {
  return stripComments(source)
    .split('\n')
    .filter(line => !/^\s*import\b/.test(line))
    .join('\n')
}

/**
 * 문자열 리터럴('...', "...", `...`)의 내용을 걷어낸 소스. "실제 호출부가
 * stripped 코드에 있는가"를 보는 양의 단정(예: `mustAlsoCall`,
 * `/requireActiveMember\(\)/.test(...)`)은 `stripCommentsAndImports`만으로는
 * 막을 수 없는 구멍이 있다 — 문자열 리터럴은 그대로 남기 때문에
 * `const decoy = "requireUser()"` 한 줄로 실제 호출을 지우고도 양의 단정을
 * 가짜로 만족시킬 수 있다(Task 5 3라운드 리뷰에서 실증됨). 이 함수는 작은
 * 따옴표·큰따옴표·백틱 세 종류의 내용을 전부 지운다.
 *
 * 정규식/문자 스캔으로 JS 문자열을 완벽히 파싱하는 건 사실상 불가능하다
 * (예: 백틱 템플릿 리터럴의 `${...}` 보간식이 다시 백틱을 포함할 수 있고,
 * 이스케이프 처리도 얽힌다). 여기서는 "가짜 호출부 문자열로 게이트를
 * 속인다" 각도만 막으면 충분하다고 보고, 백틱은 `${...}` 내부까지 통째로
 * 하나의 리터럴 구간으로 다룬다(그 안에 실제 코드가 있어도 함께 지워진다).
 * 이 저장소에서 requireUser()/requireActiveMember() 같은 호출이 템플릿
 * 보간식 안에서만 등장하는 사례는 없다(grep으로 확인).
 *
 * 문자열을 완전히 삭제하지 않고 공백으로 치환하는 이유: 문자열 앞뒤의 코드
 * 토큰이 따옴표 삭제로 인해 우연히 이어 붙어(예: `foo("") + bar` →
 * `foo + bar`가 아니라 `foobar`처럼) 새로운 거짓 매치를 만들 가능성을
 * 차단하기 위해서다.
 *
 * **길이·위치를 보존한다**(`stripComments`와 같은 성질): 리터럴 자리를 같은
 * 길이의 공백으로 채우고 줄바꿈은 남긴다. 그래서 원본과 출력의 인덱스가
 * 1:1이고, "문자열이 아닌 진짜 코드에서 이 토큰이 몇 번째 글자에 있는가"를
 * 찾아 **원본 쪽을 같은 위치에서 잘라낼 수 있다**. 특권 라우트 가드가
 * `auth:` 키의 위치를 문자열 제거판에서 찾고 값은 원본에서 읽는 데
 * 이 성질을 쓴다(최종 회차 C-3) — 예전처럼 공백 한 칸으로 뭉개면 두 판본의
 * 인덱스가 어긋나 그 방식이 성립하지 않는다.
 *
 * 주의: 이 함수가 지운 문자열 내용을 검사하는 기존 부정 단정(예:
 * verify-session의 `!/console\.error\(['"]\[VERIFY-SESSION\] Session
 * error:/`처럼 메시지 문구 자체를 찾는 검사)에는 이 함수를 적용하면 안
 * 된다 — 그 검사가 찾는 문자열 내용까지 함께 사라져서 검사가 항상
 * 통과하는 쪽으로(즉 실패를 놓치는 쪽으로) 조용히 무력화된다. 그런
 * 검사는 `stripCommentsAndImports`까지만 거친 원래 코드를 계속 써야
 * 한다.
 */
function stripStringLiterals(source) {
  let out = ''
  let i = 0
  const n = source.length
  while (i < n) {
    const ch = source[i]
    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch
      let j = i + 1
      while (j < n) {
        if (source[j] === '\\') {
          j += 2
          continue
        }
        if (source[j] === quote) {
          j += 1
          break
        }
        j += 1
      }
      // `j`는 이스케이프(`\\` 뒤 두 칸 건너뛰기) 때문에 소스 끝을 넘어설 수
      // 있다 — 길이 보존이 깨지지 않게 복사 범위를 소스 길이로 자른다.
      for (let k = i, end = Math.min(j, n); k < end; k += 1) {
        out += source[k] === '\n' || source[k] === '\r' ? source[k] : ' '
      }
      i = j
      continue
    }
    out += ch
    i += 1
  }
  return out
}

/**
 * `dir` 아래를 재귀로 걸어 `matches(basename)`인 파일의 저장소 상대경로를
 * 정렬해 돌려준다. **글롭과 독립적인 두 번째 열거 경로**다.
 *
 * 이게 왜 필요한가 — `srcAllFiles`에는 개수 하한(전체·서브트리·루트)이
 * 붙어 있는데 `appFiles`·`apiRouteFiles`에는 하나도 없었다. 두 글롭이 비면
 * edge runtime 금지·raw `getUser(` 금지·레거시 rate limiter import 금지 등
 * 7개 가드가 **조용히** 꺼진다(전부 `filter(...)` 결과가 빈 배열이면
 * 통과하는 모양이라 빈 스캔이 곧 초록불이다).
 *
 * 개수 하한을 베끼는 대신 구조 대조를 쓴다. 하한은 "충분히 줄었을 때"만
 * 잡지만, 대조는 글롭이 **한 파일이라도** 놓치는 순간 잡는다 — 그리고
 * 손으로 유지할 숫자표·미커버 서브트리 점검이 필요 없다(`srcAllFiles`의
 * 하한표는 그 자체가 fail-open 구멍을 두 번 만들었다). 대조 대상이 되는
 * 계약은 파일 이름 규칙 하나뿐이라 오탐이 생길 여지도 없다.
 *
 * `readdirSync` 재귀는 `globSync`의 패턴 매칭과 구현이 전혀 다르므로,
 * 글롭 패턴을 좁히는 흔한 사고(`src/app/api/**`로 축소, `page.tsx`만 남김,
 * `**` 하나 누락)는 전부 여기서 불일치로 드러난다. 둘 다 고쳐야만 통과하는
 * 구조는 "한 곳만 건드려 가드를 끄는" 경로를 없앤다. 스캔 자체가 통째로
 * 비는 경우(디렉터리 소멸·cwd 오류)는 대조로는 안 잡히므로 개수 하한을
 * 함께 둔다.
 */
function walkFiles(dir, matches) {
  const out = []
  const walk = current => {
    let entries
    try {
      entries = readdirSync(join(root, current), { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === '.next') continue
      const next = `${current}/${entry.name}`
      if (entry.isDirectory()) {
        walk(next)
      } else if (matches(entry.name)) {
        out.push(next)
      }
    }
  }
  walk(dir)
  return out.sort()
}

/** 두 목록의 차집합(정렬된 배열 2개를 받아 `expected`에만 있는 항목). */
function missingFrom(actual, expected) {
  const seen = new Set(actual)
  return expected.filter(file => !seen.has(file))
}

// `export const <METHOD> = defineApiRoute(<...>)` 한 블록을 괄호 균형으로 잘라낸다.
// 파일 전체가 아니라 메서드별 설정 객체 단위로 auth/rateLimitHeaders를 검증하기 위함.
// `defineStreamRoute`(SSE 라우트)도 같은 설정 객체 모양이라 함께 받는다 —
// 특권 트리 가드가 real-time/stream 라우트를 "잘라내지 못했다"로 오탐하지
// 않게 하기 위해서다.
const extractDefineApiRouteBlock = (source, method) => {
  const marker = new RegExp(`export const ${method}\\s*=\\s*define(?:Api|Stream)Route`)
  const match = marker.exec(source)
  if (!match) return null

  // 제네릭(`<Record<string, unknown>>`)은 괄호를 포함하지 않으므로 defineApiRoute
  // 뒤 첫 여는 괄호가 곧 호출 인자 시작이다. 여기서부터 괄호 균형으로 블록을 잘라낸다.
  const parenIdx = source.indexOf('(', match.index + match[0].length)
  if (parenIdx === -1) return null

  let depth = 0
  for (let i = parenIdx; i < source.length; i++) {
    const ch = source[i]
    if (ch === '(') {
      depth++
    } else if (ch === ')') {
      depth--
      if (depth === 0) {
        return source.slice(match.index, i + 1)
      }
    }
  }
  return null
}

const appFiles = globSync('src/app/**/{route,page,layout}.@(ts|tsx)', {
  cwd: root,
  exclude: ['**/node_modules/**', '**/.next/**'],
})
// 위 walkFiles 설명 참고. 숫자는 현재 개수의 대략 3분의 2다 — 대조가
// 주 방어선이고 이 하한은 "스캔이 통째로 비었다"만 잡는 보조 장치다.
const APP_FILES_MIN = 100 // 현재 148
const appFilesExpected = walkFiles('src/app', name => /^(route|page|layout)\.tsx?$/.test(name))
const appFilesMissed = missingFrom(appFiles, appFilesExpected)

const edgeRuntimeFiles = appFiles.filter(file => {
  const source = readSourceAt(join(root, file))
  return /export\s+const\s+runtime\s*=\s*['"]edge['"]/.test(source)
})

const authMiddlewarePath = join(root, 'src/middleware/auth.ts')
const authMiddlewareSource = readSourceAt(authMiddlewarePath)
const rootMiddlewarePath = join(root, 'src/middleware.ts')
const rootMiddlewareSource = readSourceAt(rootMiddlewarePath)
// 단계 4 Task 5: 미들웨어에서 Supabase 클라이언트가 완전히 사라졌다. 신원은
// Better Auth 쿠키(readMiddlewareSession/verifySessionFresh)로만 판정한다.
//
// 예전 @supabase/ssr 클라이언트는 setAll로 갱신 토큰 쿠키를 기반 응답(res)에
// 실었고, 미들웨어가 새로 만드는 응답(리다이렉트·유지보수 503)에 그것을
// 복사하지 않으면 세션 갱신이 유실됐다. 그 복사(copyResponseCookies)는 지금도
// 필요하다 — handleAuth가 res에 쿠키를 쓰고, CSP 헤더도 같은 경로로 전달되기
// 때문이다. 그래서 여기서 "복사가 살아 있다"를 고정한다.
//
// "이 파일에 Supabase 접근이 없다"는 단정은 여기 두지 않는다 — 저장소 전수
// 가드(`supabaseAccessOffenders`)가 `src/**/*.ts`를 훑으므로 이 파일도 이미
// 그 안에 들어 있다. 같은 사실을 두 곳에서 단정하면, 한쪽이 실패할 때 어느
// 쪽이 진짜 계약인지 알 수 없게 되고 파일별 사본은 계속 늘어난다.
const middlewareUsesBetterAuthSessionOnly =
  /verifySessionFresh\(request\)/.test(rootMiddlewareSource) &&
  /function copyResponseCookies/.test(rootMiddlewareSource) &&
  /from\.cookies\.getAll\(\)\.forEach\(cookie => to\.cookies\.set\(cookie\)\)/.test(
    rootMiddlewareSource
  ) &&
  /to\.headers\.set\('content-security-policy', csp\)/.test(rootMiddlewareSource) &&
  // 인증·유지보수 판정이 다시 "Supabase env가 있을 때만" 같은 조건 뒤로 숨지
  // 않게 — 그 조건이 살아 있으면 컷오버에서 Supabase 환경변수를 지우는 순간
  // 미들웨어가 통째로 무력화된다(사이트가 열린 채 잠기지 않는다).
  //
  // **이 검사는 저장소 전수 가드가 덮지 못한다.** 그 가드의 패턴 목록에
  // `NEXT_PUBLIC_SUPABASE_URL`은 없다(ANON_KEY·SERVICE_ROLE_KEY만 있다) —
  // URL 하나만 보고 조기 반환하는 게이트가 부활하면 전수 가드는 침묵한다.
  // 전수 패턴에 그 이름을 추가하지도 않는다: `src/utils/site.ts`·`safeUrl.ts`·
  // `src/lib/storage/paths.ts`가 아티스트 이미지 URL 검증에 정당하게 쓰고
  // 있어 전부 오탐이 된다.
  //
  // **이름이 아니라 모양을 본다.** 예전에는 `hasSupabaseMiddlewareConfig`라는
  // 식별자 하나만 금지했는데, 같은 게이트를 이름 없이
  // `if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return NextResponse.next()`로
  // 인라인해도 통과했다(리뷰어 실증). 이 파일에서는 `NEXT_PUBLIC_SUPABASE_`로
  // 시작하는 env 참조 자체가 정당한 쓰임이 없으므로 접두어 단위로 막는다.
  !/process\.env\.NEXT_PUBLIC_SUPABASE_/.test(rootMiddlewareSource) &&
  !/hasSupabaseMiddlewareConfig/.test(rootMiddlewareSource)
// 미들웨어 인증(handleAuth)은 단계 2b-6부터 Better Auth의 쿠키 캐시로 신원을
// 판정한다(`readMiddlewareSession`, src/middleware/session.ts) — 캐시가 있으면
// DB 왕복 없이 판정하고, 캐시가 만료됐을 때만 서버에 왕복한다. 트레이드오프는
// 옛 로컬 검증과 동일하다: auth 레벨 세션 취소(전역 로그아웃·비번 변경·밴)는
// 캐시 만료(5분)까지 못 본다 — 데이터·변형 표면은 하류 getSession()이, 유지보수
// 관리자 예외는 middleware.ts의 재검증(verifySessionFresh)이 봉쇄한다.
//
// 예전에는 여기에 "Supabase의 getClaims()/getUser()를 부르지 않는다"는 음성
// 단정이 붙어 있었다. 그 모양은 이제 저장소 전수
// 가드(`supabaseAuthSessionCallOffenders`)가 `src/` 전체에서 문다 — 이 파일도
// 그 스캔 안에 있으므로 사본을 남기지 않는다.
const middlewareVerifiesJwtLocally = /readMiddlewareSession/.test(authMiddlewareSource)
const authCallbackPath = join(root, 'src/app/auth/callback/route.ts')
const authCallbackSource = readSourceAt(authCallbackPath)
const authVerifySessionPath = join(root, 'src/app/api/auth/verify-session/route.ts')
const authVerifySessionSource = readSourceAt(authVerifySessionPath)
// 주석/옛 식별자 잔재로 인한 거짓 긍정을 막기 위해, "실제 코드에 이 로직이 있는가"를
// 보는 부정/존재 검사는 이 stripped 버전을 쓴다(assert-runtime-risks 반복 회귀 이력).
// 이 변수는 문자열 리터럴 내용까지 검사하는 부정 단정(console.error 메시지 문구)이
// 의존하므로 stripStringLiterals는 적용하지 않는다 — 아래 authVerifySessionCallSites가
// 그 역할(양의 단정 전용, 문자열 리터럴 디코이 면역)을 대신한다.
const authVerifySessionCode = stripCommentsAndImports(authVerifySessionSource)
// requireUser()/instanceof NextResponse 같은 "호출부가 실제로 있는가" 양의 단정
// 전용. 문자열 리터럴도 걷어내 `const decoy = "requireUser()"` 같은 가짜
// 호출부로 게이트를 속이지 못하게 한다.
const authVerifySessionCallSites = stripStringLiterals(authVerifySessionCode)
const securityPath = join(root, 'src/utils/security.ts')
const securitySource = readSourceAt(securityPath)
const signupPagePath = join(root, 'src/app/[locale]/signup/page.tsx')
const signupPageSource = readSourceAt(signupPagePath)
const signupProfilePath = join(root, 'src/lib/auth/signupProfile.ts')
const signupProfileSource = readSourceAt(signupProfilePath)
const resetPasswordPagePath = join(root, 'src/app/[locale]/reset-password/page.tsx')
const resetPasswordPageSource = readSourceAt(resetPasswordPagePath)
// src/app/api/auth/reset-password/route.ts(구 Supabase 기반 라우트)는 단계
// 2b-6에서 삭제됐다 — Better Auth catch-all(`[...all]/route.ts`)이 같은 경로를
// 대신 받는다. 더 이상 별도로 읽지 않는다.
const loginPagePath = join(root, 'src/app/[locale]/login/page.tsx')
const loginPageSource = readSourceAt(loginPagePath)
const authRegisterPendingPagePath = join(root, 'src/app/[locale]/register/pending/page.tsx')
const authRegisterPendingPageSource = readSourceAt(authRegisterPendingPagePath)
const authMypageArtistPagePath = join(root, 'src/app/[locale]/mypage/artist/page.tsx')
const authMypageArtistPageSource = readSourceAt(authMypageArtistPagePath)
const postsApiPath = join(root, 'src/app/api/posts/route.ts')
const postsApiSource = readSourceAt(postsApiPath)
// requireActiveMember() 존재만 보는 양의 단정 전용이라(문자열 내용을 검사하는
// 부정 단정 없음) 문자열 리터럴까지 걷어내 디코이 문자열 면역을 확보한다.
const postsApiCode = stripStringLiterals(stripCommentsAndImports(postsApiSource))
const postDetailApiPath = join(root, 'src/app/api/posts/[id]/route.ts')
const postDetailApiSource = readSourceAt(postDetailApiPath)
const usePostCreationPath = join(root, 'src/hooks/usePostCreation.ts')
const usePostCreationSource = readSourceAt(usePostCreationPath)
const writePageClientPath = join(root, 'src/app/[locale]/board/write/WritePageClient.tsx')
const writePageClientSource = readSourceAt(writePageClientPath)
const editPageClientPath = join(root, 'src/app/[locale]/board/[id]/edit/EditPageClient.tsx')
const editPageClientSource = readSourceAt(editPageClientPath)
const mypageProfilePagePath = join(root, 'src/app/[locale]/mypage/profile/page.tsx')
const mypageProfilePageSource = readSourceAt(mypageProfilePagePath)
const mypageProfileApiPath = join(root, 'src/app/api/mypage/profile/route.ts')
const mypageProfileApiSource = existsSync(mypageProfileApiPath)
  ? readSourceAt(mypageProfileApiPath)
  : ''
// requireActiveMember() 존재만 보는 양의 단정 전용이라(문자열 내용을 검사하는
// 부정 단정 없음) 문자열 리터럴까지 걷어내 디코이 문자열 면역을 확보한다.
const mypageProfileApiCode = stripStringLiterals(stripCommentsAndImports(mypageProfileApiSource))
const useCommentLikesPath = join(root, 'src/hooks/useCommentLikes.ts')
const useCommentLikesSource = readSourceAt(useCommentLikesPath)
const usePostLikesPath = join(root, 'src/hooks/usePostLikes.ts')
const usePostLikesSource = readSourceAt(usePostLikesPath)
const activityLoggerEarlyPath = join(root, 'src/utils/activityLogger.ts')
const activityLoggerEarlySource = readSourceAt(activityLoggerEarlyPath)
const mypagePermissionCheckPath = join(
  root,
  'src/app/[locale]/mypage/components/PermissionCheck.tsx'
)
const mypagePermissionCheckSource = readSourceAt(mypagePermissionCheckPath)
const mypageNavigationPath = join(root, 'src/app/[locale]/mypage/components/MypageNavigation.tsx')
const mypageNavigationSource = readSourceAt(mypageNavigationPath)
const boardUserSectionPath = join(root, 'src/components/board/BoardUserSection.tsx')
const boardUserSectionSource = readSourceAt(boardUserSectionPath)
const navigationPath = join(root, 'src/components/Navigation.tsx')
const navigationSource = readSourceAt(navigationPath)
const boardRoomClientPagePaths = [
  'src/app/[locale]/board-room/page.tsx',
  'src/app/[locale]/board-room/documents/page.tsx',
  'src/app/[locale]/board-room/schedule/page.tsx',
  'src/app/[locale]/board-room/assembly/page.tsx',
  'src/app/[locale]/board-room/meetings/page.tsx',
  'src/app/[locale]/board-room/meetings/new/page.tsx',
  'src/app/[locale]/board-room/meetings/[id]/page.tsx',
  'src/app/[locale]/board-room/meetings/[id]/edit/page.tsx',
]
const boardRoomClientPageSources = boardRoomClientPagePaths.map(routePath => ({
  path: join(root, routePath),
  source: readSourceAt(join(root, routePath)),
}))
const middlewarePreservesProtectedLoginRedirects =
  /stripLocalePrefix/.test(authMiddlewareSource) &&
  /getLocaleRedirectPath/.test(authMiddlewareSource) &&
  /redirectToPath/.test(authMiddlewareSource) &&
  /const\s+authPathname\s*=\s*stripLocalePrefix\(pathname\)/.test(authMiddlewareSource) &&
  /redirectToLogin/.test(authMiddlewareSource) &&
  /new URL\(getLocaleRedirectPath\(request,\s*['"]\/login['"]\),\s*request\.nextUrl\.origin\)/.test(
    authMiddlewareSource
  ) &&
  /url\.searchParams\.set\(['"]redirect['"],\s*requestedPath\)/.test(authMiddlewareSource) &&
  !/NextResponse\.redirect\(new URL\(['"]\/login['"],\s*request\.nextUrl\.origin\)\)/.test(
    authMiddlewareSource
  )
const middlewareProtectsOnlyValidBoardEditIds =
  /UUID_PATH_SEGMENT_REGEX/.test(authMiddlewareSource) &&
  /BOARD_EDIT_PATH_REGEX/.test(authMiddlewareSource) &&
  /const boardEditMatch = authPathname\.match\(BOARD_EDIT_PATH_REGEX\)/.test(
    authMiddlewareSource
  ) &&
  /const isBoardEdit = Boolean\(boardEditMatch && UUID_PATH_SEGMENT_REGEX\.test\(boardEditMatch\[1\]\)\)/.test(
    authMiddlewareSource
  ) &&
  !/const isBoardEdit = \/\\\/board\\\/\.\+\\\/edit\$\/\.test\(authPathname\)/.test(
    authMiddlewareSource
  )
const registrationPageBlockSource =
  authMiddlewareSource.match(/if \(isRegistrationPage\) \{[\s\S]*?\n\s{2}\}/)?.[0] ?? ''
const middlewareRedirectsApprovedRegistrationPagesToBoard =
  /userStatus === ['"]approved['"][\s\S]*?isActive[\s\S]*?redirectToPath\(request,\s*['"]\/board['"]\)/.test(
    registrationPageBlockSource
  ) &&
  !/const\s+expectedPath\s*=\s*`\/register\/\$\{userStatus\}`/.test(registrationPageBlockSource) &&
  !/NextResponse\.redirect\(new URL\(['"]\/(?:board|register\/pending|register\/rejected)['"],\s*request\.nextUrl\.origin\)\)/.test(
    authMiddlewareSource
  )
// 단계 2b-5/2b-6(Task 3가 실제로 옮김, Task 4가 게이트를 맞춤): `member_profiles`
// 생성이 `src/app/auth/callback/route.ts`(옛 Supabase OAuth 콜백)에서 Better
// Auth `databaseHooks.user.create.after`(가입 훅) + `/api/member-signup`(자체
// 가입 라우트)로 옮겨갔다. monthly_fee의 NaN 방지 로직도 함께
// `src/lib/auth/signupProfile.ts`의 `integer()` 헬퍼로 옮겨갔다 — 콜백
// 라우트는 이제 monthly_fee를 전혀 다루지 않는다.
const authCallbackParsesMonthlyFeeSafely =
  !/monthly_fee/.test(authCallbackSource) &&
  /function integer\(value: unknown\): number \| null \{/.test(signupProfileSource) &&
  /Number\.isInteger\(n\) \? n : null/.test(signupProfileSource) &&
  /monthly_fee:\s*integer\(input\.monthly_fee\)/.test(signupProfileSource)
// 단계 2b-6(Task 2가 실제로 변경, Task 4가 게이트를 맞춤): signup/forgot-password
// 화면은 더 이상 Supabase `emailRedirectTo`/`resetPasswordForEmail`을 호출하지
// 않는다 — Better Auth가 서버에서 이메일을 직접 보낸다(`sendAuthEmailLogged`,
// `src/lib/auth/server.ts`). 그 서버측 이메일 링크(`resolveEmailLinkBaseUrl()`
// 기반)는 로케일 파라미터를 붙이지 않으므로, 이메일 인증/재설정 링크를 밟은
// 사용자는 항상 기본 로케일(ko)로 착지한다 — Task 2가 의식적으로 받아들인
// 트레이드오프(task-2-report.md "emailRedirectTo/locale 조립을 지웠다" 참고)이지
// Task 4의 범위가 아니다. 여기서는 콜백 라우트 자신이 여전히 안전하게
// 동작하는지만 고정한다: 신뢰할 수 없는 `locale`/`next` 쿼리 파라미터를 받아도
// 허용 목록 밖 값은 안전한 기본값(ko, 로그인 페이지)으로 떨어진다(오픈 리다이렉트
// 방지).
const authCallbackSafelyDefaultsUntrustedLocaleAndNext =
  /resolveSafeLocale/.test(authCallbackSource) &&
  /SUPPORTED_LOCALES\.some\(locale => locale === value\) \? \(value as SupportedLocale\) : 'ko'/.test(
    authCallbackSource
  ) &&
  /localizePath/.test(authCallbackSource) &&
  /resolveSafeNext/.test(authCallbackSource) &&
  /ALLOWED_NEXT_PATHS:\s*readonly\s*string\[\]\s*=\s*\[['"]\/reset-password['"]\]/.test(
    authCallbackSource
  ) &&
  /ALLOWED_NEXT_PATHS\.includes\(pathOnly\) \? pathOnly : null/.test(authCallbackSource) &&
  /redirectToPath\(requestUrl,\s*safeNext,\s*locale\)/.test(authCallbackSource) &&
  /redirectToPath\(requestUrl,\s*['"]\/register\/pending['"],\s*locale\)/.test(
    authCallbackSource
  ) &&
  /redirectToPath\(requestUrl,\s*['"]\/board['"],\s*locale\)/.test(authCallbackSource) &&
  !/NextResponse\.redirect\(`\$\{requestUrl\.origin\}\/(?:login|register\/pending|register\/rejected|board|reset-password)`\)/.test(
    authCallbackSource
  )
const postCreationUsesServerApi =
  /fetch\(['"]\/api\/posts['"]/.test(usePostCreationSource) &&
  !/from\(['"]posts['"]\)[\s\S]*?\.insert/.test(usePostCreationSource)
const boardPostCreationAvoidsRefreshQuery =
  /router\.push\(['"]\/board['"]\)/.test(writePageClientSource) &&
  /router\.refresh\(\)/.test(writePageClientSource) &&
  !/refresh=\$\{Date\.now\(\)\}/.test(writePageClientSource) &&
  !/\/board\?refresh=/.test(writePageClientSource)
const postsApiCreatesPostsWithServerAuthAndInvalidatesBoard =
  /export async function POST/.test(postsApiSource) &&
  /parseJsonObjectBody/.test(postsApiSource) &&
  /parseBoardCategory/.test(postsApiSource) &&
  // 로그인 + 승인된 활성 멤버 검사는 requireActiveMember()로 수렴됐다(Task 3/5).
  // registration_status/is_active 리터럴은 이제 이 파일이 아니라
  // memberAuth.ts 안에 있으므로, 그 리터럴 대신 호출부 자체를 검사한다.
  /requireActiveMember\(\)/.test(postsApiCode) &&
  /author_id:\s*user\.id/.test(postsApiSource) &&
  // 게시판 목록 무효화는 `revalidatePath('/board')` 직접 호출에서
  // getBoardListRevalidationPaths() 순회로 바뀌었다. next-intl이 ko를 내부적으로
  // `/ko/board`로 rewrite하기 때문에 접두사 없는 `/board` 한 번으로는 ko 페이지가
  // 무효화되지 않았다(@/lib/revalidationPaths 주석 참고). 옛 형태로 되돌아가면
  // 그 버그가 재발하므로, 헬퍼 경유를 강제하고 직접 호출은 금지한다.
  /getBoardListRevalidationPaths\(\)/.test(postsApiSource) &&
  /revalidatePath\(boardPath\)/.test(postsApiSource) &&
  !/revalidatePath\(['"]\/board['"]\)/.test(postsApiSource) &&
  // 태그 무효화는 더 이상 요구하지 않는다. 이 저장소에는 `board-*` 태그를
  // 부착하는 곳이 없어 그 호출이 아무 일도 하지 않았다(2026-09-04 코드리뷰).
  // 가드가 죽은 문자열의 존재를 통과 조건으로 삼고 있어, 지우려면 여기가
  // 먼저 막았다. 실제로 지켜야 할 것은 위의 경로 무효화다.
  !/revalidateTag\(/.test(postsApiSource)
const postEditUsesServerApi =
  /fetch\(`\/api\/posts\/\$\{post\.id\}`/.test(editPageClientSource) &&
  /method:\s*['"]PATCH['"]/.test(editPageClientSource) &&
  !/from\(['"]posts['"]\)[\s\S]*?\.update/.test(editPageClientSource)
const postsApiUpdatesPostsWithServerAuthAndInvalidatesBoard =
  /export async function PATCH/.test(postDetailApiSource) &&
  /parseJsonObjectBody/.test(postDetailApiSource) &&
  /parseBoardCategory/.test(postDetailApiSource) &&
  /registration_status/.test(postDetailApiSource) &&
  /is_active/.test(postDetailApiSource) &&
  /post\.author_id !== user\.id && !isAdmin/.test(postDetailApiSource) &&
  // 같은 이유로 태그가 아니라 경로 무효화를 요구한다.
  /getBoardPostRevalidationPaths\(validPostId\)/.test(postDetailApiSource) &&
  /revalidatePath\(boardPath\)/.test(postDetailApiSource) &&
  !/revalidateTag\(/.test(postDetailApiSource)
const profilePageUsesServerApi =
  /fetch\(['"]\/api\/mypage\/profile['"]/.test(mypageProfilePageSource) &&
  !/from\(['"]member_profiles['"]\)[\s\S]*?\.update/.test(mypageProfilePageSource)
const profileApiRestrictsSelfUpdates =
  /export async function GET/.test(mypageProfileApiSource) &&
  /export async function PATCH/.test(mypageProfileApiSource) &&
  /parseJsonObjectBody/.test(mypageProfileApiSource) &&
  // 로그인 + 승인된 활성 멤버 검사는 requireActiveMember()로 수렴됐다(Task 3/5).
  // registration_status/is_active 리터럴은 이제 이 파일이 아니라 memberAuth.ts
  // 안에 있으므로, 그 리터럴 대신 호출부 자체를 검사한다.
  /requireActiveMember\(\)/.test(mypageProfileApiCode) &&
  // 단계 2c: member_profiles 조회/갱신을 Supabase `.eq('id', user.id)`에서
  // Turso 쿼리 계층 getProfileById(user.id)/updateProfile(user.id, ...)로
  // 옮겼다 — 둘 다 여전히 user.id로만 스코프된다.
  /getProfileById\(user\.id\)/.test(mypageProfileApiSource) &&
  /updateProfile\(user\.id,/.test(mypageProfileApiSource) &&
  /const updateData/.test(mypageProfileApiSource) &&
  !/is_admin/.test(mypageProfileApiSource) &&
  !/registration_status:\s*body/.test(mypageProfileApiSource) &&
  !/is_active:\s*body/.test(mypageProfileApiSource)
const commentLikesAvoidBearerTokenForwarding =
  /fetch\(`\/api\/comments\/\$\{commentId\}\/like`/.test(useCommentLikesSource) &&
  !/access_token/.test(useCommentLikesSource) &&
  !/Authorization:\s*`Bearer/.test(useCommentLikesSource)
const likeHooksUseServerSessionTruth =
  /fetchSessionProfile/.test(useCommentLikesSource) &&
  /fetchSessionProfile/.test(usePostLikesSource) &&
  !/getSession\(\)/.test(useCommentLikesSource) &&
  !/getSession\(\)/.test(usePostLikesSource) &&
  !/onAuthStateChange/.test(useCommentLikesSource) &&
  !/onAuthStateChange/.test(usePostLikesSource)
const activityLoggerAvoidsBearerTokenForwarding =
  /fetchSessionProfile/.test(activityLoggerEarlySource) &&
  /ensureSession/.test(activityLoggerEarlySource) &&
  /credentials:\s*['"]include['"]/.test(activityLoggerEarlySource) &&
  !/onAuthStateChange/.test(activityLoggerEarlySource) &&
  !/getSession\(\)/.test(activityLoggerEarlySource) &&
  !/session\.access_token/.test(activityLoggerEarlySource) &&
  !/Authorization:\s*`Bearer/.test(activityLoggerEarlySource) &&
  !/sessionToken:\s*string\s*\|\s*null/.test(activityLoggerEarlySource)
const mypagePermissionUsesServerSessionTruth =
  // 공용 fetchSessionProfile(내부적으로 verify-session 호출·모듈 캐시 공유) 또는 직접 fetch 둘 다 인정
  (/fetchSessionProfile/.test(mypagePermissionCheckSource) ||
    /fetch\(['"]\/api\/auth\/verify-session['"]/.test(mypagePermissionCheckSource)) &&
  (/fetchSessionProfile/.test(mypageNavigationSource) ||
    /fetch\(['"]\/api\/auth\/verify-session['"]/.test(mypageNavigationSource)) &&
  /is_admin/.test(authVerifySessionSource) &&
  /is_artist/.test(authVerifySessionSource) &&
  /artist_id/.test(authVerifySessionSource) &&
  !/from\(['"]member_profiles['"]\)/.test(mypagePermissionCheckSource) &&
  !/from\(['"]member_profiles['"]\)/.test(mypageNavigationSource)
const boardUserSectionUsesServerSessionTruth =
  (/fetchSessionProfile/.test(boardUserSectionSource) ||
    /fetch\(['"]\/api\/auth\/verify-session['"]/.test(boardUserSectionSource)) &&
  !/from\(['"]member_profiles['"]\)/.test(boardUserSectionSource) &&
  !/getSession\(\)/.test(boardUserSectionSource) &&
  !/onAuthStateChange/.test(boardUserSectionSource)
const navigationUsesServerSessionTruth =
  /fetchSessionProfile/.test(navigationSource) &&
  /is_director/.test(authVerifySessionSource) &&
  /is_auditor/.test(authVerifySessionSource) &&
  !/from\(['"]member_profiles['"]\)/.test(navigationSource) &&
  !/getSession\(\)/.test(navigationSource) &&
  !/onAuthStateChange/.test(navigationSource)
// 미인증 세션 판정은 requireUser() → getSessionContext()로 이관됐다(Task 3).
// getSessionContext()는 세션이 없어도 에러를 로깅하지 않고 401만 돌려주므로,
// 예전처럼 라우트 안에서 직접 AuthSessionMissingError를 판별하며
// console.error를 남기는 방식으로 되돌아가지 않았는지를 본다.
const verifySessionTreatsMissingSessionAsNormal =
  // 호출부 존재는 문자열 리터럴까지 걷어낸 authVerifySessionCallSites로 본다
  // (디코이 문자열 면역). 아래 console.error 부정 단정은 메시지 문구 자체를
  // 찾아야 하므로 문자열이 남아 있는 authVerifySessionCode를 그대로 쓴다.
  /requireUser\(\)/.test(authVerifySessionCallSites) &&
  /auth instanceof NextResponse/.test(authVerifySessionCallSites) &&
  !/console\.error\(['"]\[VERIFY-SESSION\] Session error:/.test(authVerifySessionCode)
const authClientPagesUseServerSessionTruth =
  /fetchSessionProfile/.test(loginPageSource) &&
  /fetchSessionProfile/.test(authRegisterPendingPageSource) &&
  /fetch\(['"]\/api\/mypage\/artist['"]/.test(authMypageArtistPageSource) &&
  /email_confirmed_at/.test(authVerifySessionSource) &&
  !/from\(['"]member_profiles['"]\)/.test(loginPageSource) &&
  !/from\(['"]member_profiles['"]\)/.test(authRegisterPendingPageSource) &&
  !/getSession\(\)/.test(loginPageSource) &&
  !/getSession\(\)/.test(authRegisterPendingPageSource) &&
  !/getSession\(\)/.test(authMypageArtistPageSource)
const loginPageCleansAuthRedirectTimers =
  /useRef<ReturnType<typeof setTimeout> \| null>\(null\)/.test(loginPageSource) &&
  /const clearAuthRedirectTimer/.test(loginPageSource) &&
  /clearTimeout\(authRedirectTimerRef\.current\)/.test(loginPageSource) &&
  /authRedirectTimerRef\.current = null/.test(loginPageSource) &&
  /useEffect\(\(\) => \{\s*return clearAuthRedirectTimer\s*\}, \[\]\)/.test(loginPageSource) &&
  /let mounted = true[\s\S]*?if \(mounted && session\.user\)/.test(loginPageSource) &&
  /return \(\) => \{\s*mounted = false\s*\}/.test(loginPageSource) &&
  /authRedirectTimerRef\.current = setTimeout\(\(\) => \{\s*navigateWithRetry\(explicitRedirectPath/.test(
    loginPageSource
  ) &&
  /authRedirectTimerRef\.current = setTimeout\(\(\) => \{\s*router\.push\(['"]\/['"]\)/.test(
    loginPageSource
  ) &&
  !/^\s*setTimeout\(\(\) => \{\s*(?:navigateWithRetry\(explicitRedirectPath|router\.push\(['"]\/['"]\))/m.test(
    loginPageSource
  )
const registerPendingGuardsSessionFetchUnmount =
  /useRef\(true\)/.test(authRegisterPendingPageSource) &&
  /const mountedRef/.test(authRegisterPendingPageSource) &&
  /mountedRef\.current = false/.test(authRegisterPendingPageSource) &&
  /if \(mountedRef\.current && session\.user\)/.test(authRegisterPendingPageSource) &&
  /if \(!mountedRef\.current\) \{\s*return\s*\}/.test(authRegisterPendingPageSource) &&
  /if \(mountedRef\.current\) \{\s*setCheckingStatus\(false\)\s*\}/.test(
    authRegisterPendingPageSource
  )
// 단계 2b-6(Task 2 커밋이 실제 변경, Task 4가 게이트를 맞춤): 재설정은 더 이상
// 쿠키 세션(`fetchSessionProfile`)이나 자체 API 라우트
// (`src/app/api/auth/reset-password/route.ts`, 삭제됨)로 본인을 확인하지 않는다.
// Better Auth 재설정 링크(`${base}/reset-password?token=...`, `server.ts`의
// `sendResetPassword`)의 `token` 쿼리 파라미터로 본인을 확인하고,
// `authClient.resetPassword({ newPassword, token })`(catch-all
// 라우트 경유)로 서버에 반영한다.
const resetPasswordUsesServerSessionTruth =
  /useSearchParams\(\)/.test(resetPasswordPageSource) &&
  /searchParams\.get\(['"]token['"]\)/.test(resetPasswordPageSource) &&
  /authClient\.resetPassword\(\{\s*newPassword:\s*password,\s*token\s*\}\)/.test(
    resetPasswordPageSource
  ) &&
  !/fetchSessionProfile/.test(resetPasswordPageSource) &&
  !/getSession\(\)/.test(resetPasswordPageSource)
const boardRoomClientPagesUseServerSessionTruth = boardRoomClientPageSources.every(
  ({ source }) =>
    (/fetchSessionProfile/.test(source) ||
      /fetch\(['"]\/api\/auth\/verify-session['"]/.test(source)) &&
    !/from\(['"]member_profiles['"]\)/.test(source) &&
    !/getSession\(\)/.test(source)
)

const serverEnvPath = join(root, 'src/lib/server/env.ts')
const serverEnvSource = existsSync(serverEnvPath) ? readSourceAt(serverEnvPath) : ''
const authzPath = join(root, 'src/lib/server/authz.ts')
const authzSource = existsSync(authzPath) ? readSourceAt(authzPath) : ''
const adminAuthPathForBoundary = join(root, 'src/lib/server/adminAuth.ts')
const adminAuthBoundarySource = readSourceAt(adminAuthPathForBoundary)
const boardRoomAuthPathForBoundary = join(root, 'src/lib/server/boardRoomAuth.ts')
const boardRoomAuthBoundarySource = readSourceAt(boardRoomAuthPathForBoundary)
const hasSharedOperationalBoundaryHelpers =
  /export type EnvGroupStatus/.test(serverEnvSource) &&
  /export function resolveFirstCompleteEnvGroup/.test(serverEnvSource) &&
  /export function requireServerEnv/.test(serverEnvSource) &&
  /export function getRedisRateLimitEnv/.test(serverEnvSource) &&
  /export function isApprovedActive/.test(authzSource) &&
  /export function isApprovedActiveAdmin/.test(authzSource) &&
  /export function canAccessBoardRoom/.test(authzSource) &&
  /export async function getSessionContext/.test(authzSource)
// 단계 4 Task 5: 두 헬퍼는 더 이상 service-role Supabase 클라이언트를 만들지도,
// 호출부에 넘기지도 않는다(반환값에서 `db`가 사라졌다). 남은 계약은 "판정은
// 공유 authz 헬퍼로, 프로필은 Turso 쿼리 계층으로"다.
//
// 반환 타입에 `db`가 되살아나면 실패시킨다 — 그게 곧 service-role 클라이언트를
// 라우트로 다시 흘려보내는 회귀의 첫 단계였다.
const existingAuthHelpersUseSharedOperationalBoundaries =
  /from\s+['"]@\/lib\/server\/authz['"]/.test(adminAuthBoundarySource) &&
  /from\s+['"]@\/db\/queries\/profiles['"]/.test(adminAuthBoundarySource) &&
  /isApprovedActiveAdmin/.test(adminAuthBoundarySource) &&
  /getSessionContext/.test(adminAuthBoundarySource) &&
  /getProfileById/.test(adminAuthBoundarySource) &&
  /export type AdminAuthSuccess = \{\s*\n\s*user:/.test(adminAuthBoundarySource) &&
  !/createClient\(/.test(adminAuthBoundarySource) &&
  /from\s+['"]@\/lib\/server\/authz['"]/.test(boardRoomAuthBoundarySource) &&
  /from\s+['"]@\/db\/queries\/profiles['"]/.test(boardRoomAuthBoundarySource) &&
  /canAccessBoardRoom/.test(boardRoomAuthBoundarySource) &&
  /isApprovedActiveAdmin/.test(boardRoomAuthBoundarySource) &&
  /getSessionContext/.test(boardRoomAuthBoundarySource) &&
  /listProfiles/.test(boardRoomAuthBoundarySource) &&
  /export type BoardAuthSuccess = \{\s*\n\s*user:/.test(boardRoomAuthBoundarySource) &&
  !/createClient\(/.test(boardRoomAuthBoundarySource)

// ---------------------------------------------------------------------------
// 인가 판정 **본문**을 못박는다 — 호출부만 보면 헬퍼를 느슨하게 고쳤을 때
// 아무도 모른다.
//
// 이 이전의 핵심 전제는 "Postgres RLS가 사라졌으니 이제 앱 코드가 유일한
// 경계"다. 그런데 그 경계를 지켜야 할 가드는 지금까지 **호출부만** 못박고
// 헬퍼 본문은 아무도 안 봤다. 리뷰어 실증:
//
// - `checkAdminPermission`의 `isApprovedActiveAdmin` 검사를 지우면
//   `auth: 'admin'`·`createSettingsAdminAuth()` 라우트 전부가 아무 로그인
//   사용자에게 열리는데 가드는 초록불이었다.
// - `requireActiveMember`를 `requireUser`로 퇴화시키면 매니페스트의 27개
//   파일 전부가 미승인·정지 계정을 받는데 역시 초록불이었다.
//
// 그래서 판정 함수 **본문의 분기 모양**(조건 + 그 조건이 실제로 막는 응답)을
// 고정한다. 조건식이 존재하는지가 아니라 **그 조건으로 분기하는지**를 본다 —
// 식만 남기고 `return`을 지우는 것도 잡힌다.
//
// 검사는 전부 주석을 걷어낸 판본(readSourceAt)에서 돌아간다. 주석에 같은
// 문자열만 남기는 방식은 통하지 않는다.

/**
 * `code`에서 이름이 `name`인 함수 선언의 본문(중괄호 블록)을 잘라낸다.
 * `export function` / `export async function` / `function` 세 형태를 받는다.
 * 시그니처 괄호 안에 중괄호가 들어갈 수 있어(구조 분해 인자·객체 타입)
 * 괄호 균형을 먼저 맞춘 뒤 여는 중괄호를 찾는다.
 *
 * 닫는 괄호 **뒤**의 반환 타입 주석에도 중괄호가 들어갈 수 있다
 * (`): Promise<{ profile: ProfileLike | null }> {`). 예전 구현은 거기서 첫
 * `{`를 만나 **타입 객체를 본문으로 잘라냈다** — `resolveSessionProfile`이
 * 정확히 그 모양이라, 이 함수를 계약에 넣자마자 본문 대신 타입이 검사돼
 * 전부 "분기가 없습니다"로 나왔다(가드가 조용히 통과하는 쪽이 아니라
 * 실패하는 쪽이라 드러났지만, 그 반대 모양이었으면 못 봤을 것이다).
 * 그래서 꺾쇠 깊이를 함께 세어 **제네릭 인자 안의 중괄호는 건너뛴다**.
 * `=>`의 `>`는 꺾쇠 닫힘이 아니므로 제외한다.
 *
 * **알려진 미대응 모양 — 계약을 추가할 때의 함정이다.** 꺾쇠 세기는 제네릭에
 * *싸인* 객체 타입만 건너뛴다. 그래서 반환 타입이 **맨몸 인라인 객체**인 모양
 * (`): { is_admin: boolean } {`)은 여전히 그 타입 객체를 본문으로 잘라낸다
 * (실측: 위 시그니처에서 반환값이 `"{ is_admin: boolean }"`이었다).
 *
 * 그 모양에서 무슨 일이 생기냐면 — **양성 요구는 큰소리로 실패하지만**(본문
 * 대신 타입을 검사하니 아무것도 못 찾는다) **`absent` 요구는 공허하게
 * 참이 된다**: 부정 패턴을 타입 주석에 대고 검사하는 셈이라, 진짜 본문에
 * 무엇이 들어 있든 통과한다. 즉 **조용히 통과하는 쪽**으로 고장 난다.
 *
 * 지금은 결함이 아니다. **현재 12개 계약 중 이 모양은 없고**(전부 `boolean`·
 * `ProfileLike`·`NextResponse | null` 같은 단순 타입이거나 `Promise<…>`),
 * `async` 함수는 반환 타입이 항상 `Promise<…>`라 구조적으로 이 모양이 될 수
 * 없다. 계약을 **추가할 때** 대상 함수가 이 모양이면 먼저 이 함수를 고쳐라 —
 * `absent` 요구가 소리 없이 무력화된다.
 */
function extractNamedFunctionBody(code, name) {
  const marker = new RegExp(`(?:export\\s+)?(?:async\\s+)?function\\s+${name}\\s*\\(`)
  const match = marker.exec(code)
  if (!match) return null

  let i = code.indexOf('(', match.index)
  let depth = 0
  for (; i < code.length; i += 1) {
    if (code[i] === '(') depth += 1
    else if (code[i] === ')') {
      depth -= 1
      if (depth === 0) break
    }
  }
  let angle = 0
  let braceStart = -1
  for (let k = i; k < code.length; k += 1) {
    const ch = code[k]
    if (ch === '<') angle += 1
    else if (ch === '>' && code[k - 1] !== '=') angle = Math.max(0, angle - 1)
    else if (ch === '{' && angle === 0) {
      braceStart = k
      break
    }
  }
  if (braceStart === -1) return null

  depth = 0
  for (let j = braceStart; j < code.length; j += 1) {
    if (code[j] === '{') depth += 1
    else if (code[j] === '}') {
      depth -= 1
      if (depth === 0) return code.slice(braceStart, j + 1)
    }
  }
  return null
}

const memberAuthPath = join(root, 'src/lib/server/memberAuth.ts')
const memberAuthSource = readSourceAt(memberAuthPath)

/**
 * 각 항목: 판정 함수 하나와, 그 본문이 반드시 담아야 하는 분기들.
 * `what`은 실패 메시지에 그대로 실린다 — "무엇이 사라졌는가"가 바로 보이도록.
 */
const AUTHORIZATION_HELPER_CONTRACTS = [
  {
    file: 'src/lib/server/authz.ts',
    source: authzSource,
    name: 'isApprovedActive',
    requirements: [
      {
        what: '승인 상태와 활성 여부를 함께 본다',
        pattern:
          /return profile\?\.registration_status === ['"]approved['"] && profile\.is_active === true/,
      },
    ],
  },
  {
    file: 'src/lib/server/authz.ts',
    source: authzSource,
    name: 'isApprovedActiveAdmin',
    requirements: [
      {
        what: '관리자 플래그만이 아니라 승인·활성까지 함께 본다',
        pattern: /return isApprovedActive\(profile\) && profile\?\.is_admin === true/,
      },
    ],
  },
  {
    file: 'src/lib/server/authz.ts',
    source: authzSource,
    name: 'canAccessBoardRoom',
    requirements: [
      { what: '승인·활성을 먼저 본다', pattern: /isApprovedActive\(profile\) &&/ },
      {
        what: '이사·관리자·감사 중 하나여야 한다',
        pattern:
          /profile\?\.is_director === true \|\| profile\?\.is_admin === true \|\| profile\?\.is_auditor === true/,
      },
    ],
  },
  {
    file: 'src/lib/server/adminAuth.ts',
    source: adminAuthBoundarySource,
    name: 'requireAdmin',
    requirements: [
      {
        what: '미인증이면 401로 막는다',
        pattern:
          /if \(!session\.authenticated \|\| !session\.user\) \{[\s\S]*?status: 401[\s\S]*?\}/,
      },
      {
        what: '프로필 조회 실패면 500으로 막는다',
        pattern:
          /if \(session\.profileError \|\| !session\.profile\) \{[\s\S]*?status: 500[\s\S]*?\}/,
      },
      {
        what: '승인·활성 관리자가 아니면 403으로 막는다',
        pattern:
          /if \(!isApprovedActiveAdmin\(session\.profile\)\) \{[\s\S]*?status: 403[\s\S]*?\}/,
      },
    ],
  },
  {
    file: 'src/lib/server/adminAuth.ts',
    source: adminAuthBoundarySource,
    name: 'checkAdminPermission',
    requirements: [
      { what: '프로필 행이 없으면 던진다', pattern: /if \(!profile\) \{\s*throw new Error\(/ },
      {
        what: '승인·활성 관리자가 아니면 던진다',
        pattern: /if \(!isApprovedActiveAdmin\(profile\)\) \{\s*throw new Error\(/,
      },
    ],
  },
  {
    file: 'src/lib/server/memberAuth.ts',
    source: memberAuthSource,
    name: 'classifySessionForMember',
    requirements: [
      {
        what: '미인증을 구분한다',
        pattern:
          /if \(!session\.authenticated \|\| !session\.user\) return ['"]unauthenticated['"]/,
      },
      {
        what: '프로필 조회 실패를 구분한다',
        pattern: /if \(session\.profileError \|\| !session\.profile\) return ['"]profile-error['"]/,
      },
      {
        what: '미승인·비활성을 구분한다',
        pattern: /if \(!isApprovedActive\(session\.profile\)\) return ['"]not-approved['"]/,
      },
    ],
  },
  {
    file: 'src/lib/server/memberAuth.ts',
    source: memberAuthSource,
    name: 'requireActiveMember',
    requirements: [
      {
        what: '판정을 classifySessionForMember에 위임한다',
        pattern: /const verdict = classifySessionForMember\(session\)/,
      },
      {
        what: '미인증이면 401로 막는다',
        pattern: /if \(verdict === ['"]unauthenticated['"]\) \{[\s\S]*?status: 401[\s\S]*?\}/,
      },
      {
        what: '프로필 조회 실패면 500으로 막는다',
        pattern: /if \(verdict === ['"]profile-error['"]\) \{[\s\S]*?status: 500[\s\S]*?\}/,
      },
      {
        what: '미승인·비활성이면 403으로 막는다(requireUser로 퇴화하지 않는다)',
        pattern: /if \(verdict === ['"]not-approved['"]\) \{[\s\S]*?status: 403[\s\S]*?\}/,
      },
    ],
  },
  {
    file: 'src/lib/server/boardRoomAuth.ts',
    source: boardRoomAuthBoundarySource,
    name: 'requireBoardMember',
    requirements: [
      {
        what: '미인증이면 401로 막는다',
        pattern:
          /if \(!session\.authenticated \|\| !session\.user\) \{[\s\S]*?status: 401[\s\S]*?\}/,
      },
      {
        what: '프로필 조회 실패면 500으로 막는다',
        pattern:
          /if \(session\.profileError \|\| !session\.profile\) \{[\s\S]*?status: 500[\s\S]*?\}/,
      },
      {
        what: '이사회 접근 권한이 없으면 403으로 막는다',
        pattern: /if \(!canAccessBoardRoom\(session\.profile\)\) \{[\s\S]*?status: 403[\s\S]*?\}/,
      },
    ],
  },
  {
    file: 'src/lib/server/boardRoomAuth.ts',
    source: boardRoomAuthBoundarySource,
    name: 'requireBoardRecordReader',
    requirements: [
      {
        what: '미인증이면 401로 막는다',
        pattern:
          /if \(!session\.authenticated \|\| !session\.user\) \{[\s\S]*?status: 401[\s\S]*?\}/,
      },
      {
        what: '프로필 조회 실패면 500으로 막는다',
        pattern:
          /if \(session\.profileError \|\| !session\.profile\) \{[\s\S]*?status: 500[\s\S]*?\}/,
      },
      {
        what: '승인·활성 조합원이 아니면 403으로 막는다',
        pattern: /if \(!canReadBoardRecords\(session\.profile\)\) \{[\s\S]*?status: 403[\s\S]*?\}/,
      },
      {
        what: '이사 여부를 isBoardMember로 알려 호출부가 이사회 전용 정보를 가릴 수 있게 한다',
        pattern: /isBoardMember: canAccessBoardRoom\(session\.profile\)/,
      },
    ],
  },
  {
    file: 'src/lib/server/boardRoomAuth.ts',
    source: boardRoomAuthBoundarySource,
    name: 'requireBoardDiscussionWriter',
    requirements: [
      {
        what: '승인·활성 조합원이 아니면 403으로 막는다',
        pattern: /if \(!canReadBoardRecords\(session\.profile\)\) \{[\s\S]*?status: 403[\s\S]*?\}/,
      },
      {
        what: '미인증이면 401로 막는다',
        pattern:
          /if \(!session\.authenticated \|\| !session\.user\) \{[\s\S]*?status: 401[\s\S]*?\}/,
      },
    ],
  },
  {
    file: 'src/lib/server/boardRoomAuth.ts',
    source: boardRoomAuthBoundarySource,
    name: 'requireBoardAdmin',
    requirements: [
      {
        what: '관리자가 아니면 403으로 막는다',
        pattern: /if \(!auth\.isAdmin\) \{[\s\S]*?status: 403[\s\S]*?\}/,
      },
    ],
  },
  // -------------------------------------------------------------------------
  // 최종 회차 C-2: 위 9개 판정 헬퍼는 전부 `session.profile`을 **입력으로**
  // 받는다. 그러니 그 공급자가 거짓말하면 아홉 개가 한꺼번에 열린다 —
  // 리뷰어 실증: `getSessionContext`가 `profile`을 `{ is_admin: true,
  // registration_status: 'approved', is_active: true }`로 위조해 돌려주게
  // 고쳐도 이 파일은 exit 0이었다.
  //
  // 정적 가드는 어딘가에서 멈춰야 하니 원리적 한계이긴 하다. 그래도 RLS가
  // 사라진 지금 이 세 함수가 **프로필의 유일한 출처**이고 본문을 다 합쳐도
  // 30줄이 안 되므로 고정 비용이 거의 없다. 고정하는 것은 두 가지뿐이다.
  //
  // 1. 프로필이 **DB에서 온다** — `resolveSessionProfile` → `fetchProfile`
  //    (기본값 `getProfileById`, 아래 authzReadsProfileFromDatabase가 그
  //    기본값과 import를 따로 못박는다).
  // 2. 어느 단계에서도 권한 필드를 **만들어 내지 않는다** — 세 본문 전부
  //    `is_admin:`·`registration_status:` 같은 키가 나타나면 실패한다
  //    (유일한 예외가 투영 함수인데, 그 본문은 아래에서 "profile.<필드>를
  //    그대로 옮긴다"는 모양으로 필드별로 고정된다).
  //
  // **`absent` 요구의 사정거리를 오해하지 마라 — 이 보증은 함수 본문에
  // 국소적이다.** 검사 대상은 `extractNamedFunctionBody`가 잘라낸 그 함수의
  // 중괄호 블록뿐이고, 모듈 스코프는 보지 않는다. 그래서 아래 모양은 고정된
  // 패턴 네 개가 전부 살아 있는 채로 **통과한다**(재리뷰어 실증):
  //
  //   const BACKDOOR_PROFILE = { is_admin: true, … }  // 모듈 스코프 = 검사 밖
  //   if (BACKDOOR_IDS.has(userId)) return { profile: BACKDOOR_PROFILE }
  //
  // 정적 가드는 어딘가에서 멈춰야 하니 원리적 한계다. 여기서 막으려 들지
  // 말고, "권한 필드 리터럴이 이 세 함수 **본문 안에** 나타나지 않는다"까지가
  // 이 계약이 실제로 보증하는 전부라고 읽어라. 그 밖은 코드 리뷰의 몫이다.
  {
    file: 'src/lib/server/authz.ts',
    source: authzSource,
    name: 'getSessionContext',
    requirements: [
      {
        what: '세션 사용자는 쿠키 세션에서 읽는다',
        pattern: /const user = await readSessionUser\(\)/,
      },
      {
        what: '세션이 없으면 프로필 없이 미인증으로 끝낸다',
        pattern:
          /if \(!user\) \{\s*return \{\s*authenticated: false,\s*user: null,\s*profile: null,/,
      },
      {
        what: '프로필은 DB 조회(resolveSessionProfile)로만 채운다',
        pattern: /const \{ profile, profileError \} = await resolveSessionProfile\(user\.id\)/,
      },
      {
        what: '조회 결과를 그대로 돌려준다(다른 값으로 바꿔치기하지 않는다)',
        pattern: /return \{\s*authenticated: true,\s*user,\s*profile,\s*profileError,\s*\}/,
      },
      {
        what: '권한·승인 필드를 직접 만들어 내지 않는다',
        absent: true,
        pattern: /\b(?:is_admin|is_director|is_auditor|is_active|registration_status)\s*:/,
      },
    ],
  },
  {
    file: 'src/lib/server/authz.ts',
    source: authzSource,
    name: 'resolveSessionProfile',
    requirements: [
      {
        what: '주입된 조회 함수로 실제 DB를 읽는다(타임아웃 포함)',
        pattern: /await withTimeout\(\s*fetchProfile\(userId\),/,
      },
      {
        what: '행이 없으면 null이다(기본 프로필을 만들어 내지 않는다)',
        pattern: /return \{ profile: profile \? toSessionProfileFields\(profile\) : null \}/,
      },
      {
        what: '조회 실패는 profile: null + profileError로 떨어진다(삼키지 않는다)',
        pattern: /catch \(profileError\) \{\s*return \{ profile: null, profileError \}\s*\}/,
      },
      {
        what: '권한·승인 필드를 직접 만들어 내지 않는다',
        absent: true,
        pattern: /\b(?:is_admin|is_director|is_auditor|is_active|registration_status)\s*:/,
      },
    ],
  },
  {
    file: 'src/lib/server/authz.ts',
    source: authzSource,
    name: 'toSessionProfileFields',
    // 여기만 권한 필드 키가 나타나도 되는 자리다(위 두 계약은 키 자체를
    // 금지한다). 그래서 "값이 전부 인자에서 온다"를 못박아야 하는데, 이걸
    // **한 덩어리 정규식**으로 하면 다섯 필드의 순서만 바꿔도 실패하고
    // 메시지는 "분기가 없습니다"라고 나온다 — 의미 없는 변경을 사실과 다른
    // 이유로 막는 셈이라, 걸린 사람이 계약을 지우는 쪽으로 가게 된다.
    //
    // 그래서 **필드별 양성 요구 5개 + 부정 요구 1개**로 쪼갠다. 순서·줄바꿈·
    // 정렬은 자유가 되고, 값 바꿔치기는 두 겹으로 막힌다.
    //
    // 남는 제약 하나: **인자 이름 `profile`은 여전히 고정된다.** 부정 요구가
    // "인자에서 온 값"을 `profile.`이라는 이름으로밖에 표현할 수 없기 때문이다
    // (그 이름이 자유로워지면 `is_admin: anything.is_admin`이 통과한다).
    // 그러니 인자를 `row` 같은 이름으로 바꾸면 여기서 걸린다 — 의도된 비용이다.
    // 대신 실패 메시지가 "분기가 없습니다"가 아니라 "계약이 못박은 모양을
    // 벗어났습니다"라고 말하므로, 걸린 사람이 원인을 오해하지는 않는다.
    //
    // 이 계약을 통째로 빼면 어떻게 되는지: 위 두 계약의 `absent`는
    // `getSessionContext`·`resolveSessionProfile` **본문에만** 걸려 있고
    // 이 함수에는 걸려 있지 않다. 그래서 계약을 빼고 `is_admin: profile.is_admin`을
    // `is_admin: true`로 바꾸면 파일 전체가 그대로 통과한다 — 위조가 실제로
    // 먹히는 유일한 자리의 보호가 통째로 사라진다. 빼지 마라.
    requirements: [
      ...['is_admin', 'is_director', 'is_auditor', 'registration_status', 'is_active'].map(
        field => ({
          what: `${field}를 인자 프로필의 같은 필드에서 그대로 옮긴다`,
          // 뒤의 `(?=[,}])`가 핵심이다. `\b`로 끝내면
          // `is_admin: profile.is_admin || FORCE_ADMIN`이 통과해 버린다 —
          // 한 덩어리 정규식이 (쉼표를 요구해서) 우연히 막던 각도라
          // 쪼개면서 잃지 않도록 명시적으로 되살린다.
          pattern: new RegExp(`${field}:\\s*profile\\.${field}\\s*(?=[,}])`),
        })
      ),
      {
        // 양성 요구 5개는 "있어야 할 것"만 본다. 필드를 **추가로** 끼워
        // 넣거나 다른 출처(`other.is_admin`)로 바꾸는 각도는 이쪽이 막는다.
        //
        // 공백을 lookahead **안**에 둔 것이 중요하다. `\s*:\s*(?!profile\.)`로
        // 쓰면 `\s*`가 0글자로 되짚어져 lookahead가 공백 위치에서 평가되고,
        // 그 결과 **올바른 본문까지 위반으로 잡힌다**(실측 확인).
        what: '다섯 권한 필드 중 어느 하나도 인자 프로필 아닌 값으로 채우지 않는다',
        absent: true,
        pattern:
          /\b(?:is_admin|is_director|is_auditor|registration_status|is_active)\s*:(?!\s*profile\.)/,
      },
    ],
  },
]

// 계약이 어디 적혀 있는지를 실패 메시지에 함께 싣는다 — 이 메시지를 처음 보는
// 사람이 "어느 파일을 고쳐야 하는가"를 되묻지 않도록.
const AUTHZ_CONTRACT_HINT =
  'scripts/testing/assert-runtime-risks.mjs의 AUTHORIZATION_HELPER_CONTRACTS'

const authorizationHelperBodyViolations = []
for (const contract of AUTHORIZATION_HELPER_CONTRACTS) {
  const body = extractNamedFunctionBody(contract.source, contract.name)
  if (body === null) {
    authorizationHelperBodyViolations.push(
      `${contract.file}: ${contract.name}() 본문을 찾지 못했습니다 — 함수가 사라졌거나 선언 모양이 바뀌었습니다(가드 고장으로 취급합니다)`
    )
    continue
  }
  for (const requirement of contract.requirements) {
    const found = requirement.pattern.test(body)
    if (requirement.absent === true ? found : !found) {
      // "분기가 없습니다"라고 뭉뚱그리지 않는다 — 요구 중에는 분기가 아닌
      // 것(투영 필드 하나하나)도 있어서, 필드 순서만 바꾼 사람에게는 사실과
      // 다르게 들린다. 못 찾았다는 사실만 말하고, 계약 위치를 함께 준다.
      authorizationHelperBodyViolations.push(
        requirement.absent === true
          ? `${contract.file}: ${contract.name}() 본문이 "${requirement.what}"를 어겼습니다 (이 계약은 ${AUTHZ_CONTRACT_HINT}에 있습니다)`
          : `${contract.file}: ${contract.name}() 본문에서 "${requirement.what}"를 확인하지 못했습니다 — 요구 자체가 사라졌거나, 계약이 못박은 모양을 벗어났습니다 (이 계약은 ${AUTHZ_CONTRACT_HINT}에 있습니다)`
      )
    }
  }
}

// 최종 회차 C-2의 나머지 절반: 위 본문 계약은 `fetchProfile(userId)`를 부르는
// 것까지만 본다. 그 `fetchProfile`의 **기본값**이 Turso 프로필 쿼리가 아니면
// (예: 하드코딩 객체를 돌려주는 스텁) 본문 계약은 그대로 통과한다. 기본
// 인자와 import는 함수 본문 밖이라 extractNamedFunctionBody가 보지 못하므로
// 여기서 따로 못박는다.
const authzReadsProfileFromDatabase =
  /import \{ getProfileById \} from ['"]@\/db\/queries\/profiles['"]/.test(authzSource) &&
  /fetchProfile: \(id: string\) => Promise<ProfileLike \| null> = getProfileById/.test(authzSource)
if (!authzReadsProfileFromDatabase) {
  authorizationHelperBodyViolations.push(
    `src/lib/server/authz.ts: resolveSessionProfile()의 기본 조회 함수가 @/db/queries/profiles의 getProfileById가 아닙니다 — 프로필이 DB에서 오지 않으면 위 본문 계약은 전부 통과해도 아무 의미가 없습니다`
  )
}

const serverRateLimitPath = join(root, 'src/lib/server/rateLimit.ts')
const serverRateLimitSource = existsSync(serverRateLimitPath)
  ? readSourceAt(serverRateLimitPath)
  : ''
const serverApiRoutePath = join(root, 'src/lib/server/apiRoute.ts')
const serverApiRouteSource = existsSync(serverApiRoutePath) ? readSourceAt(serverApiRoutePath) : ''
const serverStreamRoutePath = join(root, 'src/lib/server/streamRoute.ts')
const serverStreamRouteSource = existsSync(serverStreamRoutePath)
  ? readSourceAt(serverStreamRoutePath)
  : ''
const apiRouteFiles = globSync('src/app/api/**/route.@(ts|tsx)', {
  cwd: root,
  exclude: ['**/node_modules/**', '**/.next/**'],
})
// `appFiles`와 같은 장치(walkFiles 설명 참고). 이 목록이 비면 raw `getUser(`
// 금지와 레거시 rate limiter import 금지가 통째로 꺼진다.
const API_ROUTE_FILES_MIN = 60 // 현재 91
const apiRouteFilesExpected = walkFiles('src/app/api', name => /^route\.tsx?$/.test(name))
const apiRouteFilesMissed = missingFrom(apiRouteFiles, apiRouteFilesExpected)

// ---------------------------------------------------------------------------
// 특권 트리(admin·board-room)의 모든 핸들러가 게이트를 선언했는가 — 글롭으로.
//
// `defineApiRoute`의 `auth`는 이번 회차에서 **필수 필드**가 됐다(공개
// 라우트는 `auth: 'public'`을 명시해야 한다). 그래도 이 가드가 따로 필요한
// 이유는 두 가지다.
//
// 1. 타입은 `defineApiRoute`를 쓰기로 한 라우트만 본다. `src/app/api/
//    board-room/**`의 11개 라우트는 전부 `export async function GET(...)`
//    맨몸이고, 새 admin 라우트를 그 모양으로 베껴 쓰면 프레임워크가 아예
//    개입하지 않는다.
// 2. `auth: 'public'`은 타입상 합법이다. 특권 트리에서는 그 값이 곧 사고다.
//
// 예전 가드는 **손으로 적은 약 30개 경로 목록**이었다 — 내일 추가되는
// admin 라우트를 구조적으로 못 잡는다. 그래서 트리 전체를 훑는다.
const PRIVILEGED_ROUTE_TREES = ['src/app/api/admin', 'src/app/api/board-room']
const PRIVILEGED_ROUTE_FILES_MIN = 35 // 현재 41 (admin 30 + board-room 11)
const privilegedRouteFiles = PRIVILEGED_ROUTE_TREES.flatMap(tree =>
  globSync(`${tree}/**/route.@(ts|tsx)`, {
    cwd: root,
    exclude: ['**/node_modules/**', '**/.next/**'],
  })
).sort()
const privilegedRouteFilesExpected = PRIVILEGED_ROUTE_TREES.flatMap(tree =>
  walkFiles(tree, name => /^route\.tsx?$/.test(name))
).sort()
const privilegedRouteFilesMissed = missingFrom(privilegedRouteFiles, privilegedRouteFilesExpected)

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']
// `defineApiRoute`/`defineStreamRoute`의 `auth`로 인정하는 값. 특권 트리에서
// `'public'`은 **의도적으로 빠져 있다** — 그게 이 가드가 잡으려는 값이다.
const PRIVILEGED_AUTH_VALUES = [
  /^['"]admin['"]/,
  /^['"]board-member['"]/,
  /^createSettingsAdminAuth\(/,
]
// 맨몸 핸들러가 불러야 하는 게이트.
//
// `requireBoardRecordReader()`는 이사회 **기록 읽기**(회의 목록·안건·토론·
// 회의록 GET) 전용 게이트다. 승인·활성 조합원까지 통과시키므로
// `requireBoardMember()`보다 넓지만 비인증·미승인·비활성은 그대로 막고,
// 이사회 전용 정보(일정 투표·출석·정족수)는 호출부가 `isBoardMember`로
// 갈라 응답에서 뺀다. **쓰기 핸들러에 쓰면 안 된다** — 아래
// `boardRecordReaderReadOnly` 계약이 그 오용을 잡는다.
const PRIVILEGED_GATE_CALLS = [
  /requireAdmin\(\)/,
  /requireBoardMember\(\)/,
  /requireBoardRecordReader\(\)/,
  /requireBoardDiscussionWriter\(\)/,
]

// `requireBoardDiscussionWriter()`는 승인·활성 조합원까지 통과시키는 **쓰기**
// 게이트다. 안건 토론 하나만을 위한 의도적 예외이므로, 아래 두 파일 밖에서
// 쓰이면 실패한다 — 이름만 빌려다 일정 투표·출석·서류함에 붙이는 순간
// 이사회 쓰기가 조합원 전체에게 열린다.
const DISCUSSION_WRITE_ROUTE_FILES = new Set([
  'src/app/api/board-room/agendas/[id]/comments/route.ts',
  'src/app/api/board-room/agendas/[id]/comments/[commentId]/route.ts',
])
// 405 스텁(`export async function POST() { return ApiError.methodNotAllowed(...) }`)
// 은 데이터를 만지지 않는다. 본문 전체가 그 한 줄일 때만 면제한다 — 뒤에
// 뭐라도 붙으면 더 이상 스텁이 아니므로 게이트를 요구한다.
const METHOD_NOT_ALLOWED_STUB =
  /^\s*\{\s*return ApiError\.methodNotAllowed\([^)]*\)\.toNextResponse\(\)\s*\}\s*$/

/**
 * `code`에서 `export async function <method>(`의 본문(중괄호 블록)을 잘라낸다.
 * 시그니처의 괄호 안에 중괄호가 들어가므로(구조 분해 인자) 여는 중괄호는
 * 인자 목록의 괄호 균형을 먼저 맞춘 뒤에 찾는다.
 */
function extractExportedFunctionBody(code, method) {
  const marker = new RegExp(`export async function ${method}\\s*\\(`)
  const match = marker.exec(code)
  if (!match) return null

  let i = code.indexOf('(', match.index)
  let depth = 0
  for (; i < code.length; i++) {
    if (code[i] === '(') depth++
    else if (code[i] === ')') {
      depth--
      if (depth === 0) break
    }
  }
  const braceStart = code.indexOf('{', i)
  if (braceStart === -1) return null

  depth = 0
  for (let j = braceStart; j < code.length; j++) {
    if (code[j] === '{') depth++
    else if (code[j] === '}') {
      depth--
      if (depth === 0) return code.slice(braceStart, j + 1)
    }
  }
  return null
}

const ungatedPrivilegedHandlers = []
for (const file of privilegedRouteFiles) {
  const raw = readSourceAt(join(root, file))
  // 주석·import를 걷어낸 코드로 본다 — 주석에 남은 `auth: 'admin'`이나
  // 주석 처리된 `requireBoardMember()`로 통과하면 안 된다.
  const code = stripCommentsAndImports(raw)
  // 문자열 리터럴까지 걷어낸 판본. `auth` 키가 **실제로 존재하는지**와
  // 게이트 호출부가 실제 코드인지를 볼 때 쓴다(디코이 문자열 면역).
  const codeNoStrings = stripStringLiterals(code)

  let handlersSeen = 0
  for (const method of HTTP_METHODS) {
    const constDecl = new RegExp(`export const ${method}\\s*=`).exec(code)
    const fnDecl = new RegExp(`export async function ${method}\\s*\\(`).exec(code)
    if (!constDecl && !fnDecl) continue
    handlersSeen += 1

    if (constDecl) {
      const isDefineRoute = new RegExp(
        `export const ${method}\\s*=\\s*define(Api|Stream)Route`
      ).test(code)
      if (!isDefineRoute) {
        ungatedPrivilegedHandlers.push(
          `${file}: export const ${method} — defineApiRoute/defineStreamRoute를 쓰지 않아 auth 선언을 강제할 수 없습니다`
        )
        continue
      }
      const block = extractDefineApiRouteBlock(code, method)
      const blockNoStrings = extractDefineApiRouteBlock(codeNoStrings, method)
      if (block === null || blockNoStrings === null) {
        ungatedPrivilegedHandlers.push(
          `${file}: export const ${method} — 설정 블록을 잘라내지 못했습니다(가드 고장으로 취급합니다)`
        )
        continue
      }
      // `auth` 키의 **존재와 위치**는 둘 다 문자열을 걷어낸 판본에서 본다.
      //
      // 최종 회차 C-3: 예전에는 존재만 걷어낸 판본에서 보고 **값 추출은
      // 문자열이 살아 있는 `block`**에서 첫 `\bauth:` 매치로 했다. 그래서
      // 진짜 키보다 앞에 놓인 문자열 리터럴 하나로 그대로 뚫렸다 —
      // `name: "auth: 'admin'"`을 `auth: 'public'` 위에 적으면 값 추출이
      // 그 디코이를 읽어 특권 트리 라우트가 공개로 열린 채 통과했다
      // (리뷰어 실증). 보고서에 적혔던 "디코이 문자열 면역"은 존재 검사에만
      // 해당하는 말이었고, 값 검사에는 해당되지 않았다.
      //
      // 이제 진짜 `auth:` 키의 **오프셋**을 문자열 제거판에서 찾고, 값은
      // 원본 블록의 같은 오프셋부터 읽는다(`stripStringLiterals`가 길이·위치를
      // 보존하므로 두 판본의 인덱스가 1:1이다). 값 비교에는 따옴표가 필요해서
      // 원본에서 읽어야 하지만, **어디서부터 읽을지는 문자열이 정하지 못한다.**
      //
      // 공백 건너뛰기는 **원본 블록에서** 한다. 문자열 제거판에서 `\s*`까지
      // 함께 매치하면 방금 공백으로 바뀐 리터럴 자리를 그대로 먹어 치워
      // 값의 시작점을 지나쳐 버린다(실측: 41개 특권 라우트가 전부 "auth 값이
      // 아닙니다"로 오탐).
      const authKeyMatch = /\bauth:/.exec(blockNoStrings)
      if (!authKeyMatch) {
        ungatedPrivilegedHandlers.push(`${file}: export const ${method} — auth 선언이 없습니다`)
        continue
      }
      const value = block.slice(authKeyMatch.index + authKeyMatch[0].length).replace(/^[\s]*/, '')
      if (!PRIVILEGED_AUTH_VALUES.some(pattern => pattern.test(value))) {
        ungatedPrivilegedHandlers.push(
          `${file}: export const ${method} — auth 값이 'admin'·'board-member'·createSettingsAdminAuth() 중 하나가 아닙니다`
        )
      }
      continue
    }

    const body = extractExportedFunctionBody(code, method)
    if (body === null) {
      ungatedPrivilegedHandlers.push(
        `${file}: export async function ${method} — 본문을 잘라내지 못했습니다(가드 고장으로 취급합니다)`
      )
      continue
    }
    if (METHOD_NOT_ALLOWED_STUB.test(body)) continue

    const bodyNoStrings = extractExportedFunctionBody(codeNoStrings, method) ?? ''
    const hasGate = PRIVILEGED_GATE_CALLS.some(pattern => pattern.test(bodyNoStrings))

    // 열람 게이트는 GET에만 허용한다. `requireBoardRecordReader()`는 승인·활성
    // 조합원까지 통과시키므로, 이걸 POST/PATCH/DELETE에 붙이면 이사회 쓰기가
    // 조합원 전체에게 열린다 — 위 `hasGate`만 보면 그 오용이 초록으로 통과한다.
    if (method !== 'GET' && /requireBoardRecordReader\(\)/.test(bodyNoStrings)) {
      ungatedPrivilegedHandlers.push(
        `${file}: export async function ${method} — requireBoardRecordReader()는 읽기(GET) 전용입니다. 쓰기 핸들러는 requireBoardMember()를 써야 합니다`
      )
      continue
    }
    // 토론 쓰기 게이트는 허용된 파일에서만 쓴다(위 DISCUSSION_WRITE_ROUTE_FILES).
    if (
      /requireBoardDiscussionWriter\(\)/.test(bodyNoStrings) &&
      !DISCUSSION_WRITE_ROUTE_FILES.has(file)
    ) {
      ungatedPrivilegedHandlers.push(
        `${file}: export async function ${method} — requireBoardDiscussionWriter()는 안건 토론 라우트 전용입니다. 다른 이사회 쓰기는 requireBoardMember()를 써야 합니다`
      )
      continue
    }
    // 호출만으로는 부족하다 — 반환값을 버리면 게이트가 없는 것과 같다.
    const returnsOnDenial = /instanceof NextResponse\)\s*return/.test(bodyNoStrings)
    if (!hasGate || !returnsOnDenial) {
      ungatedPrivilegedHandlers.push(
        `${file}: export async function ${method} — ${
          hasGate
            ? 'requireAdmin()/requireBoardMember()의 거부 응답을 return하지 않습니다'
            : 'requireAdmin()/requireBoardMember() 호출이 없습니다'
        }`
      )
    }
  }

  // 공허한 통과 차단: 라우트 파일인데 인식된 HTTP 핸들러가 하나도 없다면
  // 위 루프는 아무것도 검사하지 않은 것이다(핸들러 선언 모양이 바뀌었거나
  // HTTP_METHODS 목록이 좁아진 경우). 그건 "깨끗하다"가 아니라 가드 고장이다.
  if (handlersSeen === 0) {
    ungatedPrivilegedHandlers.push(
      `${file}: 인식된 HTTP 핸들러가 하나도 없습니다 — 이 파일에 대해서는 auth 강제 검사가 아무것도 실행되지 않았습니다(가드 고장으로 취급합니다)`
    )
  }
}
// 인증 강제 검사는 requireUser()/requireActiveMember()(@/lib/server/memberAuth)로
// 수렴됐다(Task 3~5). 이 목록에 없는 라우트에서 `getUser(` 직접 호출이
// 되살아나면(예: 헬퍼 도입 전 패턴으로 새 라우트를 베껴 쓰는 경우) 실패한다.
// 각 항목에는 왜 허용되는지 이유를 한 줄 주석으로 단다. 이 검사식은 과거
// 세 번 연속 "초록불인데 아무것도 안 지키는" 상태로 발견됐던 전례가 있어서
// stripCommentsAndImports를 반드시 거친 코드만 본다 — 주석·import 문에 남은
// 문자열로 거짓 양성/거짓 통과가 나지 않게 하기 위해서다.
//
// 허용은 파일 단위지만, 같은 파일 안에 강제 인증을 요구하는 다른 핸들러가
// 있으면(예: PATCH는 requireActiveMember, GET은 선택적 getUser) 파일을
// 통째로 면제하는 순간 그 강제 핸들러도 보호 밖으로 나간다(Task 5 리뷰
// Critical 1·2). 그래서 그런 파일에는 `mustAlsoCall`로 "그래도 이 헬퍼
// 호출은 파일 어딘가에 반드시 있어야 한다"는 양의 단정을 짝지어 둔다 —
// 헬퍼 호출 자체가 통째로 삭제되면(주석만 남기고 지우는 것 포함) 이 양의
// 단정이 깨져서 여전히 실패한다.
const directGetUserAllowlist = [
  // auth/verify-session/route.ts는 여기 없다: UserAuthSuccess에
  // email_confirmed_at이 추가되면서(최종 리뷰 반영) 이 라우트가 직접 부르던
  // 두 번째 supabase.auth.getUser()가 사라졌다 — 이제 이 파일에는 raw
  // getUser( 호출이 전혀 없으므로 이 allowlist에 있을 이유가 없다(있어도
  // 없어도 게이트 결과는 같지만, allowlist는 "raw getUser가 이 파일에 있어도
  // 된다"는 뜻이라 실제로 없는 파일을 올려두면 그 자체가 오해를 부른다).
  // requireUser() 호출 존재는 verifySessionTreatsMissingSessionAsNormal과
  // requiredAuthHelperCallCounts(아래) 둘이 고정한다.
  //
  // 단계 2b-4(Task 2)에서 posts/route.ts · posts/[id]/route.ts ·
  // posts/[id]/comments/route.ts · posts/[id]/comments-list/route.ts ·
  // posts/[id]/view/route.ts · notifications/route.ts ·
  // notifications/bulk/route.ts를 getOptionalUser()/requireUser()로
  // 수렴시켰다 — 이 7개 파일에는 이제 raw getUser( 호출이 전혀 없으므로
  // 같은 이유로 여기서 지운다(auth/verify-session/route.ts와 동일 논리).
  // 강제 핸들러(POST/PATCH/DELETE)가 여전히
  // requireActiveMember()/requireUser()를 부르는지는 이 allowlist가 아니라
  // requiredAuthHelperCallCounts(아래)가 파일별 개수까지 고정한다 — 파일이
  // 이 목록에서 빠지면 mustAlsoCall 보호도 함께 사라지므로, 그 보호를
  // requiredAuthHelperCallCounts로 옮겨 심었다(존재만이 아니라 개수까지).
  // 인증 흐름 자체를 구현하는 라우트 — 비밀번호 재설정은 단계 2b(Better Auth
  // 전환)에서 통째로 바뀔 예정이라 이번 수렴 대상에서 제외한다.
  { file: 'src/app/api/auth/reset-password/route.ts' },
  // GET은 401 없이 authenticated:boolean만 돌려주는 선택적 조회라 강제 게이트
  // 대상이 아니지만, POST(세션 시작/갱신/종료)는 requireUser()가 강제다.
  // 파일 면제만으로는 POST의 강제 검사가 보호 밖이 된다. 이 파일은 단계
  // 2b-4(Task 2) 범위에서 의도적으로 제외했다 — GET의 오류 분기가 500을
  // 반환하는데(`ApiError.internalServerError('세션 확인 실패')`)
  // getOptionalUser()/readSessionUser()는 오류를 null로 삼켜 그 분기가
  // 사라진다(동작 변경). raw getUser( 호출이 남아 있으므로 allowlist에도
  // 남는다.
  { file: 'src/app/api/activities/session/route.ts', mustAlsoCall: [/requireUser\(\)/] },
]
const directGetUserOffenders = apiRouteFiles.filter(file => {
  const source = readSourceAt(join(root, file))
  // mustAlsoCall은 "호출부가 실제로 있는가"만 보는 양의 단정이라, 문자열
  // 리터럴까지 걷어낸 코드로 검사해야 `const decoy = "requireUser()"` 같은
  // 가짜 호출부 문자열로 속지 않는다(Task 5 3라운드 리뷰에서 실증됨). 이
  // 지역 변수는 다른 곳에서 재사용되지 않으므로 문자열을 완전히 걷어내도
  // 안전하다.
  const code = stripStringLiterals(stripCommentsAndImports(source))
  const allowEntry = directGetUserAllowlist.find(entry => entry.file === file)
  if (!allowEntry) {
    return /getUser\(/.test(code)
  }
  // 허용된 파일이라도 mustAlsoCall로 짝지은 헬퍼 호출이 사라졌으면(옛 raw
  // getUser 패턴으로 되돌아갔거나, 인증 블록 자체가 통째로 삭제됐거나,
  // 문자열 리터럴 디코이로 대체됐으면) 여전히 실패시킨다 — "파일 단위 허용"이
  // "그 파일의 강제 검사가 사라져도 된다"는 뜻이 되지 않게 하기 위해서다.
  const missingRequiredCall = (allowEntry.mustAlsoCall || []).some(pattern => !pattern.test(code))
  return missingRequiredCall
})
// directGetUserAllowlist(위)는 "raw getUser() 직접 호출이 이 파일에 있어도
// 되는가"만 본다. 그 allowlist에 없는(=raw getUser()가 전혀 없는) 파일에서
// 강제 인증 블록이 통째로 삭제되면, `getUser(` 스캔에는 아무것도 안 걸려서
// directGetUserOffenders가 침묵한다 — 최종 리뷰에서 27개 memberAuth 소비
// 파일 중 19개가 이 구멍에 해당한다고 확인됨(media/upload, settings,
// activities/log 등 인증 블록 통째 삭제 실측으로 재현).
//
// 아래 매니페스트는 `@/lib/server/memberAuth`를 import하는 모든
// src/app/api/**/route.ts에 대해 "이 헬퍼가 최소 몇 번 호출돼야 하는가"를
// 파일별로 고정한다. 현재 게이트 상태를 자동 스냅샷한 것이 아니라, 각 파일을
// 직접 읽어 핸들러 단위로 실제 호출을 확인한 값이다(2026-08-14). 개수까지
// 세는 이유: 같은 헬퍼를 여러 핸들러가 부르는 파일(예: settings/route.ts의
// GET·POST·PUT 전부 requireUser())에서 그중 하나만 지워지는 것도 잡기
// 위해서다 — "존재"만 보면 나머지 호출 하나가 살아있는 것만으로 통과해버린다.
// 최소 개수(min) 비교라 새 핸들러 추가로 호출이 늘어나는 것은 실패시키지
// 않는다(그런 변경은 이 매니페스트를 갱신할 유인이 없어도 게이트가 거짓
// 실패하지 않아야 하므로).
//
// activities/session/route.ts는 이미 위 directGetUserAllowlist의
// mustAlsoCall이 "호출부 존재"를 고정하고 있어서(raw getUser()가 아직 이
// 파일에 남아 있어 저 메커니즘을 타야 한다) 여기 다시 넣지 않는다 — 같은
// 보증을 두 구조로 중복시키지 않기 위해서다. posts/route.ts·
// mypage/profile/route.ts도 각각
// postsApiCreatesPostsWithServerAuthAndInvalidatesBoard·
// profileApiRestrictsSelfUpdates가 requireActiveMember() 존재를 고정하지만,
// 그 두 단정은 "존재"만 볼 뿐 mypage/profile/route.ts처럼 같은 헬퍼를 두 번
// (GET·PATCH) 부르는 파일에서 "몇 번"까지는 못 본다 — 그래서 이 매니페스트에
// 넣어 개수까지 고정한다(중복이 아니라 보강). posts/route.ts는 raw
// getUser()가 사라졌지만 존재 단정은 이미 있으므로 개수(1)만 통일해 둔다.
//
// 단계 2b-4(Task 2)에서 posts/[id]/route.ts · posts/[id]/comments/route.ts ·
// notifications/route.ts · notifications/bulk/route.ts의 raw getUser()가
// getOptionalUser()/requireUser()로 수렴돼 사라지면서, 그 파일들을 위의
// directGetUserAllowlist에서도 지웠다 — mustAlsoCall이 지키던 "강제 핸들러가
// 여전히 헬퍼를 부르는가" 보증이 함께 사라지므로, 그 보증을 여기로 옮겨
// 개수까지 고정한다.
const requiredAuthHelperCallCounts = [
  {
    file: 'src/app/api/activities/batch-log/route.ts',
    calls: [{ pattern: /requireUser\(\)/g, min: 1 }],
  },
  { file: 'src/app/api/activities/log/route.ts', calls: [{ pattern: /requireUser\(\)/g, min: 1 }] },
  {
    file: 'src/app/api/activities/logout/route.ts',
    calls: [{ pattern: /requireUser\(\)/g, min: 1 }],
  },
  {
    file: 'src/app/api/auth/verify-session/route.ts',
    calls: [{ pattern: /requireUser\(\)/g, min: 1 }],
  },
  {
    file: 'src/app/api/comments/[id]/like/route.ts',
    calls: [{ pattern: /requireActiveMember\(\)/g, min: 1 }],
  },
  { file: 'src/app/api/link-preview/route.ts', calls: [{ pattern: /requireUser\(\)/g, min: 1 }] },
  {
    // POST(업로드)는 requireActiveMember(), GET(목록)은 requireUser() — 서로 다른
    // 헬퍼를 요구하므로 POST가 requireUser()로 강등돼도(파일에 requireUser()
    // 자체는 여전히 있다) requireActiveMember() 개수가 부족해져 걸린다.
    file: 'src/app/api/media/upload/route.ts',
    calls: [
      { pattern: /requireActiveMember\(\)/g, min: 1 },
      { pattern: /requireUser\(\)/g, min: 1 },
    ],
  },
  {
    file: 'src/app/api/mypage/activity/route.ts',
    calls: [{ pattern: /requireActiveMember\(\)/g, min: 1 }],
  },
  {
    // PUT은 requireActiveMember(), DELETE·GET 둘 다 requireUser().
    file: 'src/app/api/mypage/artist/photo/route.ts',
    calls: [
      { pattern: /requireActiveMember\(\)/g, min: 1 },
      { pattern: /requireUser\(\)/g, min: 2 },
    ],
  },
  {
    // GET·PATCH 둘 다 requireActiveMember().
    file: 'src/app/api/mypage/artist/route.ts',
    calls: [{ pattern: /requireActiveMember\(\)/g, min: 2 }],
  },
  {
    // GET·PATCH 둘 다 requireActiveMember() — profileApiRestrictsSelfUpdates가
    // 존재는 이미 고정하지만 개수(2)까지는 안 본다.
    file: 'src/app/api/mypage/profile/route.ts',
    calls: [{ pattern: /requireActiveMember\(\)/g, min: 2 }],
  },
  {
    // PATCH·DELETE 둘 다 requireUser().
    file: 'src/app/api/notifications/[id]/route.ts',
    calls: [{ pattern: /requireUser\(\)/g, min: 2 }],
  },
  {
    // POST(대량 생성, 관리자 권한 확인의 로그인 검사)·PATCH(모두 읽음)
    // 둘 다 requireUser(). PATCH는 원래부터 requireUser()였고, POST의
    // getUser()+수동 401 분기를 단계 2b-4(Task 2)에서 requireUser()로
    // 수렴시켰다 — 그 뒤의 is_admin 프로필 확인(403)은 그대로 둔다.
    file: 'src/app/api/notifications/bulk/route.ts',
    calls: [{ pattern: /requireUser\(\)/g, min: 2 }],
  },
  {
    // GET·POST(대량 생성, 관리자 권한 확인의 로그인 검사) 둘 다 requireUser().
    // GET은 원래부터 requireUser()였고, POST의 getUser()+수동 401 분기를
    // 단계 2b-4(Task 2)에서 requireUser()로 수렴시켰다 — 그 뒤의 is_admin
    // 프로필 확인(403)은 그대로 둔다.
    file: 'src/app/api/notifications/route.ts',
    calls: [{ pattern: /requireUser\(\)/g, min: 2 }],
  },
  {
    file: 'src/app/api/notifications/stats/route.ts',
    calls: [{ pattern: /requireUser\(\)/g, min: 1 }],
  },
  {
    // GET·PUT·DELETE 전부 requireUser().
    file: 'src/app/api/posts/[id]/attachments/[attachmentId]/route.ts',
    calls: [{ pattern: /requireUser\(\)/g, min: 3 }],
  },
  {
    file: 'src/app/api/posts/[id]/attachments/route.ts',
    calls: [{ pattern: /requireUser\(\)/g, min: 1 }],
  },
  {
    // POST(댓글 작성)는 requireActiveMember() — GET(선택적 조회)은 단계
    // 2b-4(Task 2)에서 getOptionalUser()로 수렴됐다.
    file: 'src/app/api/posts/[id]/comments/route.ts',
    calls: [{ pattern: /requireActiveMember\(\)/g, min: 1 }],
  },
  {
    file: 'src/app/api/posts/[id]/comments/[commentId]/route.ts',
    calls: [{ pattern: /requireUser\(\)/g, min: 1 }],
  },
  {
    // GET은 requireUser(), POST(좋아요)는 requireActiveMember().
    file: 'src/app/api/posts/[id]/likes/route.ts',
    calls: [
      { pattern: /requireUser\(\)/g, min: 1 },
      { pattern: /requireActiveMember\(\)/g, min: 1 },
    ],
  },
  {
    // PATCH는 requireActiveMember(), DELETE는 requireUser() — GET(선택적
    // 조회)은 단계 2b-4(Task 2)에서 getOptionalUser()로 수렴됐다.
    file: 'src/app/api/posts/[id]/route.ts',
    calls: [
      { pattern: /requireActiveMember\(\)/g, min: 1 },
      { pattern: /requireUser\(\)/g, min: 1 },
    ],
  },
  {
    file: 'src/app/api/posts/[id]/user-data/route.ts',
    calls: [{ pattern: /requireUser\(\)/g, min: 1 }],
  },
  {
    // postsApiCreatesPostsWithServerAuthAndInvalidatesBoard가 존재는 고정하지만
    // 이 파일은 호출이 1번뿐이라 개수 단정을 추가해도 보강 효과는 없다 —
    // 다른 파일과 같은 매니페스트 형태로 통일해 두는 목적. GET(선택적
    // 조회)은 단계 2b-4(Task 2)에서 getOptionalUser()로 수렴됐다.
    file: 'src/app/api/posts/route.ts',
    calls: [{ pattern: /requireActiveMember\(\)/g, min: 1 }],
  },
  { file: 'src/app/api/settings/reset/route.ts', calls: [{ pattern: /requireUser\(\)/g, min: 1 }] },
  {
    // GET·POST·PUT 전부 requireUser() — 사용자가 직접 재현한 구멍(1+/4-, 잔존 2).
    file: 'src/app/api/settings/route.ts',
    calls: [{ pattern: /requireUser\(\)/g, min: 3 }],
  },
  {
    file: 'src/app/api/users/[id]/likes/route.ts',
    calls: [{ pattern: /requireUser\(\)/g, min: 1 }],
  },
]
const requiredAuthHelperCallViolations = requiredAuthHelperCallCounts.flatMap(({ file, calls }) => {
  const fullPath = join(root, file)
  if (!existsSync(fullPath)) {
    return [`${file}: 파일이 없습니다 — requiredAuthHelperCallCounts 매니페스트를 정리하세요.`]
  }
  const source = readSourceAt(fullPath)
  // 존재 검사이므로(개수 카운트도 "얼마나 있는가"라 mustAlsoCall과 동일한 성격)
  // 문자열 리터럴 디코이(`const decoy = "requireUser()"`)에 속지 않도록
  // stripStringLiterals까지 거친 코드로 센다.
  const code = stripStringLiterals(stripCommentsAndImports(source))
  return calls
    .filter(({ pattern, min }) => {
      const count = (code.match(pattern) || []).length
      return count < min
    })
    .map(({ pattern, min }) => {
      const count = (code.match(pattern) || []).length
      return `${file}: ${pattern} 최소 ${min}회 필요, 실제 ${count}회`
    })
})
const apiRoutesUsingLegacyRateLimitImports = apiRouteFiles.filter(file => {
  const source = readSourceAt(join(root, file))
  return /from\s+['"]@\/utils\/(?:distributedRateLimiter|rateLimiter|rateLimit)['"]/.test(source)
})
const apiRoutesUsingDistributedRateLimitSymbols = apiRouteFiles.filter(file => {
  const source = readSourceAt(join(root, file))
  return /distributedRateLimiter|DISTRIBUTED_RATE_LIMIT_CONFIGS|createDistributed(?:User|IP|Route)KeyGenerator|addDistributedRateLimitHeaders/.test(
    source
  )
})
const hasSharedServerRateLimitFacade =
  /export const RATE_LIMITS/.test(serverRateLimitSource) &&
  /export const RATE_LIMIT_CONFIGS/.test(serverRateLimitSource) &&
  /export async function applyRouteRateLimit/.test(serverRateLimitSource) &&
  /export async function applyRateLimit/.test(serverRateLimitSource) &&
  /export const withRateLimit/.test(serverRateLimitSource) &&
  /export const rateLimit/.test(serverRateLimitSource) &&
  /createUserKeyGenerator/.test(serverRateLimitSource) &&
  /addRateLimitHeaders/.test(serverRateLimitSource) &&
  /from\s+['"]@\/utils\/distributedRateLimiter['"]/.test(serverRateLimitSource)
const hasSharedJsonApiRouteWrapper =
  /export function defineApiRoute/.test(serverApiRouteSource) &&
  /applyRouteRateLimit/.test(serverApiRouteSource) &&
  /parseJsonObjectBody/.test(serverApiRouteSource) &&
  /requireAdmin/.test(serverApiRouteSource) &&
  /requireBoardMember/.test(serverApiRouteSource) &&
  /ApiError/.test(serverApiRouteSource) &&
  /handler:\s*\([\s\S]*?ctx:\s*ApiRouteContext/.test(serverApiRouteSource) &&
  /result instanceof NextResponse/.test(serverApiRouteSource)
const hasSharedStreamRouteWrapper =
  /export function defineStreamRoute/.test(serverStreamRouteSource) &&
  /applyRouteRateLimit/.test(serverStreamRouteSource) &&
  /requireAdmin/.test(serverStreamRouteSource) &&
  /handler:\s*\([\s\S]*?ctx:\s*StreamRouteContext/.test(serverStreamRouteSource) &&
  !/addRateLimitHeaders/.test(serverStreamRouteSource) &&
  !/parseJsonObjectBody/.test(serverStreamRouteSource)

const rateLimiterPath = join(root, 'src/utils/distributedRateLimiter.ts')
const rateLimiterSource = readSourceAt(rateLimiterPath)
const rateLimiterCompatPath = join(root, 'src/utils/rateLimiter.ts')
const rateLimiterCompatSource = readSourceAt(rateLimiterCompatPath)
const rateLimitWrapperPath = join(root, 'src/utils/rateLimit.ts')
const rateLimitWrapperSource = readSourceAt(rateLimitWrapperPath)
const verifyEnvPath = join(root, 'scripts/verify-env.js')
const verifyEnvSource = readSourceAt(verifyEnvPath)
const readmePath = join(root, 'README.md')
const readmeSource = readSourceAt(readmePath)
// docs/ 는 .gitignore 대상(총회·이사회 회의록 등 민감 내용 포함)이라 CI 체크아웃에는
// 파일이 없다. 없다고 크래시하면 안 되지만, 조용히 통과시켜서도 안 된다 — 파일이 없을
// 때는 이 문서 관련 검사만 명시적으로 건너뛰고(SKIPPED 로그), 나머지 검사는 정상 실행한다.
const deploymentGuidePath = join(root, 'docs/deployment-guide.md')
const deploymentGuideAvailable = existsSync(deploymentGuidePath)
const deploymentGuideSource = deploymentGuideAvailable ? readSourceAt(deploymentGuidePath) : ''
const constructorMatch = rateLimiterSource.match(
  /constructor\s*\(\)\s*\{[\s\S]*?\n\s{2}\}\n\n\s{2}private reportMemoryFallbackIfNeeded/
)
const constructorSource = constructorMatch?.[0] ?? ''
const logsAtConstruction =
  /log\.(?:error|warn)\(/.test(constructorSource) || /logSecurityEvent\s*\(/.test(constructorSource)
const parsesRedisRateLimitStatsSafely =
  /parseIntegerParam/.test(rateLimiterSource) &&
  /count:\s*parseIntegerParam\(count,\s*0,\s*\{\s*min:\s*0\s*\}\)/.test(rateLimiterSource) &&
  !/count:\s*parseInt\(count/.test(rateLimiterSource)
const supportsVercelMarketplaceUpstashEnv =
  /function resolveFirstNonEmptyEnv/.test(rateLimiterSource) &&
  /resolveFirstNonEmptyEnv\(\[['"]UPSTASH_REDIS_REST_URL['"],\s*['"]KV_REST_API_URL['"]\]\)/.test(
    rateLimiterSource
  ) &&
  /resolveFirstNonEmptyEnv\(\[\s*['"]UPSTASH_REDIS_REST_TOKEN['"],\s*['"]KV_REST_API_TOKEN['"],?\s*\]\)/.test(
    rateLimiterSource
  ) &&
  /const redisEnvGroups =/.test(verifyEnvSource) &&
  /KV_REST_API_URL/.test(verifyEnvSource) &&
  /KV_REST_API_TOKEN/.test(verifyEnvSource) &&
  /hasCompleteEnvGroup\(env,\s*redisEnvGroups\)/.test(verifyEnvSource)
// 정책(2026-07 전수감사 Phase 3): Upstash 미설정/장애 시 쓰기(POST 등)는 503
// fail-closed를 유지하되, 읽기(GET/HEAD)만 degradeByMethod가 fail-open+high
// 보안 로그로 완화한다. 쓰기 fail-closed 경로(rateLimitUnavailable 503)와
// 등급 분기 존재를 함께 검증한다.
const productionRateLimiterFailsClosed =
  /private isProduction\(\): boolean/.test(rateLimiterSource) &&
  /private rateLimitUnavailable\(windowMs: number,\s*maxRequests: number\): RateLimitResult/.test(
    rateLimiterSource
  ) &&
  /Rate limiting is not configured for production/.test(rateLimiterSource) &&
  /status:\s*503/.test(rateLimiterSource) &&
  /this\.isProduction\(\) && \(this\.fallbackToMemory \|\| !this\.redis\)/.test(
    rateLimiterSource
  ) &&
  /private degradeByMethod\(/.test(rateLimiterSource) &&
  /method === ['"]GET['"] \|\| method === ['"]HEAD['"]/.test(rateLimiterSource) &&
  /RATE_LIMIT_DEGRADED_FAIL_OPEN/.test(rateLimiterSource) &&
  /return this\.rateLimitUnavailable\(windowMs,\s*maxRequests\)/.test(rateLimiterSource) &&
  /if \(this\.isProduction\(\)\) \{\s*return this\.degradeByMethod\(req,\s*windowMs,\s*maxRequests,\s*['"]redis_error['"]\)\s*\}/.test(
    rateLimiterSource
  )
// 아래 세 검사는 **주석 문구 자체**가 계약이다(운영에서 503 fail-closed임을
// 코드 옆에 설명해 두는 것). 주석을 걷어낸 판본에는 검사할 문구가 남지 않으므로
// 이 검사에 한해 원본을 읽는다 — 로직 검사는 계속 stripped 판본을 쓴다.
const rateLimiterCompatDocSource = readRawSourceAt(rateLimiterCompatPath)
const rateLimitWrapperDocSource = readRawSourceAt(rateLimitWrapperPath)
const rateLimiterDocSource = readRawSourceAt(rateLimiterPath)
const productionRateLimiterDocsFailClosed =
  /운영 환경에서는 rate limit 보호가 무효화되지 않도록 503으로 fail-closed 처리합니다/.test(
    rateLimiterCompatDocSource
  ) &&
  /운영 환경에서는 rate limit 보호가 무효화되지 않도록 503으로 fail-closed 처리한다/.test(
    rateLimitWrapperDocSource
  ) &&
  /쓰기·업로드는 남용 방지를 위해 기존대로 503\s*\n\s*\/\/ \(fail-closed\)을 유지한다/.test(
    rateLimiterDocSource
  ) &&
  /503으로 fail-closed 처리한다/.test(readmeSource) &&
  /개발 환경에서만 인메모리 폴백을 허용한다/.test(readmeSource) &&
  !/Upstash 없으면 메모리 폴백/.test(readmeSource)
// docs/deployment-guide.md 는 미추적 파일이라 CI에는 없을 수 있다. 있을 때만 문구를
// 검증하고, 없으면 이 조건은 통과 취급(스킵)한다 — 아래 SKIPPED 로그가 그 사실을 밝힌다.
const productionRateLimiterDeploymentGuideDocsFailClosed =
  !deploymentGuideAvailable ||
  (/rate-limited API 가 503 으로 fail-closed 됩니다/.test(deploymentGuideSource) &&
    !/미설정 시 메모리 기반 폴백으로 동작/.test(deploymentGuideSource))
const legacyRateLimitWrappersDelegateToServerFacade =
  /from\s+['"]@\/lib\/server\/rateLimit['"]/.test(rateLimiterCompatSource) &&
  /from\s+['"]@\/lib\/server\/rateLimit['"]/.test(rateLimitWrapperSource) &&
  !/from\s+['"]\.\/distributedRateLimiter['"]/.test(rateLimiterCompatSource) &&
  !/from\s+['"]\.\/distributedRateLimiter['"]/.test(rateLimitWrapperSource) &&
  !/distributedRateLimiter\.applyRateLimit/.test(rateLimitWrapperSource) &&
  !/distributedRateLimiterConfig\.applyRateLimit/.test(rateLimiterCompatSource)
const linkPreviewPath = join(root, 'src/utils/linkPreview.ts')
const linkPreviewSource = readSourceAt(linkPreviewPath)
const ssrfProtectionPath = join(root, 'src/utils/ssrfProtection.ts')
const ssrfProtectionSource = readSourceAt(ssrfProtectionPath)
const preventsLinkPreviewPreflightRedirects =
  /method:\s*['"]HEAD['"][\s\S]*?redirect:\s*['"]manual['"]/.test(linkPreviewSource) &&
  /new URL\(location,\s*u\)/.test(linkPreviewSource) &&
  /Redirect not followed/.test(linkPreviewSource)
const linkPreviewUsesSharedSsrfProtection =
  /from\s+['"]@\/utils\/ssrfProtection['"]/.test(linkPreviewSource) &&
  !/from\s+['"]dns\/promises['"]/.test(linkPreviewSource) &&
  !/function\s+isPrivateIPv4/.test(linkPreviewSource) &&
  !/async\s+function\s+isUnsafeHost/.test(linkPreviewSource)
const parsesLinkPreviewContentLengthSafely =
  /parseIntegerParam/.test(linkPreviewSource) &&
  /parseIntegerParam\(headRes\.headers\.get\(['"]content-length['"]\),\s*0,\s*\{\s*min:\s*0\s*\}\)/.test(
    linkPreviewSource
  ) &&
  /parseIntegerParam\(len,\s*0,\s*\{\s*min:\s*0\s*\}\)/.test(linkPreviewSource) &&
  !/parseInt\(headRes[\s\S]*content-length/.test(linkPreviewSource) &&
  !/parseInt\(len,\s*10\)/.test(linkPreviewSource)
const avoidsLinkPreviewOperationalConsoleLogs =
  /createLogger\(['"]linkPreview['"]\)/.test(linkPreviewSource) &&
  /function describeUrlForLog/.test(linkPreviewSource) &&
  /log\.debug\(['"]Successfully extracted preview['"]/.test(linkPreviewSource) &&
  /log\.debug\(['"]No image found for preview['"]/.test(linkPreviewSource) &&
  !/console\.log\(/.test(linkPreviewSource) &&
  !/console\.warn\(['"]⚠️ \[LinkPreview\] No image found/.test(linkPreviewSource) &&
  !/for: \$\{url\}/.test(linkPreviewSource) &&
  !/for \$\{url\}/.test(linkPreviewSource) &&
  !/preview for \$\{url\}/.test(linkPreviewSource) &&
  !/Invalid redirect URL: \$\{location\}/.test(linkPreviewSource) &&
  !/SSRF safety: \$\{location\}/.test(linkPreviewSource) &&
  !/Available meta tags:[\s\S]*?console\.log/.test(linkPreviewSource)
const ssrfProtectionHandlesLiteralIpsStrictly =
  /import\s+net\s+from\s+['"]net['"]/.test(ssrfProtectionSource) &&
  /normalizeHostname/.test(ssrfProtectionSource) &&
  /net\.isIP\(normalized\)/.test(ssrfProtectionSource) &&
  /a === 0/.test(ssrfProtectionSource) &&
  /a >= 224/.test(ssrfProtectionSource)
const validationPath = join(root, 'src/utils/validation.ts')
const validationSource = readSourceAt(validationPath)
// 예전에는 다음 JSDoc(`\n}\n\n/**`)까지를 잘라 썼는데, 그 종결자는 **주석**이라
// 주석을 걷어낸 판본에서는 매치 자체가 실패했다(그러면 빈 문자열이 되어 아래
// 부정 단정이 공허하게 통과한다). 함수 닫는 중괄호까지만 자른다 — `\b`가
// `validateUUIDOrTempId`를 걸러낸다.
const validateUUIDSource =
  validationSource.match(/export const validateUUID\b[\s\S]*?\n\}\n/)?.[0] ?? ''
// 2026-09-02: `validateUUIDOrTempId`가 존재해야 한다는 조건을 뒤집었다 —
// 임시 ID 경로를 통째로 걷어냈으므로 이제 그 함수가 **없어야** 한다.
const validateUUIDRejectsTempIds =
  !/validateUUIDOrTempId/.test(validationSource) &&
  !/isValidTempId/.test(validateUUIDSource) &&
  /잘못된 \$\{paramName\} 형식입니다\. UUID 형식이어야 합니다\./.test(validateUUIDSource)

const postAttachmentsPath = join(root, 'src/app/api/posts/[id]/attachments/route.ts')
const postAttachmentsSource = readSourceAt(postAttachmentsPath)
const verifiesAttachmentSignature =
  /hasValidFileSignature/.test(postAttachmentsSource) &&
  /Buffer\.from\(await file\.arrayBuffer\(\)\)/.test(postAttachmentsSource)
// 2026-09-02: 뒤집었다. 예전에는 이 라우트가 `validateUUIDOrTempId`를 쓰기를
// **요구**했는데, 임시 첨부는 애초에 만들어질 수 없었다 — POST가 같은 파일에서
// `validateUUID`로 temp-{UUID}를 400 거부했고, 프론트도 글을 먼저 만들고 진짜
// id로 올린다. 운영 DB에도 is_temporary 행이 0건이었다. 관대한 검증만 남아
// "여기로 temp가 들어온다"는 거짓 인상을 주고 있었으므로 임시 경로를 전부
// 걷어냈고, 이 가드는 그것이 되살아나지 않는지를 본다.
const rejectsTempIdsOnPostAttachments =
  !/validateUUIDOrTempId/.test(postAttachmentsSource) &&
  !/isValidTempId/.test(postAttachmentsSource) &&
  !/is_temporary/.test(postAttachmentsSource)
const boardDocumentsPath = join(root, 'src/app/api/board-room/documents/route.ts')
const boardDocumentsSource = readSourceAt(boardDocumentsPath)
const boardDocumentDetailPath = join(root, 'src/app/api/board-room/documents/[id]/route.ts')
const boardDocumentDetailSource = readSourceAt(boardDocumentDetailPath)
const boardDocumentDownloadPath = join(
  root,
  'src/app/api/board-room/documents/[id]/download/route.ts'
)
const boardDocumentDownloadSource = existsSync(boardDocumentDownloadPath)
  ? readSourceAt(boardDocumentDownloadPath)
  : ''
// 봉쇄 판정의 실제 구현부. 예전 `@/utils/boardDocumentStoragePath`
// (`isSafeBoardDocumentStoragePath`)는 소유권을 경로 문자열과 결합해 시드
// 문서 14건을 막던 deprecated 래퍼였고, 참조가 0건으로 확인돼 파일 자체를
// 지웠다 — 이 검사식은 처음부터 그 파일을 참조하지 않았다.
const boardDocumentsLibPath = join(root, 'src/lib/storage/boardDocuments.ts')
const boardDocumentsLibSource = existsSync(boardDocumentsLibPath)
  ? readSourceAt(boardDocumentsLibPath)
  : ''
// 이 파일은 JSDoc이 유난히 많고, 그 JSDoc이 옛 함수 이름(`isSafeBoardDocumentStoragePath`)이나
// 설계 배경을 산문으로 설명한다. 아래 (1) 검사가 raw 소스를 그대로 보면, 실제
// 봉쇄 로직(세그먼트 수·이탈 벡터 검사)을 `//`로 주석 처리해도 그 옆 JSDoc이나
// 다른 줄에 우연히 같은 리터럴이 남아 있을 때 죽은 채로 통과할 수 있다 —
// 라우트 쪽 (2)~(4)를 고칠 때 이미 겪은 것과 같은 함정이다. 이 파일은 스스로
// "로컬 import가 하나도 없어야 한다"고 선언하므로 `stripCommentsAndImports`의
// import 제거 부분은 실질적으로 no-op이지만, 헬퍼를 통일해서 쓴다.
const boardDocumentsLibCode = stripCommentsAndImports(boardDocumentsLibSource)
const verifiesBoardDocumentSignature =
  /hasKnownFileSignature/.test(boardDocumentsSource) &&
  /hasValidFileSignature/.test(boardDocumentsSource) &&
  /hasBinaryNullBytes/.test(boardDocumentsSource)
// 이사회 문서는 조합 DB 덤프(`backups/`)와 같은 비공개 저장소에 살기 때문에
// 경로가 새면 회원 명부까지 노출된다. 다만 봉쇄와 소유권은 별개의 관심사다.
//
// 예전 판정은 `file_path`가 `uploaded_by`로 시작할 것을 요구했는데, 시드 문서
// 14건은 `uploaded_by = NULL`이라 전부 막혀 다운로드가 두 달간 죽었다. 그래서
// 소유권은 DB 컬럼(`doc.uploaded_by`)으로, 봉쇄는 경로 문자열로 나눠 검사한다.
// 이 검사식은 그 분리를 고정한다 — 봉쇄가 느슨해지거나 소유권 검사가 사라지면
// 둘 다 실패해야 한다.
//
// 목록 API는 더 이상 서명 URL을 만들지 않는다 — 발급된 서명 URL은 만료 전까지
// 권한을 잃은 사람에게도 유효했다. 대신 만료 없는 내부 프록시 경로만 내려주고,
// 그 다운로드 라우트가 매 요청마다 `requireBoardMember()`로 권한을 다시 검사한다.
// 목록 응답이 `file_path`를 그대로 흘리는 회귀도 이 검사식이 고정한다 — 저장소
// 경로가 클라이언트로 새 나가면 봉쇄를 우회할 필요도 없이 저장소 레이아웃이
// 그대로 노출된다.
//
// 아래 (2)~(4)는 원본이 아니라 `stripCommentsAndImports`를 거친 코드를 본다.
// import 문·JSDoc 주석에 같은 식별자가 먼저 등장해 순서 검사를 무력화하거나
// (예: import 줄이 항상 실제 호출보다 앞이라 "인증이 조회보다 먼저"가 무조건
// 참이 됨), 주석 처리로 지운 실제 로직의 텍스트가 원본 소스에는 그대로 남아
// 있어 존재 검사를 속이는(예: 인가 조건문을 `//`로 지워도 문자열은 남는다)
// 두 실패 모드를 막기 위해서다.
const boardDocumentsCode = stripCommentsAndImports(boardDocumentsSource)
const boardDocumentDetailCode = stripCommentsAndImports(boardDocumentDetailSource)
const boardDocumentDownloadCode = stripCommentsAndImports(boardDocumentDownloadSource)
const boardDocumentDownloadAuthIndex = boardDocumentDownloadCode.indexOf('requireBoardMember()')
// Task 4: board_documents 권위가 Turso로 옮겨지며 이 라우트의 조회가
// Supabase `.from('board_documents')`에서 쿼리 계층 호출
// `getDocumentForDownload(id)`(src/db/queries/board.ts)로 바뀌었다. 이
// 라우트에는 Supabase 호출이 한 줄도 남지 않았으므로 옛 패턴 분기는 죽은
// 코드였다 — 새 호출만 본다(리뷰 1회차 Important 1).
const boardDocumentDownloadQueryIndex = boardDocumentDownloadCode.indexOf('getDocumentForDownload(')
const boardDocumentDownloadChecksAuthBeforeQuery =
  boardDocumentDownloadAuthIndex !== -1 &&
  boardDocumentDownloadQueryIndex !== -1 &&
  boardDocumentDownloadAuthIndex < boardDocumentDownloadQueryIndex
const boardDocumentDownloadSafetyIndex = boardDocumentDownloadCode.indexOf(
  'isSafeBoardDocumentFilePath(doc.file_path)'
)
const boardDocumentDownloadStreamIndex = boardDocumentDownloadCode.indexOf(
  'getBoardDocumentStream(doc.file_path'
)
const boardDocumentDownloadChecksPathBeforeStream =
  boardDocumentDownloadSafetyIndex !== -1 &&
  boardDocumentDownloadStreamIndex !== -1 &&
  boardDocumentDownloadSafetyIndex < boardDocumentDownloadStreamIndex
const validatesBoardDocumentStoragePaths =
  // (1) 봉쇄: `<owner>/<filename>` 두 세그먼트만 허용하고 이탈 벡터를 모두 막는다.
  /export function isSafeBoardDocumentFilePath/.test(boardDocumentsLibCode) &&
  /segments\.length !== 2/.test(boardDocumentsLibCode) &&
  /filePath\.includes\('\\\\'\)/.test(boardDocumentsLibCode) &&
  /filePath\.startsWith\('\/'\)/.test(boardDocumentsLibCode) &&
  /decodeURIComponent\(filePath\)/.test(boardDocumentsLibCode) &&
  /decoded !== filePath/.test(boardDocumentsLibCode) &&
  /segment === '\.' \|\| segment === '\.\.'/.test(boardDocumentsLibCode) &&
  // (2) 목록 라우트: 응답에 file_path를 내려주지 않고, 만료 없는 내부 프록시
  //     경로만 돌려준다. 예전의 300초 서명 URL이 되살아나면 실패해야 한다.
  /const \{ file_path, \.\.\.rest \} = doc/.test(boardDocumentsCode) &&
  /download_url:\s*`\/api\/board-room\/documents\/\$\{doc\.id\}\/download`/.test(
    boardDocumentsCode
  ) &&
  !/signedUrl/.test(boardDocumentsCode) &&
  // (3) 다운로드 라우트: 권한 검사가 DB 조회보다 먼저고, DB에서 온 file_path를
  //     봉쇄 판정에 다시 통과시킨 뒤에만 스트리밍한다.
  boardDocumentDownloadChecksAuthBeforeQuery &&
  boardDocumentDownloadChecksPathBeforeStream &&
  // (4) 삭제 라우트: 소유권은 DB 컬럼으로 검사하고(관리자만 예외), 봉쇄는
  //     `isSafeBoardDocumentFilePath`로, 실제 삭제는 제공자 계층
  //     `deleteBoardDocument`로만 한다(단계 4 Task 5에서 교차 제공자
  //     `deleteBoardDocumentEverywhere`가 사라졌다). Supabase Storage의
  //     `.remove([...])` 직접 호출이 되살아나면 실패해야 한다.
  /doc\.uploaded_by !== user\.id && !isAdmin/.test(boardDocumentDetailCode) &&
  /isSafeBoardDocumentFilePath\(doc\.file_path\)/.test(boardDocumentDetailCode) &&
  /deleteBoardDocument\(doc\.file_path\)/.test(boardDocumentDetailCode) &&
  !/\.remove\(\[/.test(boardDocumentDetailCode)

// 비공개 저장소의 제공자 분기 계층. 아직 라우트에 연결되지 않았지만(전환 단계용
// 선행 코드) 연결 시점에 드러날 두 결함을 미리 고정한다.
//
// privateProvider.ts는 `./blob` 같은 확장자 없는 로컬 import를 쓰므로 node --test의
// 타입 스트리핑으로 로드할 수 없다. 그래서 단위 테스트 대신 여기서 정적으로 본다.
const privateProviderPath = join(root, 'src/lib/storage/privateProvider.ts')
const privateProviderSource = existsSync(privateProviderPath)
  ? readSourceAt(privateProviderPath)
  : ''
const blobLibSource = readSourceAt(join(root, 'src/lib/storage/blob.ts'))
// (2)~(4)와 같은 이유로 원본이 아니라 stripCommentsAndImports를 거친 코드를
// 본다. 원본 소스를 그대로 훑으면, 실제 로직을 `//`로 주석 처리해도 같은 줄
// (또는 주변 JSDoc)에 남은 텍스트가 정규식에 그대로 걸려 죽은 채로 통과한다 —
// `privateProvider.ts`의 `if (!hasPrivateBlobStore()) return null`을 주석
// 처리해도 이전에는 게이트가 초록불이었다(리뷰 실측).
const blobLibCode = stripCommentsAndImports(blobLibSource)
const privateProviderCode = stripCommentsAndImports(privateProviderSource)
// 토큰 존재 검사는 파일 전체가 아니라 함수 본문만 본다. 파일 전체를 보면
// `PUBLIC_BLOB_READ_WRITE_TOKEN`이 `tokenFor()` 등 다른 함수에도 등장해서,
// `hasPublicBlobStore`의 본문을 주석 처리해 항상 `return`이 비어도(undefined,
// falsy) 그 리터럴이 파일 어딘가에 남아 있으면 검사가 속는다.
const hasPublicBlobStoreBody =
  blobLibCode.match(/export function hasPublicBlobStore\(\):\s*boolean\s*\{[\s\S]*?\n\}/)?.[0] ?? ''
// 단계 4 Task 5: 이사회 서류의 저장소는 비공개 Blob 하나뿐이다. Supabase
// Storage 교차 폴백(`hasSupabaseServiceRole()` 게이트 + `fromSupabase`)이
// 통째로 사라졌으므로, 가드도 "폴백이 안전한가"에서 "폴백이 되살아나지
// 않았는가 + 세 경로 전부 봉쇄 판정을 거치는가"로 바꾼다.
//
// 봉쇄가 이 가드의 핵심이다: 같은 비공개 저장소에 조합 DB 전체 덤프가
// `backups/` 접두어로 들어 있어서, 경로 조립이 `blobPathForBoardDocument`를
// 건너뛰는 순간 회원 명부가 통째로 노출된다.
const boardDocumentPrivateStorageIsBlobOnly =
  // (1) 설정 판정 함수는 env 이름을 소유한 모듈에, 그 이름을 실제로 참조하는
  //     본문과 함께 있어야 한다(이름 드리프트 방지 + 본문 무력화 방지).
  /export function hasPublicBlobStore/.test(blobLibCode) &&
  /PUBLIC_BLOB_READ_WRITE_TOKEN/.test(hasPublicBlobStoreBody) &&
  /PRIVATE_BLOB_READ_WRITE_TOKEN/.test(blobLibCode) &&
  // (2) 쓰기·삭제·읽기 세 경로 전부 봉쇄 판정을 거친 경로만 쓴다.
  /putObject\(\s*'private',\s*blobPathForBoardDocument\(filePath\)/.test(privateProviderCode) &&
  /deleteObject\(\s*'private',\s*blobPathForBoardDocument\(filePath\)\)/.test(
    privateProviderCode
  ) &&
  /getPrivateObject\(blobPathForBoardDocument\(filePath\),\s*ifNoneMatch\)/.test(
    privateProviderCode
  ) &&
  // (3) 업로드는 덮어쓰지 않는다(경로에 타임스탬프가 들어가므로 충돌은 사고다).
  /putObject\([\s\S]{0,120}?,\s*false\)/.test(privateProviderCode) &&
  // (4) Supabase 폴백·클라이언트가 되살아나면 실패한다.
  !/[Ss]upabase/.test(privateProviderCode) &&
  !/classifyDeleteEverywhereResults/.test(privateProviderCode)
const artistPhotoPath = join(root, 'src/app/api/mypage/artist/photo/route.ts')
const artistPhotoSource = readSourceAt(artistPhotoPath)
const verifiesArtistPhotoSignature =
  /hasValidFileSignature/.test(artistPhotoSource) && /file instanceof File/.test(artistPhotoSource)
// 삭제 대상 경로는 반드시 봉쇄를 통과한 값이어야 한다. 검사 없이 URL을 파싱해
// 지우면 남의 아티스트 사진이나 버킷 밖 객체를 지울 수 있다.
//
// 판정 함수는 getProjectStorageObjectPath(Supabase 전용)에서
// logicalPathFromUrl(Blob·Supabase 양쪽)로 옮겨졌다. 스토리지 제공자를 blob으로
// 전환하면서 Supabase URL만 이해하던 옛 함수로는 Blob URL이 전부 null이 되어
// 정리가 조용히 건너뛰어졌기 때문이다. 봉쇄 의미(버킷 + 접두사 일치, 아니면 null)는
// 동일하다 — @/lib/storage/paths 참고.
const validatesArtistPhotoCleanupStoragePaths =
  /collectSafeArtistVariantPaths/.test(artistPhotoSource) &&
  /isProjectStorageObjectPath\(value,\s*artistId\)/.test(artistPhotoSource) &&
  /logicalPathFromUrl/.test(artistPhotoSource) &&
  /logicalPathFromUrl\(\s*currentArtist\.profile_photo_url,\s*['"]artists['"],\s*profile\.artist_id\s*\)/.test(
    artistPhotoSource
  ) &&
  /logicalPathFromUrl\(\s*artist\.profile_photo_url,\s*['"]artists['"],\s*profile\.artist_id\s*\)/.test(
    artistPhotoSource
  ) &&
  // 봉쇄에 걸린 URL은 지우지 않고 넘어간다(조용히 raw 값으로 지우면 안 된다).
  /Unsafe previous artist photo URL skipped for cleanup/.test(artistPhotoSource) &&
  /Unsafe artist photo URL skipped for cleanup/.test(artistPhotoSource) &&
  !/const\s+url\s*=\s*new URL\(currentArtist\.profile_photo_url\)/.test(artistPhotoSource) &&
  !/const\s+url\s*=\s*new URL\(artist\.profile_photo_url\)/.test(artistPhotoSource)
const artistProfilePath = join(root, 'src/app/api/mypage/artist/route.ts')
const artistProfileSource = readSourceAt(artistProfilePath)
const jsonSyncPath = join(root, 'src/utils/jsonSync.ts')
const jsonSyncSource = existsSync(jsonSyncPath) ? readSourceAt(jsonSyncPath) : ''
const validatesArtistProfilePhotoStorageUrl =
  // isProjectStoragePublicUrl(Supabase 전용) → logicalPathFromUrl(...) === null 비교로
  // 이관. Blob URL도 같은 봉쇄를 받게 하려는 변경이다.
  /logicalPathFromUrl\(updateData\.profile_photo_url,\s*['"]artists['"],\s*profile\.artist_id\)\s*===\s*null/.test(
    artistProfileSource
  ) &&
  /logicalPathFromUrl\(variantUrl,\s*['"]artists['"],\s*profile\.artist_id\)\s*===\s*null/.test(
    artistProfileSource
  ) &&
  /isProjectStorageObjectPath/.test(artistProfileSource) &&
  /profile_photo_url/.test(artistProfileSource) &&
  /전용 업로드로 등록된 Storage URL/.test(artistProfileSource) &&
  /variants:\s*z/.test(artistProfileSource) &&
  /variant_urls:\s*z/.test(artistProfileSource) &&
  /variant_metadata:\s*z/.test(artistProfileSource) &&
  /프로필 사진 메타데이터의 Storage 경로가 올바르지 않습니다/.test(artistProfileSource) &&
  /프로필 사진 메타데이터의 공개 URL이 올바르지 않습니다/.test(artistProfileSource)
const preventsArtistProfileServerGitSideEffects =
  !/jsonSync/.test(artistProfileSource) &&
  !/updateArtistInJsonFile/.test(artistProfileSource) &&
  !/commitAndPushJsonChanges/.test(artistProfileSource) &&
  !/setImmediate\s*\(/.test(artistProfileSource) &&
  !existsSync(jsonSyncPath) &&
  !/child_process/.test(jsonSyncSource) &&
  !/git (?:add|commit|push)/.test(jsonSyncSource) &&
  !/commitAndPushJsonChanges/.test(jsonSyncSource)
const postOgImagePath = join(root, 'src/app/api/og/post/[id]/route.tsx')
const postOgImageSource = readSourceAt(postOgImagePath)
const postUserDataApiPath = join(root, 'src/app/api/posts/[id]/user-data/route.ts')
const postUserDataApiSource = readSourceAt(postUserDataApiPath)
// 2026-09-01: Supabase 프로젝트 삭제로 isProjectStoragePublicUrl(Supabase 전용)이
// 사라졌다. 봉쇄는 logicalPathFromUrl(우리 Blob origin + `attachments` 버킷 +
// `posts` 접두사)로 이관됐다 — 버킷·접두사까지 보므로 경계는 그대로다.
const validatesPostOgAttachmentStorageUrl =
  /logicalPathFromUrl/.test(postOgImageSource) &&
  // 단계 4 Task 6b: 첨부 조회가 목록(attachments[0])에서 단건
  // (getPrimaryImageAttachment → attachment)으로 바뀌었다. 지키려는 것은
  // 그대로다 — 리다이렉트 URL이 첨부 행에서 오고 아래 검증을 거친다는 것.
  /const imageUrl = attachment\.file_url/.test(postOgImageSource) &&
  /logicalPathFromUrl\(imageUrl,\s*['"]attachments['"],\s*['"]posts['"]\)\s*===\s*null/.test(
    postOgImageSource
  ) &&
  /unsafe attachment image URL/i.test(postOgImageSource)
const artistOgImagePath = join(root, 'src/app/api/og/artist/[slug]/route.tsx')
const artistOgImageSource = readSourceAt(artistOgImagePath)
const projectOgImagePath = join(root, 'src/app/api/og/project/[slug]/route.tsx')
const projectOgImageSource = readSourceAt(projectOgImagePath)
const legacyOgImagePath = join(root, 'src/app/api/og-image/route.ts')
const legacyOgImageSource = readSourceAt(legacyOgImagePath)
const imagesApiPath = join(root, 'src/app/api/images/route.ts')
const imagesApiSource = readSourceAt(imagesApiPath)
const validatesStaticOgImageRedirects =
  /toSafeArtistImageSrc/.test(artistOgImageSource) &&
  /toSafeArtistImageSrc\(artist\?\.profileImage/.test(artistOgImageSource) &&
  /toSafeInternalImagePath/.test(projectOgImageSource) &&
  /toSafeInternalImagePath\(project\.coverImage/.test(projectOgImageSource) &&
  /toSafeInternalImagePath\(project\.gallery\[0\]/.test(projectOgImageSource) &&
  /Location:\s*safeTarget/.test(artistOgImageSource) &&
  /Location:\s*safeTarget/.test(projectOgImageSource) &&
  !/Location:\s*target/.test(artistOgImageSource) &&
  !/Location:\s*target/.test(projectOgImageSource) &&
  /toSafeInternalImagePath/.test(legacyOgImageSource) &&
  /let imagePath = toSafeInternalImagePath\(artist\.profileImage\)/.test(legacyOgImageSource) &&
  !/let imagePath = artist\.profileImage/.test(legacyOgImageSource)
const validatesImagesApiPublicPathBoundary =
  /function resolvePublicImagePath/.test(imagesApiSource) &&
  /path\.relative\(publicPath,\s*resolved\)/.test(imagesApiSource) &&
  /relativePath\.startsWith\(['"]\.\.['"]\)/.test(imagesApiSource) &&
  /path\.isAbsolute\(relativePath\)/.test(imagesApiSource) &&
  /const imageMimeTypes/.test(imagesApiSource) &&
  /const contentType = imageMimeTypes\[ext\]/.test(imagesApiSource) &&
  /!contentType/.test(imagesApiSource) &&
  /resolvePublicImagePath\(imagePath\)/.test(imagesApiSource) &&
  !/resolved(?:Head)?\.startsWith\(publicPath\)/.test(imagesApiSource) &&
  !/application\/octet-stream/.test(imagesApiSource)
const commentDeletePath = join(root, 'src/app/api/posts/[id]/comments/[commentId]/route.ts')
const commentDeleteSource = readSourceAt(commentDeletePath)
// 단계 2c(Task 6): 소유권 조회·삭제 둘 다 Supabase `.eq('id',
// validCommentId).eq('post_id', validPostId)`에서 Turso 쿼리 계층
// getCommentById(validCommentId, validPostId)/deleteComment(validCommentId,
// validPostId)로 옮겼다 — 둘 다 두 인자로 이중 스코프를 강제한다.
const scopesCommentDeleteToPost =
  /getCommentById\(validCommentId,\s*validPostId\)/.test(commentDeleteSource) &&
  /deleteComment\(validCommentId,\s*validPostId\)/.test(commentDeleteSource)
const postAttachmentDetailPath = join(
  root,
  'src/app/api/posts/[id]/attachments/[attachmentId]/route.ts'
)
const postAttachmentDetailSource = readSourceAt(postAttachmentDetailPath)
const postAttachmentsDisplayPath = join(root, 'src/components/PostAttachmentsDisplay.tsx')
const postAttachmentsDisplaySource = readSourceAt(postAttachmentsDisplayPath)
const attachmentCardPath = join(root, 'src/components/attachments/AttachmentCard.tsx')
const attachmentCardSource = readSourceAt(attachmentCardPath)
const imageModalPath = join(root, 'src/components/attachments/ImageModal.tsx')
const imageModalSource = readSourceAt(imageModalPath)
const attachmentActionsPath = join(root, 'src/hooks/useAttachmentActions.ts')
const attachmentActionsSource = readSourceAt(attachmentActionsPath)
// 단계 2c(Task 5): PUT의 갱신을 Supabase
// `.update(updateData).eq('id', attachmentId).eq('post_id', postId)`에서
// Turso 쿼리 계층 updateAttachment(attachmentId, postId, patch)로, DELETE의
// 삭제를 Supabase `.from('post_attachments').delete().eq('id',
// attachmentId).eq('post_id', postId)`에서 removeAttachment(attachmentId,
// postId)로 옮겼다 — 둘 다 인자 순서(attachmentId, postId)로 같은 스코프를
// 강제한다.
const validatesAttachmentMetadataUpdate =
  /validateUUID\(params\.id,\s*['"]게시글 ID['"]\)/.test(postAttachmentDetailSource) &&
  /validateUUID\(params\.attachmentId,\s*['"]첨부파일 ID['"]\)/.test(postAttachmentDetailSource) &&
  /MAX_ALT_TEXT_LENGTH/.test(postAttachmentDetailSource) &&
  /typeof alt_text !== ['"]string['"]/.test(postAttachmentDetailSource) &&
  /typeof is_primary !== ['"]boolean['"]/.test(postAttachmentDetailSource) &&
  /Number\.isInteger\(sort_order\)/.test(postAttachmentDetailSource) &&
  /updateAttachment\(attachmentId,\s*postId,\s*patch\)/.test(postAttachmentDetailSource) &&
  /removeAttachment\(attachmentId,\s*postId\)/.test(postAttachmentDetailSource)
// 단계 2c(Task 5): DELETE의 관리자 판정을 Supabase
// `.select('is_admin, registration_status, is_active').eq('id', user.id)`
// 에서 Turso 쿼리 계층 getProfileById(user.id)로 옮겼다. 조건식
// (profile?.is_admin === true && ... === 'approved' && ... === true)
// 리터럴은 그대로다.
const validatesAttachmentDeleteAdminStatus =
  /getProfileById\(user\.id\)/.test(postAttachmentDetailSource) &&
  /profile\?\.is_admin === true[\s\S]*?profile\.registration_status === ['"]approved['"][\s\S]*?profile\.is_active === true/.test(
    postAttachmentDetailSource
  )
// 첨부 삭제도 같은 이관을 거쳤다(getProjectStorageObjectPath → logicalPathFromUrl,
// supabase .remove() → deletePublicObject). 봉쇄 대상은 그대로 `attachments`
// 버킷의 `posts/<postId>` 하위다.
const validatesAttachmentDeleteStoragePath =
  /logicalPathFromUrl/.test(postAttachmentDetailSource) &&
  /logicalPathFromUrl\(\s*attachment\.file_url,\s*['"]attachments['"],\s*`posts\/\$\{postId\}`\s*\)/.test(
    postAttachmentDetailSource
  ) &&
  /deletePublicObject\(logical\)/.test(postAttachmentDetailSource) &&
  // 봉쇄에 걸리면 지우지 않고 건너뛴다.
  /안전하지 않은 첨부파일 Storage URL 삭제 건너뜀/.test(postAttachmentDetailSource) &&
  !/attachment\.file_url\.split\(['"]\/['"]\)/.test(postAttachmentDetailSource)
// 첨부 렌더·다운로드 게이트도 같은 이관을 거쳤다(isProjectStoragePublicUrl →
// logicalPathFromUrl(..., 'attachments') !== null). 옛 판정은 Supabase origin만
// 봤고 Blob URL은 origin만 보는 isBlobPublicUrl이 통과시켰는데, 이관 후에는
// 버킷까지 확인한다.
const validatesPostAttachmentRenderUrls =
  /logicalPathFromUrl\(url,\s*['"]attachments['"]\)\s*!==\s*null/.test(
    postAttachmentsDisplaySource
  ) &&
  /isSafeAttachmentUrl/.test(postAttachmentsDisplaySource) &&
  /safeImages/.test(postAttachmentsDisplaySource) &&
  /safeOtherFiles/.test(postAttachmentsDisplaySource) &&
  !/src=\{image\.file_url\}/.test(postAttachmentsDisplaySource) &&
  !/href=\{file\.file_url\}/.test(postAttachmentsDisplaySource) &&
  !/src=\{selectedImage\.file_url\}/.test(postAttachmentsDisplaySource) &&
  /logicalPathFromUrl\(attachment\.file_url,\s*['"]attachments['"]\)\s*!==\s*null/.test(
    attachmentCardSource
  ) &&
  /safeFileUrl/.test(attachmentCardSource) &&
  !/src=\{attachment\.file_url\}/.test(attachmentCardSource) &&
  /logicalPathFromUrl\(attachment\.file_url,\s*['"]attachments['"]\)\s*!==\s*null/.test(
    imageModalSource
  ) &&
  /safeFileUrl/.test(imageModalSource) &&
  !/src=\{attachment\.file_url\}/.test(imageModalSource) &&
  /logicalPathFromUrl\(attachment\.file_url,\s*['"]attachments['"]\)\s*!==\s*null/.test(
    attachmentActionsSource
  ) &&
  /safeFileUrl/.test(attachmentActionsSource) &&
  !/link\.href\s*=\s*attachment\.file_url/.test(attachmentActionsSource)
const adminPostDetailPath = join(root, 'src/app/api/admin/posts/[id]/route.ts')
const adminPostDetailSource = readSourceAt(adminPostDetailPath)
// Task 8: 이 라우트의 posts 조회/갱신이 Supabase `.eq('id', postId)`에서
// Turso 쿼리 계층(getPostById(postId, ...)/updatePost(postId, ...))으로
// 옮겨갔다 — Drizzle의 eq()는 항상 파라미터 바인딩이라 안전성 성질은
// 그대로다(검증된 postId만 쿼리 인자로 들어간다). 패턴만 새 호출부에 맞게
// 갱신한다(가드를 넓히지 않는다 — validateUUID 다음에 그 결과값을 실제
// 쿼리 함수에 넘기는지 여전히 확인한다).
const validatesAdminPostRouteId =
  /validateUUID\(resolvedParams\.id,\s*['"]게시글 ID['"]\)/.test(adminPostDetailSource) &&
  /getPostById\(postId,/.test(adminPostDetailSource) &&
  /updatePost\(postId,/.test(adminPostDetailSource)
const adminPostActionUsesSharedApiRoute =
  /from\s+['"]@\/lib\/server\/apiRoute['"]/.test(adminPostDetailSource) &&
  /export const PATCH = defineApiRoute/.test(adminPostDetailSource) &&
  /auth:\s*['"]admin['"]/.test(adminPostDetailSource) &&
  /rateLimit:\s*\{\s*\.\.\.RATE_LIMITS\.ADMIN_API/.test(adminPostDetailSource) &&
  /createUserKeyGenerator\(['"]admin_posts_action['"]\)/.test(adminPostDetailSource) &&
  /rateLimitHeaders:\s*true/.test(adminPostDetailSource) &&
  /body:\s*\{[\s\S]*?invalidResponse/.test(adminPostDetailSource) &&
  !/parseJsonObjectBody/.test(adminPostDetailSource) &&
  !/applyRateLimit\(/.test(adminPostDetailSource) &&
  !/addRateLimitHeaders/.test(adminPostDetailSource) &&
  !/requireAdmin\(\)/.test(adminPostDetailSource)
const notificationDetailPath = join(root, 'src/app/api/notifications/[id]/route.ts')
const notificationDetailSource = readSourceAt(notificationDetailPath)
const notificationsPath = join(root, 'src/app/api/notifications/route.ts')
const notificationsSource = readSourceAt(notificationsPath)
const bulkNotificationsPath = join(root, 'src/app/api/notifications/bulk/route.ts')
const bulkNotificationsSource = readSourceAt(bulkNotificationsPath)
// 단계 2c(Task 7): markAllNotificationsRead가 src/lib/server/notificationsWrite.ts
// (Supabase 앱 계층 UPDATE)에서 src/db/queries/notifications.ts(Turso 쿼리
// 계층)로 옮겨갔다 — 소유권 필터 강제도 이 새 위치를 가리키도록 함께 옮긴다.
const notificationsWritePath = join(root, 'src/db/queries/notifications.ts')
const notificationsWriteSource = readSourceAt(notificationsWritePath)
const notificationDataPath = join(root, 'src/utils/notificationData.ts')
const notificationDataSource = readSourceAt(notificationDataPath)
const notificationExpiryPath = join(root, 'src/utils/notificationExpiry.ts')
const notificationExpirySource = readSourceAt(notificationExpiryPath)
const notificationTypesPath = join(root, 'src/utils/notificationTypes.ts')
const notificationTypesSource = readSourceAt(notificationTypesPath)
const eventApplicationStatusPath = join(root, 'src/utils/eventApplicationStatus.ts')
const eventApplicationStatusSource = readSourceAt(eventApplicationStatusPath)
const adminEventApplicationsApiPath = join(root, 'src/app/api/admin/event-applications/route.ts')
const adminEventApplicationsApiSource = readSourceAt(adminEventApplicationsApiPath)
const adminMemberActionApiPath = join(root, 'src/app/api/admin/member-action/route.ts')
const adminMemberActionApiSource = readSourceAt(adminMemberActionApiPath)
const adminMemberFlagsApiPath = join(root, 'src/app/api/admin/members/flags/route.ts')
const adminMemberFlagsApiSource = readSourceAt(adminMemberFlagsApiPath)
const adminMembersBulkApiPath = join(root, 'src/app/api/admin/members/bulk/route.ts')
const adminMembersBulkApiSource = readSourceAt(adminMembersBulkApiPath)
const adminArtistMembersApiPath = join(root, 'src/app/api/admin/artists/[id]/members/route.ts')
const adminArtistMembersApiSource = readSourceAt(adminArtistMembersApiPath)
const adminArtistMemberApiPath = join(
  root,
  'src/app/api/admin/artists/[id]/members/[memberId]/route.ts'
)
const adminArtistMemberApiSource = readSourceAt(adminArtistMemberApiPath)
const validatesNotificationRouteId =
  (notificationDetailSource.match(/validateUUID\(resolvedParams\.id,\s*['"]알림 ID['"]\)/g) ?? [])
    .length >= 2 &&
  // RPC(mark_notification_read)의 auth.uid() 의존을 없애고 앱 계층 직접 쿼리로
  // 옮긴 뒤(단계 2b-4), 다시 단계 2c(Task 7)에서 Turso 쿼리 계층
  // (markNotificationRead/deleteNotification)으로 옮겼다. PATCH/DELETE 둘 다
  // 라우트 id와 세션 사용자 id를 **같은 인자 순서로** 넘겨 동시에 스코프하는지
  // 직접 확인한다 — 호출 형태가 아니라 실제 소유권 필터의 존재가 불변식이다.
  (notificationDetailSource.match(/\(notificationId,\s*user\.id\)/g) ?? []).length >= 2
// mark_all_notifications_read RPC(auth.uid() 의존)를 걷어내면서(단계 2b-5 회귀
// 수정) 소유권 필터는 처음엔 src/lib/server/notificationsWrite.ts로, 단계
// 2c(Task 7)에서 다시 src/db/queries/notifications.ts의
// markAllNotificationsRead로 옮겨졌다(Drizzle/Turso). validatesNotificationRouteId가
// 라우트 레벨에서 그러듯, 여기서도 "RPC/Supabase 호출 여부가 아니라 실제
// 소유권 필터의 존재가 불변식"을 그대로 적용한다 — 누가 이 모듈을 리팩터링하며
// 필터를 잃어도 정적으로 잡는다. **mutator 함수 본문만** 추출해서 본다 —
// 파일 전체에는 listNotifications 등 다른 함수의 `eq(notifications.userId,
// ...)` 호출도 섞여 있어, 파일 전체 검사로는 특정 함수에서 필터가 빠져도
// 다른 함수의 매치로 통과해버릴 수 있다. 이 파일의 독스트링 자체가
// `eq(notifications.userId, userId)`를 설명 예시로 인용하므로, 주석을
// 살려둔 채 실제 줄만 지워도 검사가 속지 않도록 stripComments로 주석을
// 걷어낸 소스만 본다.
//
// markAllNotificationsRead뿐 아니라 markNotificationRead·deleteNotification도
// 각자 소유권 필터(eq(notifications.userId, ...))를 갖는 별도의
// mutator다 — 셋 중 하나만 검사하면 나머지 둘의 필터 소실은 행위
// 테스트로만 잡히고 정적 가드는 침묵한다. 그래서 세 함수 전부 같은
// 본문 추출 방식으로 검사한다.
function extractFunctionBody(source, functionName) {
  const match = source.match(
    new RegExp(`export async function ${functionName}\\([\\s\\S]*?\\n\\}\\n`)
  )
  return match ? match[0] : ''
}
const notificationsWriteStripped = stripComments(notificationsWriteSource)
const markAllNotificationsReadBody = extractFunctionBody(
  notificationsWriteStripped,
  'markAllNotificationsRead'
)
const markNotificationReadBody = extractFunctionBody(
  notificationsWriteStripped,
  'markNotificationRead'
)
const deleteNotificationBody = extractFunctionBody(notificationsWriteStripped, 'deleteNotification')
const enforcesNotificationOwnershipFilter =
  /eq\(notifications\.userId,\s*userId\)/.test(markAllNotificationsReadBody) &&
  /isNull\(notifications\.readAt\)/.test(markAllNotificationsReadBody) &&
  /eq\(notifications\.userId,\s*userId\)/.test(markNotificationReadBody) &&
  /eq\(notifications\.userId,\s*userId\)/.test(deleteNotificationBody)
// create_notification/create_bulk_notification RPC 호출을 단계 2c(Task 7)에서
// Turso 쿼리 계층(createNotification/createBulkNotifications)으로 옮기면서
// `p_xxx:` RPC 파라미터 이름이 사라졌다 — 이제는 라우트가 검증된 변수를
// 새 함수의 snake_case 필드로 그대로 넘기는지를 확인한다("검증된 변수만
// 넘긴다"는 불변식은 이름이 바뀌어도 동일하게 강제해야 한다).
const validatesNotificationMutationIds =
  /validateUUID/.test(notificationsSource) &&
  /parseNotificationType\(typeParam\)/.test(notificationsSource) &&
  /parseNotificationType\(body\.type\)/.test(notificationsSource) &&
  /type:\s*notificationType/.test(notificationsSource) &&
  !/body\.type\.length\s*>\s*50/.test(notificationsSource) &&
  /validateNotificationId\(body\.user_id,\s*['"]사용자 ID['"]\)/.test(notificationsSource) &&
  /user_id:\s*userId/.test(notificationsSource) &&
  /related_post_id:\s*relatedPostId/.test(notificationsSource) &&
  /related_user_id:\s*relatedUserId/.test(notificationsSource) &&
  /sanitizeNotificationData\(body\.data\)/.test(notificationsSource) &&
  /data:\s*notificationData/.test(notificationsSource) &&
  /parseNotificationExpiresAt\(body\.expires_at\)/.test(notificationsSource) &&
  /expires_at:\s*expiresAt/.test(notificationsSource) &&
  /const notificationTitle = typeof body\.title === ['"]string['"] \? body\.title\.trim\(\) : ['"]['"]/.test(
    notificationsSource
  ) &&
  /title:\s*notificationTitle/.test(notificationsSource) &&
  /const notificationMessage = typeof body\.message === ['"]string['"] \? body\.message\.trim\(\) : ['"]['"]/.test(
    notificationsSource
  ) &&
  /message:\s*notificationMessage/.test(notificationsSource) &&
  !/data:\s*body\.data/.test(notificationsSource) &&
  !/expires_at:\s*body\.expires_at/.test(notificationsSource) &&
  !/title:\s*body\.title/.test(notificationsSource) &&
  !/message:\s*body\.message/.test(notificationsSource) &&
  /validateUUID/.test(bulkNotificationsSource) &&
  /parseNotificationType\(body\.type\)/.test(bulkNotificationsSource) &&
  /type:\s*notificationType/.test(bulkNotificationsSource) &&
  !/body\.type\.length\s*>\s*50/.test(bulkNotificationsSource) &&
  /const\s+userIds:\s*string\[\] = \[\]/.test(bulkNotificationsSource) &&
  /userIds\.push\(userId\)/.test(bulkNotificationsSource) &&
  /user_ids:\s*userIds/.test(bulkNotificationsSource) &&
  /sanitizeNotificationData\(body\.data\)/.test(bulkNotificationsSource) &&
  /data:\s*notificationData/.test(bulkNotificationsSource) &&
  /parseNotificationExpiresAt\(body\.expires_at\)/.test(bulkNotificationsSource) &&
  /expires_at:\s*expiresAt/.test(bulkNotificationsSource) &&
  /const notificationTitle = typeof body\.title === ['"]string['"] \? body\.title\.trim\(\) : ['"]['"]/.test(
    bulkNotificationsSource
  ) &&
  /title:\s*notificationTitle/.test(bulkNotificationsSource) &&
  /const notificationMessage = typeof body\.message === ['"]string['"] \? body\.message\.trim\(\) : ['"]['"]/.test(
    bulkNotificationsSource
  ) &&
  /message:\s*notificationMessage/.test(bulkNotificationsSource) &&
  !/data:\s*body\.data/.test(bulkNotificationsSource) &&
  !/expires_at:\s*body\.expires_at/.test(bulkNotificationsSource) &&
  !/title:\s*body\.title/.test(bulkNotificationsSource) &&
  !/message:\s*body\.message/.test(bulkNotificationsSource) &&
  /RESERVED_NOTIFICATION_DATA_KEYS/.test(notificationDataSource) &&
  /['"]post_id['"]/.test(notificationDataSource) &&
  /['"]related_post_id['"]/.test(notificationDataSource) &&
  /parseNotificationExpiresAt/.test(notificationExpirySource) &&
  /Number\.isFinite\(parsed\.getTime\(\)\)/.test(notificationExpirySource) &&
  /parsed\.getTime\(\) > Date\.now\(\)/.test(notificationExpirySource) &&
  /NOTIFICATION_TYPES/.test(notificationTypesSource) &&
  /satisfies\s+readonly\s+NotificationType\[\]/.test(notificationTypesSource)
// Task 4: event_applications 권위가 Turso로 옮겨지며 이 라우트의 GET/DELETE가
// Supabase `query.eq(...)`/`.delete().eq(...)`에서 쿼리 계층 호출
// `listEventApplications({...})`/`deleteEventApplication(applicationId)`
// (src/db/queries/misc.ts)로 바뀌었다. 이 라우트에는 Supabase 호출이 한 줄도
// 남지 않았으므로 옛 패턴 분기는 죽은 코드였다 — 새 호출부에 고정한다
// (리뷰 1회차 Important 1).
const validatesEventApplicationStatusAllowlist =
  /EVENT_APPLICATION_STATUSES\s*=\s*\[['"]pending['"],\s*['"]approved['"],\s*['"]rejected['"]\]\s+as const/.test(
    eventApplicationStatusSource
  ) &&
  /parseEventApplicationStatus/.test(eventApplicationStatusSource) &&
  /parseEventApplicationStatus\(statusParam\)/.test(adminEventApplicationsApiSource) &&
  /if\s*\(statusParam && !status\)/.test(adminEventApplicationsApiSource) &&
  /listEventApplications\(\{[^)]*?\bstatus,/.test(adminEventApplicationsApiSource) &&
  /z\.enum\(EVENT_APPLICATION_STATUSES/.test(adminEventApplicationsApiSource) &&
  !/const status = searchParams\.get\(['"]status['"]\) \|\| ['"]['"]/.test(
    adminEventApplicationsApiSource
  ) &&
  !/query = query\.eq\(['"]status['"],\s*statusParam\)/.test(adminEventApplicationsApiSource)
const validatesAdminEventApplicationSlug =
  /isValidEventSlug/.test(adminEventApplicationsApiSource) &&
  /normalizeEventSlug/.test(adminEventApplicationsApiSource) &&
  /const eventSlugParam = searchParams\.get\(['"]event_slug['"]\) \|\| ['"]['"]/.test(
    adminEventApplicationsApiSource
  ) &&
  /const eventSlug = normalizeEventSlug\(eventSlugParam\)/.test(adminEventApplicationsApiSource) &&
  /if\s*\(eventSlugParam && !isValidEventSlug\(eventSlug\)\)/.test(
    adminEventApplicationsApiSource
  ) &&
  /listEventApplications\(\{[^)]*?eventSlug:\s*eventSlug \|\| null,/.test(
    adminEventApplicationsApiSource
  ) &&
  !/query = query\.eq\(['"]event_slug['"],\s*eventSlugParam\)/.test(adminEventApplicationsApiSource)
const validatesEventApplicationDeleteId =
  /validateUUID\(id \?\? ['"]['"],\s*['"]신청 ID['"]\)/.test(adminEventApplicationsApiSource) &&
  /const applicationId = idValidation\.sanitized/.test(adminEventApplicationsApiSource) &&
  /deleteEventApplication\(applicationId\)/.test(adminEventApplicationsApiSource) &&
  /ApiSuccess\.ok\(\{\s*id:\s*applicationId\s*\}/.test(adminEventApplicationsApiSource) &&
  !/\^\[0-9a-f-\]\{36\}\$/.test(adminEventApplicationsApiSource) &&
  !/\.delete\(\)\.eq\(['"]id['"],\s*id\)/.test(adminEventApplicationsApiSource)
const userLikesPath = join(root, 'src/app/api/users/[id]/likes/route.ts')
const userLikesSource = readSourceAt(userLikesPath)
// 단계 2c(Task 6): get_user_likes RPC 호출(`p_user_id: requestedUserId`)과
// post_likes 총 개수 Supabase 카운트(`.eq('user_id', requestedUserId)`)를
// Turso 쿼리 계층 listUserLikes(requestedUserId, ...)/
// countUserLikes(requestedUserId)로 옮겼다.
const validatesUserLikesRouteId =
  /validateUUID\(resolvedParams\.id,\s*['"]사용자 ID['"]\)/.test(userLikesSource) &&
  /listUserLikes\(requestedUserId,/.test(userLikesSource) &&
  /countUserLikes\(requestedUserId\)/.test(userLikesSource)
// 단계 4 Task 6b: 권한 판정에 필요한 컬럼이 셋(is_admin/registration_status/
// is_active)뿐인데 getProfileById가 33개 컬럼(계좌번호·실명 포함)을 실어 왔다.
// 좁은 조회(getProfileAuthzFields)와 공용 판정 함수(isApprovedActiveAdmin)로
// 옮겼다 — 지키려는 것은 그대로다: **관리자 플래그만으로는 통과하면 안 되고,
// 승인·활성까지 함께 봐야 한다.** 그래서 라우트가 그 함수를 부르는지에 더해
// 그 함수 자체가 세 조건을 다 보는지까지 본다(위임만 확인하면 판정 함수를
// 느슨하게 고쳤을 때 이 가드가 조용히 무력해진다).
//
// 판정 함수 **본문**(isApprovedActive/isApprovedActiveAdmin이 세 조건을 다
// 보는가)은 이제 위쪽 AUTHORIZATION_HELPER_CONTRACTS가 한 곳에서 고정한다 —
// 그 계약은 이 라우트만의 것이 아니라 저장소 전체의 것이라, 같은 사실을 두
// 곳에서 단정하면 어느 쪽이 정본인지 알 수 없게 된다. 여기 남는 것은 이
// 라우트의 호출부 계약뿐이다.
const validatesUserLikesAdminStatus =
  /getProfileAuthzFields\(user\.id\)/.test(userLikesSource) &&
  /isApprovedActiveAdmin\(profile\)/.test(userLikesSource) &&
  !/getProfileById\(/.test(userLikesSource)
const postDetailPath = join(root, 'src/app/api/posts/[id]/route.ts')
const postDetailSource = readSourceAt(postDetailPath)

// ---------------------------------------------------------------------------
// 소유권 게이트는 "식이 존재하는가"가 아니라 "그 식으로 **분기**하는가"를 본다.
//
// 리뷰어 실증: 첨부 삭제의 `if (!isAuthor && !isAdmin) return forbidden` 세
// 줄을 통째로 지워도 이 파일은 exit 0이었다 — 아무 로그인 사용자나 남의
// 게시글 첨부를 지울 수 있게 만들어도 초록불이라는 뜻이다. 게시글 수정·삭제,
// 댓글 삭제도 같은 방식으로 뚫렸고, `posts/[id]`는 두 게이트를 지우고 **주석에
// 같은 문자열만 남겨도** 통과했다(그 각도는 이제 readSourceAt이 막는다).
//
// 그래서 조건식과 그 조건이 실제로 내리는 거부 응답을 한 덩어리로 못박고,
// **개수**까지 센다 — 두 곳 중 한 곳만 지우는 것도 잡아야 한다.
const OWNERSHIP_GATE_CONTRACTS = [
  {
    file: 'src/app/api/posts/[id]/route.ts',
    source: postDetailSource,
    what: '작성자 본인 또는 관리자만 수정·삭제(PATCH·DELETE 두 곳)',
    pattern: /if \(post\.author_id !== user\.id && !isAdmin\) \{\s*return ApiError\.forbidden\(/g,
    expected: 2,
  },
  {
    file: 'src/app/api/posts/[id]/route.ts',
    source: postDetailSource,
    what: '관리자 판정에 승인·활성까지 함께 본다(DELETE)',
    pattern:
      /isAdmin = !!\(prof\?\.is_admin && prof\.registration_status === ['"]approved['"] && prof\.is_active\)/g,
    expected: 2,
  },
  {
    file: 'src/app/api/posts/[id]/comments/[commentId]/route.ts',
    source: commentDeleteSource,
    what: '댓글은 작성자 본인 또는 관리자만 삭제',
    pattern: /if \(comment\.author_id !== userId && !isAdmin\) \{\s*return ApiError\.forbidden\(/g,
    expected: 1,
  },
  {
    file: 'src/app/api/posts/[id]/attachments/[attachmentId]/route.ts',
    source: postAttachmentDetailSource,
    what: '첨부 삭제는 게시글 작성자 또는 관리자만',
    pattern: /if \(!isAuthor && !isAdmin\) \{\s*return ApiError\.forbidden\(/g,
    expected: 1,
  },
  {
    file: 'src/app/api/posts/[id]/attachments/[attachmentId]/route.ts',
    source: postAttachmentDetailSource,
    what: '작성자 판정을 첨부가 달린 게시글의 author_id로 한다',
    pattern: /const isAuthor = attachment\.posts\.author_id === user\.id/g,
    expected: 1,
  },
  // 최종 회차 C-1: 같은 기능 안의 나머지 소유권 게이트 2곳. 리뷰어 실증 —
  // 둘 다 통째로 지워도 이 파일은 exit 0이었다. 첫 번째는 위 첨부 삭제
  // 게이트가 고정된 **바로 그 파일**의 90줄 위에 있다. 지워지면 아무 로그인
  // 회원이 남의 글 첨부의 alt text·정렬·대표 이미지를 바꾸거나(PATCH),
  // 남의 글에 첨부를 올릴 수 있게 된다(POST).
  {
    file: 'src/app/api/posts/[id]/attachments/[attachmentId]/route.ts',
    source: postAttachmentDetailSource,
    what: '첨부 수정(PATCH)은 첨부가 달린 게시글의 작성자만',
    pattern: /if \(attachment\.posts\.author_id !== user\.id\) \{\s*return ApiError\.forbidden\(/g,
    expected: 1,
  },
  {
    file: 'src/app/api/posts/[id]/attachments/route.ts',
    source: postAttachmentsSource,
    what: '첨부 업로드(POST)는 게시글 작성자만',
    // 조건과 거부 응답 사이에 다른 분기(early return·조건부 통과)가 끼어들면
    // 매치가 깨지도록 좁게 묶는다. 다만 지금 그 자리에 있는 디버그 로그
    // (`console.error('[UPLOAD API] …')`) 한 줄은 **선택**으로 둔다 — 필수로
    // 박아 두면 로그 한 줄 지우는 정당한 정리가 "게이트가 0곳"이라는 사실과
    // 다른 실패로 나오고, 걸린 사람은 게이트가 아니라 이 계약을 지우는 쪽으로
    // 간다(가드를 느슨하게 만들어 온 바로 그 유인이다).
    pattern:
      /if \(postData\.author_id !== user\.id\) \{\s*(?:console\.error\([^)]*\)\s*)?return ApiError\.forbidden\(/g,
    expected: 1,
  },
]

const ownershipGateViolations = OWNERSHIP_GATE_CONTRACTS.flatMap(contract => {
  const found = (contract.source.match(contract.pattern) ?? []).length
  return found === contract.expected
    ? []
    : [`${contract.file}: ${contract.what} — ${contract.expected}곳이어야 하는데 ${found}곳입니다`]
})

const boardPostDetailPath = join(root, 'src/app/api/board/post/[id]/route.ts')
const boardPostDetailSource = readSourceAt(boardPostDetailPath)
const serverBoardPath = join(root, 'src/lib/server/board.ts')
const serverBoardSource = readSourceAt(serverBoardPath)
const boardCategoriesPath = join(root, 'src/constants/categories.ts')
const boardCategoriesSource = readSourceAt(boardCategoriesPath)
const boardCategoryPagePath = join(root, 'src/app/[locale]/board/page.tsx')
const boardCategoryPageSource = readSourceAt(boardCategoryPagePath)
const boardServerDataPath = join(root, 'src/app/[locale]/board/BoardServerData.tsx')
const boardServerDataSource = readSourceAt(boardServerDataPath)
const boardPostsApiPath = join(root, 'src/app/api/board/posts/route.ts')
const boardPostsApiSource = readSourceAt(boardPostsApiPath)
const boardListPostsApiPath = join(root, 'src/app/api/posts/route.ts')
const boardListPostsApiSource = readSourceAt(boardListPostsApiPath)
const publicPostsApiPath = join(root, 'src/app/api/posts/public/route.ts')
const publicPostsApiSource = readSourceAt(publicPostsApiPath)
const keysetCursorPath = join(root, 'src/utils/keysetCursor.ts')
const keysetCursorSource = readSourceAt(keysetCursorPath)
// 단계 2c(Task 4): posts/member_profiles가 Turso로 옮겨가며 정렬 로직도
// src/app/api/posts/public/route.ts에서 src/db/queries/posts.ts의
// listPostsKeyset()으로 이동했다.
const postsQueriesPath = join(root, 'src/db/queries/posts.ts')
const postsQueriesSource = readSourceAt(postsQueriesPath)
const boardDetailPagePath = join(root, 'src/app/[locale]/board/[id]/page.tsx')
const boardDetailPageSource = readSourceAt(boardDetailPagePath)
const commentsApiPath = join(root, 'src/app/api/posts/[id]/comments/route.ts')
const commentsApiSource = readSourceAt(commentsApiPath)
const commentsListApiPath = join(root, 'src/app/api/posts/[id]/comments-list/route.ts')
const commentsListApiSource = readSourceAt(commentsListApiPath)
const postContentApiPath = join(root, 'src/app/api/posts/[id]/content/route.ts')
const postContentApiSource = readSourceAt(postContentApiPath)
const postLikesApiPath = join(root, 'src/app/api/posts/[id]/likes/route.ts')
const postLikesApiSource = readSourceAt(postLikesApiPath)
const commentLikeApiPath = join(root, 'src/app/api/comments/[id]/like/route.ts')
const commentLikeApiSource = readSourceAt(commentLikeApiPath)
const boardPageShellPath = join(root, 'src/components/board/BoardPageShell.tsx')
const boardPageShellSource = readSourceAt(boardPageShellPath)
const serverBoardViewPath = join(root, 'src/components/board/ServerBoardView.tsx')
const serverBoardViewSource = readSourceAt(serverBoardViewPath)
const validatesBoardCategoryFilters =
  /export const parseBoardCategory/.test(boardCategoriesSource) &&
  /parseBoardCategory\(category\) \?\? ['"]전체['"]/.test(serverBoardSource) &&
  // Task 8: board.ts의 board_posts_with_stats 뷰 읽기(Supabase `query =
  // query.eq('category', safeCategory)`)가 listBoardPostsWithStats(Turso,
  // src/db/queries/posts.ts)로 옮겨갔다 — allowlist로 검증된 safeCategory를
  // 그 함수의 category 인자로 넘기는지는 여전히 확인한다(가드를 넓히지
  // 않는다, 패턴만 새 호출부에 맞게 갱신).
  /listBoardPostsWithStats\(\{\s*category:\s*safeCategory/.test(serverBoardSource) &&
  // 카테고리 필터는 클라이언트(ServerBoardView)로 이관됨 — searchParams 값을
  // 반드시 parseBoardCategory allowlist로 검증한 뒤 사용해야 한다. 서버 파일에
  // await searchParams가 다시 생기면 /board ISR이 사문화되므로 함께 금지한다.
  /parseBoardCategory\(searchParams\.get\(['"]category['"]\)[\s\S]{0,40}?\) \?\? ['"]전체['"]/.test(
    serverBoardViewSource
  ) &&
  !/await searchParams/.test(boardCategoryPageSource) &&
  !/await searchParams/.test(boardServerDataSource) &&
  /parseBoardCategory\(categoryParam\)/.test(boardPostsApiSource) &&
  /const boardCategory = parseBoardCategory\(categoryParam\)/.test(boardPostsApiSource) &&
  /ApiError\.badRequest\(['"]유효하지 않은 카테고리입니다\.['"]\)/.test(boardPostsApiSource) &&
  /parseBoardCategory\(categoryParam\)/.test(boardListPostsApiSource) &&
  /const boardCategory = parseBoardCategory\(categoryParam\)/.test(boardListPostsApiSource) &&
  /throw ApiError\.badRequest\(['"]유효하지 않은 카테고리입니다\.['"]\)/.test(
    boardListPostsApiSource
  ) &&
  /parseBoardCategory\(categoryParam\)/.test(publicPostsApiSource) &&
  /const boardCategory = parseBoardCategory\(categoryParam\)/.test(publicPostsApiSource) &&
  // 44dd34b에서 레거시 createErrorResponse가 표준 ApiError(CLAUDE.md 정본)로
  // 전환됨 — 레거시 헬퍼 재유입도 함께 차단
  /return ApiError\.badRequest\(['"]유효하지 않은 카테고리입니다\.['"]\)\.toNextResponse\(\)/.test(
    publicPostsApiSource
  ) &&
  !/createErrorResponse/.test(publicPostsApiSource) &&
  !/const allowedCategories = \[['"]전체['"],\s*['"]공지['"],\s*['"]잡담['"],\s*['"]홍보['"],\s*['"]건의['"]\]/.test(
    boardListPostsApiSource
  ) &&
  !/query = query\.eq\(['"]category['"],\s*category\)/.test(serverBoardSource) &&
  !/query = query\.eq\(['"]category['"],\s*category\)/.test(publicPostsApiSource)
const validatesPublicPostsCursor =
  /parseTimestampUuidCursor/.test(keysetCursorSource) &&
  /formatTimestampUuidCursor/.test(keysetCursorSource) &&
  /validateUUID\(parts\[1\] \?\? ['"]['"],\s*idLabel\)/.test(keysetCursorSource) &&
  /Number\.isFinite\(Date\.parse\(createdAt\)\)/.test(keysetCursorSource) &&
  /parsePublicPostsSortOrder/.test(publicPostsApiSource) &&
  /const parsedCursor = cursor \? parseTimestampUuidCursor\(cursor,\s*['"]게시글 ID['"]\) : null/.test(
    publicPostsApiSource
  ) &&
  /if\s*\(cursor && !parsedCursor\)/.test(publicPostsApiSource) &&
  /if\s*\(!sortOrder\)/.test(publicPostsApiSource) &&
  // 단계 2c: 정렬(created_at/id, ascending 방향)을 직접 .order() 체이닝하던
  // 코드가 listPostsKeyset(Turso)으로 옮겨갔다. 라우트는 sortOrder를 그대로
  // 전달만 하고, 결정론적 created_at/id 타이브레이크 정렬 자체는
  // src/db/queries/posts.ts에서 보장한다(둘 다 확인).
  /listPostsKeyset\(\{[\s\S]*?sortOrder,[\s\S]*?\}\)/.test(publicPostsApiSource) &&
  // 좁힌 단언: 삼항이 파일 어딘가(예: 죽은 변수)에 있는 것만으로는 통과하지
  // 않는다 — 실제로 orderByClauses.push(...) 안에서 쓰이고, 그 배열이
  // .orderBy(...orderByClauses)로 쿼리에 실제 반영돼야 한다(리뷰 대응: 예전
  // orderByClauses.push(...) 줄을 지우고 삼항만 죽은 코드로 남겨도 통과하던
  // 허점을 막는다).
  /orderByClauses\.push\(ascending \? asc\(posts\.createdAt\) : desc\(posts\.createdAt\)\)/.test(
    postsQueriesSource
  ) &&
  /orderByClauses\.push\(ascending \? asc\(posts\.id\) : desc\(posts\.id\)\)/.test(
    postsQueriesSource
  ) &&
  /\.orderBy\(\.\.\.orderByClauses\)/.test(postsQueriesSource) &&
  /has_prev:\s*!!parsedCursor/.test(publicPostsApiSource) &&
  !/const sortOrder = \(searchParams\.get\(['"]sort['"]\) \|\| ['"]desc['"]\)\.toLowerCase\(\) === ['"]asc['"] \? ['"]asc['"] : ['"]desc['"]/.test(
    publicPostsApiSource
  ) &&
  !/if\s*\(cursor\)[\s\S]*?const \[enc,\s*rawId\] = cursor\.split\(['"]\|['"]\)/.test(
    publicPostsApiSource
  ) &&
  !/has_prev:\s*!!cursor/.test(publicPostsApiSource)
const validatesCommentCursors =
  /parseTimestampUuidCursor\(cursor,\s*['"]댓글 ID['"]\)/.test(commentsApiSource) &&
  /parseTimestampUuidCursor\(cursor,\s*['"]댓글 ID['"]\)/.test(commentsListApiSource) &&
  /if\s*\(cursor && !parsedCursor\)/.test(commentsApiSource) &&
  /if\s*\(cursor && !parsedCursor\)/.test(commentsListApiSource) &&
  /formatTimestampUuidCursor\(last\.created_at,\s*last\.id\)/.test(commentsApiSource) &&
  /formatTimestampUuidCursor\(last\.created_at,\s*last\.id\)/.test(commentsListApiSource) &&
  // 단계 2c(Task 6): get_post_comments_keyset RPC 파라미터
  // (p_created_at/p_id)를 listCommentsKeyset(Turso)의 createdAt/id 인자로
  // 옮겼다. `p_id:`가 `id:`를 부분 문자열로 포함하므로, 새 인자 쪽 정규식은
  // 앞에 단어문자가 오지 않는다는 조건(`(?<![\w])`)으로 못박는다 — 없으면
  // RPC 호출로 되돌려도 이 단정이 그대로 통과한다.
  /(?<![\w])createdAt:\s*parsedCursor\?\.createdAt \?\? null/.test(commentsListApiSource) &&
  /(?<![\w])id:\s*parsedCursor\?\.id \?\? null/.test(commentsListApiSource) &&
  !/decodeURIComponent\(cursor\)/.test(commentsApiSource) &&
  !/decodeURIComponent\(cursor\)/.test(commentsListApiSource)
const commentSectionPath = join(root, 'src/components/CommentSection.tsx')
const commentSectionSource = existsSync(commentSectionPath) ? readSourceAt(commentSectionPath) : ''
const likesQueriesPath = join(root, 'src/db/queries/likes.ts')
const likesQueriesSource = existsSync(likesQueriesPath) ? readSourceAt(likesQueriesPath) : ''
// 단계 2c(Task 6): comment_likes 배치 조회를 Supabase에서 Turso 쿼리
// 계층(getLikedCommentIds, src/db/queries/likes.ts)으로 옮겼다. CommentSection도
// 브라우저에서 테이블을 직접 읽는 대신 comments-list API를 다시 호출한다.
// 단계 4 Task 6b: 그 사이에 있던 통과 래퍼(src/lib/server/commentLikes.ts의
// getUserLikedCommentIds)를 지우고 라우트가 쿼리 계층을 직접 부른다 — 아래
// 라우트 쪽 단정이 그 호출을 그대로 못박으므로 가드가 느슨해지지 않는다.
const annotatesAuthenticatedCommentLikeState =
  !existsSync(join(root, 'src/lib/server/commentLikes.ts')) &&
  /eq\(commentLikes\.userId,\s*userId\)/.test(likesQueriesSource) &&
  // 상세 페이지 SSR 셸은 ISR 캐시를 위해 개인화(세션 기반 is_liked)를 포함하지
  // 않는다(전수감사 P2) — 서버는 is_liked:false로 내려주고, 복원은 클라이언트
  // CommentSection이 로그인 사용자(currentUserId)에 한해 좋아요 상태를 다시
  // 조회해 담당한다. 셸에 세션 조회가 다시 들어오면 라우트가 동적으로 전환되므로
  // 금지 가드를 함께 둔다.
  /is_liked:\s*false/.test(boardDetailPageSource) &&
  !/getUserLikedCommentIds\(/.test(boardDetailPageSource) &&
  // 클라이언트 복원 경로가 실재하는지 검증 — 이게 없으면 초기 댓글이 항상 빈 하트로
  // 표시되고 재클릭 시 기존 좋아요가 삭제된다(코드리뷰 CONFIRMED). currentUserId가
  // 채워졌을 때 좋아요 상태를 다시 받아 is_liked를 병합해야 한다. 단계 2c:
  // 브라우저에서 comment_likes 테이블을 직접 읽던 옛 방식을 comments-list API
  // 재호출(fetchCommentsFromApi)로 옮겼다.
  /if \(!currentUserId \|\| initialComments\.length === 0\) return/.test(commentSectionSource) &&
  /fetchCommentsFromApi\(postId\)/.test(commentSectionSource) &&
  /is_liked:\s*true/.test(commentSectionSource) &&
  // 인증 사용자 대상 댓글 목록 API는 계속 서버에서 like 상태를 주석한다.
  // 단계 4 Task 6b: 호출 대상이 래퍼가 아니라 쿼리 계층 함수 자체다.
  /getLikedCommentIds\(user\.id,\s*commentIds\)/.test(commentsApiSource) &&
  /getLikedCommentIds\(user\.id,\s*commentIds\)/.test(commentsListApiSource) &&
  !/getUserLikedCommentIds\(/.test(commentsApiSource) &&
  !/getUserLikedCommentIds\(/.test(commentsListApiSource) &&
  /is_liked:\s*likedCommentIds\.has\(String\(c\.id\)\)/.test(commentsApiSource) &&
  /is_liked:\s*likedCommentIds\.has\(String\(c\.id\)\)/.test(commentsListApiSource)
const validatesPostRouteIdsUseSanitizedUuid =
  /const applicationId = idValidation\.sanitized/.test(adminEventApplicationsApiSource) &&
  // Task 4: event_applications 권위가 Turso로 옮겨지며 PATCH/PUT의 갱신이
  // Supabase `.update({...}).eq('id', applicationId)`에서 쿼리 계층 호출
  // `updateEventApplicationStatus(applicationId, status)`/
  // `updateEventApplicationFields(applicationId, updateData)`
  // (src/db/queries/misc.ts)로 바뀌었다. 이 라우트에는 Supabase 호출이 한 줄도
  // 남지 않았으므로 옛 패턴 분기는 죽은 코드였다(리뷰 1회차 Important 1).
  // 2026-09-02: 3번째 인자 `expected_status`를 **요구한다**. 이 갱신은
  // 낙관적 잠금이다 — 그 인자가 빠지면 조건 없는 덮어쓰기로 되돌아가고
  // 관리자 둘이 동시에 누를 때 나중 쓰기가 조용히 이긴다. 예전 이 가드는
  // `(applicationId, status)` 정확 매칭을 요구해서, 고치려면 가드부터
  // 깨야 하는 상태로 버그를 붙들고 있었다.
  /updateEventApplicationStatus\(\s*applicationId,\s*status,\s*expected_status\s*\)/.test(
    adminEventApplicationsApiSource
  ) &&
  /updateEventApplicationFields\(applicationId,\s*updateData\)/.test(
    adminEventApplicationsApiSource
  ) &&
  !/\.update\(\{ status,[\s\S]*?\.eq\(['"]id['"],\s*id\)/.test(adminEventApplicationsApiSource) &&
  /const memberIdValidation = validateUUID\(parsedInput\.memberId,\s*['"]멤버 ID['"]\)/.test(
    adminMemberActionApiSource
  ) &&
  /const memberId = memberIdValidation\.sanitized/.test(adminMemberActionApiSource) &&
  // 단계 2c: member_profiles 조회/갱신을 Supabase `.eq('id', memberId)`에서
  // Turso 쿼리 계층 getProfileById(memberId)/updateProfile(memberId, ...)로
  // 옮겼다.
  /getProfileById\(memberId\)/.test(adminMemberActionApiSource) &&
  /updateProfile\(memberId,/.test(adminMemberActionApiSource) &&
  /data\.action === ['"]suspend['"]/.test(adminMemberActionApiSource) &&
  /data\.suspension_reason === undefined && data\.suspension_until === undefined/.test(
    adminMemberActionApiSource
  ) &&
  /const memberIdValidation = validateUUID\(parsed\.data\.memberId,\s*['"]멤버 ID['"]\)/.test(
    adminMemberFlagsApiSource
  ) &&
  /const memberId = memberIdValidation\.sanitized/.test(adminMemberFlagsApiSource) &&
  // 단계 2c: 위와 같은 이유(getProfileById/updateProfile로 전환).
  /getProfileById\(memberId\)/.test(adminMemberFlagsApiSource) &&
  /updateProfile\(memberId,/.test(adminMemberFlagsApiSource) &&
  /const sanitizedMemberIds:\s*string\[\] = \[\]/.test(adminMembersBulkApiSource) &&
  /sanitizedMemberIds\.push\(memberIdValidation\.sanitized\)/.test(adminMembersBulkApiSource) &&
  /member_ids:\s*sanitizedMemberIds/.test(adminMembersBulkApiSource) &&
  /for \(const memberId of sanitizedMemberIds\)/.test(adminMembersBulkApiSource) &&
  /function parseArtistLegacyId/.test(adminArtistMembersApiSource) &&
  /const artistId = parseArtistLegacyId\(getRouteParam\(params\.id\)\)/.test(
    adminArtistMembersApiSource
  ) &&
  /const memberId = memberIdValidation\.sanitized/.test(adminArtistMembersApiSource) &&
  // Task 4: artists 권위가 Turso로 옮겨지며 존재 확인이 Supabase
  // `.eq('legacy_id', artistId)`에서 쿼리 계층 호출
  // `getArtistByLegacyId(artistId)`(src/db/queries/artists.ts)로 바뀌었다.
  // 이 라우트에는 Supabase 호출이 한 줄도 남지 않았으므로 옛 패턴 분기는
  // 죽은 코드였다(리뷰 1회차 Important 1).
  /getArtistByLegacyId\(artistId\)/.test(adminArtistMembersApiSource) &&
  /artist_id:\s*artistId/.test(adminArtistMembersApiSource) &&
  /function parseArtistLegacyId/.test(adminArtistMemberApiSource) &&
  /const artistId = parseArtistLegacyId\(getRouteParam\(params\.id\)\)/.test(
    adminArtistMemberApiSource
  ) &&
  /const memberId = memberIdValidation\.sanitized/.test(adminArtistMemberApiSource) &&
  // 단계 2c: 위와 같은 이유(getProfileById/updateProfile로 전환).
  /getProfileById\(memberId\)/.test(adminArtistMemberApiSource) &&
  /updateProfile\(memberId,/.test(adminArtistMemberApiSource) &&
  /const postId = uuidValidation\.sanitized/.test(postContentApiSource) &&
  // 단계 2c: posts 조회를 Supabase `.eq('id', postId)`에서 Turso 쿼리 계층
  // getPostById(postId, ...)로 옮겼다.
  /getPostById\(postId,/.test(postContentApiSource) &&
  !/\.eq\(['"]id['"],\s*id\)/.test(postContentApiSource) &&
  /const validPostId = uuidValidation\.sanitized/.test(boardPostDetailSource) &&
  // 단계 2c 후속(Task 6 확장): 위와 같은 이유(getPostById(validPostId, ...)로
  // 전환) — 댓글·첨부 조회도 `.eq('post_id', validPostId)`에서
  // listCommentsKeyset(validPostId, ...)/listAttachments(validPostId, ...)로
  // 옮겼다.
  /getPostById\(validPostId,/.test(boardPostDetailSource) &&
  /listCommentsKeyset\(validPostId,/.test(boardPostDetailSource) &&
  /listAttachments\(validPostId,/.test(boardPostDetailSource) &&
  !/\.eq\(['"]id['"],\s*postId\)/.test(boardPostDetailSource) &&
  /const postId = uuidValidation\.sanitized/.test(commentsApiSource) &&
  // 단계 2c(Task 6): 댓글 목록 조회를 Supabase `.eq('post_id', postId)`에서
  // Turso 쿼리 계층 listCommentsKeyset(postId, ...)로 옮겼다.
  /listCommentsKeyset\(postId,/.test(commentsApiSource) &&
  /const validPostId = postIdValidation\.sanitized/.test(commentsApiSource) &&
  /post_id:\s*validPostId/.test(commentsApiSource) &&
  !/post_id:\s*postId/.test(commentsApiSource) &&
  /const postId = uuidValidation\.sanitized/.test(commentsListApiSource) &&
  // 단계 2c: get_post_comments_keyset RPC 시도 + 수동 Supabase 폴백
  // 이중 경로를 listCommentsKeyset(Turso) 단일 경로로 대체했다.
  /listCommentsKeyset\(postId,/.test(commentsListApiSource) &&
  !/p_post_id:\s*id/.test(commentsListApiSource) &&
  /const validPostId = uuidValidation\.sanitized/.test(postLikesApiSource) &&
  // 단계 2c: 게시글 존재 확인을 Supabase `.eq('id', validPostId)`에서 Turso
  // 쿼리 계층 getPostById(validPostId, ...)로, 좋아요 여부 확인을
  // `.eq('post_id', validPostId)`에서 isPostLikedByUser(validPostId, ...)로
  // 옮겼다.
  /getPostById\(validPostId,/.test(postLikesApiSource) &&
  /isPostLikedByUser\(validPostId,/.test(postLikesApiSource) &&
  /post_id:\s*validPostId/.test(postLikesApiSource) &&
  /const postId = postIdValidation\.sanitized/.test(postOgImageSource) &&
  // 단계 2c(Task 6 확장): posts 존재 확인을 Supabase `.eq('id', postId)`에서
  // Turso 쿼리 계층 getPostById(postId, ...)로, 첨부(post_attachments) 조회도
  // `.eq('post_id', postId)`에서 옮겼다. 단계 4 Task 6b: 첨부 조회는
  // listImageAttachments(전체)가 아니라 getPrimaryImageAttachment(LIMIT 1)를
  // 쓴다 — 이 라우트는 첫 한 건만 쓰는데 목록 전체를 실어 오고 있었다.
  /getPostById\(postId,/.test(postOgImageSource) &&
  /getPrimaryImageAttachment\(postId\)/.test(postOgImageSource) &&
  !/listImageAttachments\(/.test(postOgImageSource) &&
  /const userIdValidation = validateUUID\(userIdFromQuery,\s*['"]사용자 ID['"]\)/.test(
    postUserDataApiSource
  ) &&
  /userIdValidation\.sanitized !== user\.id/.test(postUserDataApiSource) &&
  /const validPostId = postIdValidation\.sanitized/.test(commentDeleteSource) &&
  /const validCommentId = commentIdValidation\.sanitized/.test(commentDeleteSource) &&
  // 단계 2c: 소유권 확인(`.eq('id', validCommentId).eq('post_id',
  // validPostId)`)과 삭제(같은 이중 스코프)를 Turso 쿼리 계층
  // getCommentById(validCommentId, validPostId)/
  // deleteComment(validCommentId, validPostId)로 옮겼다.
  /getCommentById\(validCommentId,\s*validPostId\)/.test(commentDeleteSource) &&
  /deleteComment\(validCommentId,\s*validPostId\)/.test(commentDeleteSource) &&
  !/\.eq\(['"]id['"],\s*commentId\)/.test(commentDeleteSource) &&
  /const validCommentId = uuidValidation\.sanitized/.test(commentLikeApiSource) &&
  // 단계 2c: 댓글 존재 확인을 Supabase `.eq('id', validCommentId)`에서
  // getCommentById(validCommentId)로, toggle_comment_like RPC를
  // toggleCommentLike(validCommentId, ...)로 옮겼다.
  /getCommentById\(validCommentId\)/.test(commentLikeApiSource) &&
  /toggleCommentLike\(validCommentId,/.test(commentLikeApiSource) &&
  !/p_comment_id:\s*commentId/.test(commentLikeApiSource)

// 코디네이터 코드리뷰(2차): `src/app/api/posts/route.ts` GET은
// fetchBoardPosts에 위임하고, 그 함수는 listBoardPostsWithStats(Turso)를
// 읽는다. "Supabase를 만지지 않는다"는 아래 단계 4 Task 5의 저장소 전역
// 가드가 이미 보장하므로, 여기서는 그와 별개로 **양의 단정**만 남긴다 —
// 좋아요 세트를 실제로 Turso에서 가져오는가. 컷오버 후 새 좋아요가 게시판
// 목록에서 하트로 안 보이던 버그(상세 페이지는 Turso를 봐서 눌린 것으로
// 보이는데 목록은 얼어붙은 Supabase 스냅샷을 봐서 안 눌린 것으로 보이는
// 엇갈림)의 재발을 막는다.
const validatesPostsListLikedSetUsesTurso =
  /getLikedPostIds\(userId,\s*postIds\)/.test(boardListPostsApiSource) &&
  !/\.from\(\s*['"]post_likes['"]\s*\)/.test(stripComments(boardListPostsApiSource))

// ============================================================ 단계 4 Task 5
// **Supabase를 만지는 파일이 `src/` 전체에 0개여야 한다.**
//
// 단계 2c는 표별로 화이트리스트 반전 가드를 세웠다(comments/post_likes/
// comment_likes/post_attachments 한 벌, notifications/notification_stats 한 벌).
// 각 표의 권위가 옮겨갈 때마다 화이트리스트를 비워가는 방식이었다. 표가 전부
// Turso로 넘어온 지금은 그 여러 가드가 하나로 합쳐진다 — "어떤 표를 Supabase로
// 읽는가"가 아니라 "Supabase에 닿는 코드가 있는가"만 보면 되기 때문이다.
// 새 표를 만들어 Supabase로 읽는 코드도 자동으로 걸린다(예전 가드는 표 이름을
// 하드코딩해서 놓쳤다).
//
// 세 가지 접근 경로를 모두 막는다:
//   (1) SDK 임포트·클라이언트 생성 (`@supabase/*`, createSupabaseServer,
//       createServiceRoleClient, createBrowserClient, createServerClient,
//       삭제된 내부 모듈 경로)
//   (2) PostgREST 스타일 표 접근 (`.from('테이블명')` — 문자열 리터럴.
//       Drizzle은 `.from(comments)`처럼 식별자를 쓰므로 구분된다)
//   (3) SDK 없이 손으로 부르는 REST (`/rest/v1/...` + `apikey` 헤더) —
//       삭제된 `src/middleware/supabase-rest.ts`가 정확히 이 모양이었다.
//       (1)만 막으면 이 경로가 그대로 뒤로 들어온다.
//
// **fail-open 방지가 이 가드의 절반이다.** 검사 대상 목록이 비면 offenders도
// 자동으로 비어 통과한다 — 글롭 패턴이 깨지거나 디렉터리가 옮겨가면 가드가
// 조용히 죽는다는 뜻이다. 그래서 네 가지를 함께 단언한다:
//   · 스캔한 파일 수가 하한을 넘는가(글롭이 살아 있는가)
//   · 서브트리별 하한을 넘는가(디렉터리 하나가 통째로 빠지지 않았는가)
//   · 하한표가 스캔된 서브트리를 전부 덮는가(하한 없는 사각지대가 없는가)
//   · 패턴이 알려진 양성 표본을 실제로 무는가(정규식이 눈멀지 않았는가)
// 이 자기검사들은 저장소 상태와 무관하게 매 실행마다 돌고, 아래에서 만드는
// 파일 목록은 저장소 전수 가드 3종이 공유하므로 셋 모두를 함께 지킨다.
const supabaseAccessPattern = new RegExp(
  [
    // (1) SDK·내부 클라이언트 모듈
    String.raw`['"]@supabase/`,
    String.raw`['"]@/lib/supabase/`,
    String.raw`['"]@/lib/server/supabaseAdmin['"]`,
    String.raw`\bcreateSupabaseServer\b`,
    String.raw`\bcreateServiceRoleClient\b`,
    String.raw`\bcreateBrowserClient\b`,
    String.raw`\bcreateServerClient\b`,
    String.raw`\bSUPABASE_SERVICE_ROLE_KEY\b`,
    String.raw`\bNEXT_PUBLIC_SUPABASE_ANON_KEY\b`,
    // (2) PostgREST 스타일 표 접근(문자열 리터럴 테이블명)
    String.raw`\.from\(\s*['"][a-z_]+['"]\s*\)`,
    // (3) 손으로 부르는 REST
    String.raw`/rest/v1/`,
  ].join('|')
)
// 저장소 전수 가드 3종(Supabase 접근·Supabase Auth 세션 호출·RPC p_user_id)이
// **모두 이 한 목록**을 본다. 예전에는 같은 글롭이 두 번(여기와 파일 끝
// `srcAllFiles`) 따로 적혀 있었고, 하한 장치를 이쪽에만 달았더니 다른 쪽 글롭을
// 좁히는 것만으로 세션 가드·RPC 가드가 통째로 눈머는 구멍이 남았다(수정 2회차).
// 목록이 하나면 하한도 하나뿐이라 "한쪽만 고치는" 실수가 원천적으로 불가능하다.
const srcAllFiles = globSync('src/**/*.@(ts|tsx)', {
  cwd: root,
  exclude: ['**/node_modules/**', '**/.next/**'],
}).sort()
// 주석은 걷어낸다 — 이 저장소는 전환 과정을 주석으로 많이 남겼고(옛 Supabase
// 호출 모양을 그대로 적어둔 곳이 여럿), 원본을 훑으면 그 설명글이 전부 위반으로
// 잡힌다. 반대로 문자열 리터럴은 남긴다: (3)의 REST 경로가 리터럴 안에 있다.
const supabaseAccessOffenders = srcAllFiles.filter(file =>
  supabaseAccessPattern.test(readSourceAt(join(root, file)))
)
// 자기검사 ①: 정규식이 실제로 무는가. 각 항목은 이 저장소에서 실제로 지운
// 코드의 모양이다.
const supabaseAccessSentinels = [
  `import { createClient } from '@supabase/supabase-js'`,
  `import { createServerClient } from '@supabase/ssr'`,
  `const { createClient } = require('@supabase/supabase-js')`,
  `const mod = await import('@supabase/supabase-js')`,
  `import { createSupabaseServer } from '@/lib/supabase/server'`,
  `import { createServiceRoleClient } from '@/lib/server/supabaseAdmin'`,
  `const client = createBrowserClient(url, key)`,
  `await supabase.from('member_profiles').select('id')`,
  `fetch(\`\${url}/rest/v1/system_settings?select=*\`, { headers: { apikey: key } })`,
  `const key = process.env.SUPABASE_SERVICE_ROLE_KEY`,
]
/**
 * **표본 배열 자체가 비면 이 자기검사는 공허하게 통과한다.** 배열을 `[]`로
 * 비우면 `filter`가 빈 배열을 내고 "눈먼 곳 없음"으로 읽힌다 — 컷오버 후
 * 감사에서 실증됐다(둘 다 비우니 전수 가드가 exit 0). 이 저장소가 전환 내내
 * 반복해 당한 유형이라, 개수 하한을 함께 고정한다.
 *
 * 표본을 **줄이려면** 이 숫자도 함께 내려야 하고, 그 커밋이 리뷰에 남는다.
 */
const SUPABASE_ACCESS_SENTINEL_MIN = 10
const SUPABASE_ACCESS_FALSE_POSITIVE_MIN = 3

const supabaseAccessPatternBlindSpots = supabaseAccessSentinels.filter(
  sample => !supabaseAccessPattern.test(sample)
)
// 자기검사 ②: 스캔이 저장소를 **구석구석** 훑었는가.
//
// 예전에는 전체 하한 하나(200)뿐이었는데, `src/app` 단독이 206이라 **가장
// 그럴듯한 부분 고장**(글롭이 `src/app/**`로 좁아짐)이 하한을 넘겨 통과하면서
// `src/lib`·`src/utils`·`src/middleware`·`src/db`·`src/components` 204파일을
// 통째로 건너뛸 수 있었다 — 삭제된 Supabase 클라이언트가 전부 살던 자리다.
// 그래서 서브트리별 하한을 함께 둔다. 전체 수는 파일이 늘면 자연히 여유가
// 생기지만, 서브트리별 하한은 "그 자리가 비는 것"을 직접 잡는다.
//
// 숫자는 현재 개수(주석)의 대략 63~75%다. 대량 삭제가 아니라 "그 서브트리가
// 스캔에서 빠졌다"를 잡는 것이 목적이므로 정상적인 파일 정리로는 걸리지 않고,
// 디렉터리 하나가 통째로 빠지면 걸린다. 실제로 파일을 많이 지웠다면 이 숫자를
// **의도적으로** 낮추는 커밋이 남아야 한다.
const SRC_SCAN_MIN_FILES = 380 // 현재 410
const SRC_SCAN_SUBTREE_MINIMUMS = {
  'src/app/': 150, // 현재 206
  'src/components/': 32, // 현재 50
  'src/utils/': 32, // 현재 49
  'src/lib/': 22, // 현재 34
  'src/db/': 14, // 현재 21
  'src/hooks/': 10, // 현재 16
  'src/types/': 9, // 현재 14
  'src/constants/': 6, // 현재 9
  'src/middleware/': 4, // 현재 7
  'src/i18n/': 2, // 현재 3
}
const srcScanSubtreeShortfalls = Object.entries(SRC_SCAN_SUBTREE_MINIMUMS).flatMap(
  ([prefix, minimum]) => {
    const count = srcAllFiles.filter(file => file.startsWith(prefix)).length
    return count < minimum
      ? [`${prefix} — ${count} file(s) scanned, expected at least ${minimum}`]
      : []
  }
)
// 자기검사 ②-b: 하한표가 src/ 아래 **모든** 서브트리를 덮는가.
//
// 위의 표는 손으로 적은 목록이라, 표에 없는 디렉터리는 통째로 스캔에서 빠져도
// 전체 하한만 넘기면 통과한다 — 수정 2회차 이전의 `src/types`(14)·
// `src/constants`(9)·`src/i18n`(3)이 정확히 그랬다(셋을 다 빼도 384 ≥ 380).
// 그래서 표를 손으로 채우는 대신 **스캔 결과에서 서브트리 목록을 뽑아** 표가
// 그걸 전부 덮는지 확인한다. 새 디렉터리가 생기면 하한을 적으라고 여기서 막힌다.
// (표를 통째로 비워도 이 검사가 전부 미커버로 걸린다 — 빈 표가 조용히
// 통과하는 fail-open이 생기지 않는다. 반대로 스캔 자체가 비면 여기서는 아무것도
// 안 걸리지만, 그 경우는 전체 하한과 서브트리 하한이 먼저 문다.)
// `src/middleware.ts`처럼 src/ 바로 아래 놓인 파일은 서브트리가 아니라서 이
// 목록에서 빠진다. 그 자리를 비워두면 안 된다 — 예전 주석은 "전용 가드가 따로
// 문다"고 적혀 있었지만, 그 전용 가드(middlewareUsesBetterAuthSessionOnly)는
// **SDK import·env 게이트 모양만** 본다. `.from('table')`·`/rest/v1/`·`.auth.*`·
// `p_user_id` 네 모양은 이 파일이 스캔에서 빠지는 순간 아무도 물지 않는다
// (실증: SDK import 없이 `.from('member_profiles')`만 심으면 exit 0). 그래서
// 아래 `srcRootFileCount` 하한을 따로 둔다.
const srcScanUncoveredSubtrees = [
  ...new Set(
    srcAllFiles
      .map(file => file.split('/'))
      .filter(segments => segments.length > 2)
      .map(segments => `${segments[0]}/${segments[1]}/`)
  ),
]
  .filter(prefix => !(prefix in SRC_SCAN_SUBTREE_MINIMUMS))
  .sort()
// 자기검사 ②-c: src/ 바로 아래 놓인 파일(현재 `src/middleware.ts` 1개)이
// 스캔에 남아 있는가. 서브트리 하한표는 이 자리를 구조적으로 덮지 못하는데,
// 하필 그 파일이 유지보수·인증 판정 전체를 쥐고 있다. 글롭이 `src/*/**`로
// 좁아지면(흔한 실수다) 여기서 막힌다.
const SRC_ROOT_MIN_FILES = 1 // 현재 1 (src/middleware.ts)
const srcRootFileCount = srcAllFiles.filter(file => file.split('/').length === 2).length
// 자기검사 ③: 패턴이 Drizzle 쿼리 계층(식별자 `.from(comments)`)이나 전환
// 기록 주석을 오탐하면, 아무도 이 가드를 못 지켜 결국 예외 목록이 생긴다.
const supabaseAccessFalsePositiveSamples = [
  `const rows = await db.select().from(comments).where(eq(comments.postId, postId))`,
  `// 예전에는 supabase.from('comments')를 직접 읽었다`,
  `const client = createClient({ url: process.env.TURSO_DATABASE_URL })`,
]
const supabaseAccessOverreach = supabaseAccessFalsePositiveSamples.filter(sample =>
  supabaseAccessPattern.test(stripComments(sample))
)

if (supabaseAccessSentinels.length < SUPABASE_ACCESS_SENTINEL_MIN) {
  failures.push(
    `src/ Supabase 전수 가드의 양성 표본이 ${supabaseAccessSentinels.length}개다 — ` +
      `${SUPABASE_ACCESS_SENTINEL_MIN}개 이상이어야 한다. 표본이 비면 "패턴에 눈먼 곳이 ` +
      `없다"는 자기검사가 공허하게 통과한다. 줄이려면 상수도 함께 내려라.`
  )
}
if (supabaseAccessFalsePositiveSamples.length < SUPABASE_ACCESS_FALSE_POSITIVE_MIN) {
  failures.push(
    `src/ Supabase 전수 가드의 오탐 표본이 ${supabaseAccessFalsePositiveSamples.length}개다 — ` +
      `${SUPABASE_ACCESS_FALSE_POSITIVE_MIN}개 이상이어야 한다. 표본이 비면 "정당한 Drizzle ` +
      `코드를 오탐하지 않는다"는 자기검사가 공허하게 통과한다.`
  )
}

// ---------------------------------------------------------------------------
// `scripts/` 아래에서 Supabase를 건드리는 코드가 새로 생기는 것을 막는다.
//
// 위 가드는 `src/`만 본다. 그런데 컷오버 감사가 찾아낸 실제 피해는 `scripts/`
// 쪽이었다: **실행하면 에러 없이 성공 메시지를 내고 아무것도 하지 않는**
// 스크립트가 30개 넘게 남아 있었다. `npm run storage:ensure-webp`는 Turso에
// 존재하지도 않는 `member_profiles.profile_photo_url`을 갱신했고,
// `clear-link-preview-cache.js`는 지금도 쓰이는 캐시를 "지웠다"고 찍었으며,
// `verify-activity-system.js`는 버려진 사본에 `=== 검증 완료 ===`를 줬다.
// 조용한 성공이 이 저장소에서 가장 비싼 실패다.
//
// 그것들을 막고 있던 것은 설계가 아니라 우연이었다 — `dotenv` 미설치,
// `.env.local`의 큰따옴표를 손수 만든 파서가 못 벗기는 것, `__dirname/.env.local`
// 경로 오류. `npm i dotenv` 한 번이나 `set -a; source .env.local; set +a`
// (`scripts/turso/README.md`가 DB 작업 전에 하라고 안내하는 바로 그 명령)면
// 세 우연이 전부 사라진다. 그래서 우연 대신 구조로 막는다.
//
// 이 가드는 **목록이 아니라 모양**을 고정한다. `scripts/` 아래에서 Supabase를
// 건드리는 파일은 셋 중 하나여야 한다:
//   (1) **무해화돼 있다** — 실행하면 DB에 닿기 전에 메시지를 내고 즉시 나간다.
//   (2) **허용목록에 이유와 함께 올라 있다** — 조회 전용 이관·검증 도구.
//       Supabase는 컷오버 후 1주 관찰 뒤 삭제 예정이라, 그 기간에 Supabase를
//       읽는 정당한 도구가 있다.
//   (3) 그 밖에는 없다. **쓰기는 허용목록에 올릴 수 없다**(아래에서 강제한다).
//
// 패턴은 정규식 하나로 적지 않고 **이름 붙은 가지 목록**으로 적는다. 아래
// 자기검사가 "가지마다 그것을 무는 양성 표본이 최소 하나 있는가"를 확인하는데,
// 통짜 정규식으로는 그걸 못 한다. 표본 배열을 통째로 비우면 표본별 검사
// (`filter`)는 **빈 배열이라 조용히 통과**한다 — 실제로 이 가드 초안이 그
// 구멍을 갖고 있었고(표본 두 배열을 비웠더니 초록불), 가지별 대조가 그걸 막는다.
const SCRIPTS_SUPABASE_CLIENT_ALTERNATIVES = [
  { label: 'Supabase SDK import/require', source: String.raw`['"]@supabase/` },
  { label: 'service-role key', source: String.raw`\bSUPABASE_SERVICE_ROLE_KEY\b` },
  { label: 'anon key', source: String.raw`\bNEXT_PUBLIC_SUPABASE_ANON_KEY\b` },
  // SDK 없이 손으로 부르는 PostgREST/GoTrue REST
  { label: 'hand-rolled /rest/v1/ call', source: String.raw`/rest/v1/` },
]
const SCRIPTS_SUPABASE_CLIENT_PATTERN = new RegExp(
  SCRIPTS_SUPABASE_CLIENT_ALTERNATIVES.map(alternative => alternative.source).join('|')
)
// "쓰기"의 범위: 표 변경(insert/update/upsert/delete) · 스토리지 변경
// (upload/remove/버킷 조작) · RPC(임의 SQL을 실행하던 `exec_sql`이 실재했다) ·
// GoTrue admin API(계정 생성·삭제) · 손으로 부르는 REST의 쓰기 메서드.
//
// 표 변경은 `.from(...)`에서 시작하는 **연쇄**로만 문다. `.update(` 단독으로
// 물면 `createHash('sha256').update(buf)`가 걸려, 실제로는 Vercel Blob에만
// 쓰는 이관 도구 두 개(`copy-to-blob.mjs`·`copy-private-objects.mjs`)가
// "Supabase에 쓴다"는 이유로 허용목록에 올라가게 된다 — 허용목록이 거짓말을
// 담기 시작하면 그 순간부터 아무도 안 읽는다.
const SCRIPTS_SUPABASE_WRITE_ALTERNATIVES = [
  {
    label: 'PostgREST table write chain',
    source: String.raw`\.from\([^)]{0,120}\)[\s\S]{0,240}?\.(insert|update|upsert|delete|remove|upload)\s*\(`,
  },
  {
    label: 'storage bucket admin',
    source: String.raw`\.(createBucket|updateBucket|emptyBucket|deleteBucket)\s*\(`,
  },
  { label: 'RPC call', source: String.raw`\.rpc\s*\(` },
  { label: 'GoTrue admin API', source: String.raw`\.auth\.admin\.` },
  {
    label: 'hand-rolled REST write method',
    source: String.raw`method:\s*['"](POST|PATCH|PUT|DELETE)['"]`,
  },
]
const SCRIPTS_SUPABASE_WRITE_PATTERN = new RegExp(
  SCRIPTS_SUPABASE_WRITE_ALTERNATIVES.map(alternative => alternative.source).join('|')
)

// 스캔에서 빼는 파일은 **이 가드 자신 하나뿐**이다. 아래 sentinel 배열이 금지
// 모양을 소스에 그대로 담고 있어서(그게 sentinel의 존재 이유다) 자기 자신을
// 위반으로 문다. 문자열을 쪼개 붙여 패턴을 피해 가는 방법도 있지만, 그러면
// sentinel이 "실제 코드 모양"이기를 그만두고 가드가 눈머는 것을 못 잡게 된다.
//
// **이 예외가 "이 파일은 패턴에 걸리니까 빼자"로 정당화되지 않는다는 점에
// 주의하라.** 초안은 그렇게 적었다가 거짓 안심을 샀다: sentinel을 전부 지운
// 뒤에도 이 파일은 여전히 쓰기 패턴에 걸렸다(오탐 표본 두 개가 240자 창 안에서
// 우연히 연쇄를 이뤘다). 즉 "걸린다"는 사실은 sentinel이 살아 있다는 증거가
// 못 된다. 그 증거는 아래 가지별 대조가 댄다.
const SCRIPTS_SCAN_SELF = 'scripts/testing/assert-runtime-risks.mjs'

// (c) 판정 — Supabase를 **조회만** 하는 정당한 도구. 이유 없이는 못 올린다.
const SCRIPTS_SUPABASE_ALLOWLIST = [
  {
    path: 'scripts/migrate/copy-private-objects.mjs',
    reason:
      'Supabase Storage board-documents 버킷을 읽어 Vercel Blob과 SHA-256으로 대조한다. ' +
      '쓰기는 Blob 쪽에만 한다. package.json의 storage:verify-private/storage:copy-private가 ' +
      '이걸 부르고, Supabase 삭제 전까지 "이관이 정말 끝났는가"를 증명하는 유일한 도구다.',
  },
  {
    path: 'scripts/storage/copy-to-blob.mjs',
    reason:
      '공개 버킷(attachments·artists)을 읽어 Vercel Blob과 대조·복사한다(--verify는 대조만). ' +
      '위와 같은 이유로 Supabase 삭제 전까지 남긴다.',
  },
  {
    path: 'scripts/migrate/identity.mjs',
    reason:
      '단계 2b 인증 이관 도구. Supabase 덤프/GoTrue에서 계정을 읽어 Turso로 옮긴 기록이자 재현 수단이다.',
  },
  {
    path: 'scripts/testing/refresh-schema-snapshot.mjs',
    reason:
      '운영 Supabase의 PostgREST OpenAPI를 읽어 schema-snapshot.json을 만든다(조회 전용). ' +
      'Supabase가 살아 있는 동안 옛 스키마 계약을 다시 뜰 수 있어야 한다.',
  },
  {
    path: 'scripts/verify-env.js',
    reason:
      '환경변수 검사기. NEXT_PUBLIC_SUPABASE_URL 등 이름만 다루고 Supabase에 접속하지 않는다.',
  },
  {
    path: 'scripts/testing/auth-config.test.mjs',
    reason: '단위 테스트. Supabase 시절 인증 설정 문자열을 픽스처로 담는다(접속 없음).',
  },
  {
    path: 'scripts/testing/middleware-profile.test.mjs',
    reason: '단위 테스트. 미들웨어가 Supabase를 더 이상 부르지 않음을 단정하는 픽스처다.',
  },
  {
    path: 'scripts/testing/middleware-settings.test.mjs',
    reason:
      '단위 테스트. 유지보수 모드 판정이 Supabase가 아니라 Turso system_settings를 읽는지 단정하는 픽스처다(접속 없음).',
  },
  {
    path: 'scripts/testing/strip-comments.test.mjs',
    reason: '단위 테스트. 옛 정규식 구현이 지웠던 Supabase import 줄을 회귀 표본으로 담는다.',
  },
  {
    path: 'scripts/testing/verifyEnv.test.mjs',
    reason: '단위 테스트. verify-env.js가 죽은 Supabase 키 없이도 통과하는지 본다(접속 없음).',
  },
]
const scriptsSupabaseAllowedPaths = new Set(SCRIPTS_SUPABASE_ALLOWLIST.map(entry => entry.path))

const scriptsAllFiles = globSync('scripts/**/*.@(js|mjs|cjs|ts)', {
  cwd: root,
  exclude: ['**/node_modules/**'],
}).sort()

/**
 * "이 파일은 실행되면 DB에 닿기 전에 나가는가"를 **구조로** 판정한다.
 *
 * 문자열 검사(`/process\.exit\(1\)/.test(source)`)로는 안 된다. 이 스크립트들은
 * 거의 전부 `if (!supabaseUrl) { console.error(...); process.exit(1) }` 같은
 * 환경변수 가드를 이미 갖고 있어서, 그 한 줄만으로 "무해화됐다"가 참이 돼버린다
 * — 환경변수가 채워지면 그 분기는 안 타고 스크립트는 그대로 진행한다.
 *
 * 그래서 TypeScript 파서로 **최상위 문(statement) 목록**을 뽑아, 중단이
 * 실행 흐름의 맨 앞에 있는지 본다. 중단보다 먼저 올 수 있는 것은 `import`
 * 선언과 `console.error(...)` 뿐이다. CommonJS의 `require` 대입은
 * VariableStatement라 여기 못 들어온다 — CJS 스크립트는 `require`보다 앞에
 * 중단이 와야 한다는 뜻이고, 그게 맞다.
 *
 * 인정하는 중단 모양은 둘이다.
 *   A. 최상위 `process.exit(1)` — `scripts/archive/supabase-board/`의 선례.
 *   B. `if (process.argv[1]?.endsWith('<이 파일 이름>')) { ... process.exit(1) }`
 *      — 순수 함수를 export하고 `scripts/testing/`의 단위 테스트가 그걸
 *      import하는 하이브리드 모듈용이다(`storage/rewrite-db-urls.mjs`·
 *      `restore-db-urls.mjs`). 최상위에서 나가면 테스트 스위트가 통째로 죽는다.
 *      **파일 이름까지 대조한다** — 다른 파일 이름을 적어 두면 조건이 영원히
 *      거짓이라 "무해화된 것처럼 보이지만 그냥 실행되는" 모양이 된다.
 *
 * 그리고 중단에는 반드시 사람이 읽을 메시지(`console.error`)가 붙어야 한다.
 * 말없이 exit 1만 하면 "왜 안 되는지"를 아무도 모르고, 그건 조용한 성공만큼
 * 나쁜 조용한 실패다.
 */
function diagnoseScriptHalt(file, strippedSource) {
  const sourceFile = ts.createSourceFile(
    file,
    strippedSource,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  )
  const statements = sourceFile.statements
  const textOf = statement =>
    strippedSource.slice(statement.getStart(sourceFile, false), statement.end).trim()

  let haltIndex = -1
  for (let i = 0; i < statements.length; i += 1) {
    if (/process\.exit\(1\)/.test(textOf(statements[i]))) {
      haltIndex = i
      break
    }
  }
  if (haltIndex === -1) {
    return '최상위 실행 흐름에 process.exit(1) 중단이 없다'
  }

  const halt = statements[haltIndex]
  const haltText = textOf(halt)
  const selfName = basename(file).replace(/[.]/g, '\\.')
  const entryGuardPattern = new RegExp(
    String.raw`^if\s*\(\s*process\.argv\[1\]\?\.endsWith\(\s*['"]${selfName}['"]\s*\)\s*\)\s*\{[\s\S]*\}$`
  )
  const isBareExit = /^process\.exit\(1\)\s*;?$/.test(haltText)
  const isEntryGuard = ts.isIfStatement(halt) && entryGuardPattern.test(haltText)
  if (!isBareExit && !isEntryGuard) {
    return `중단 모양을 인정할 수 없다(최상위 process.exit(1) 또는 진입점 조건문이어야 한다): ${haltText.slice(0, 120).replace(/\s+/g, ' ')}`
  }

  const precedingTexts = []
  for (let i = 0; i < haltIndex; i += 1) {
    const statement = statements[i]
    const text = textOf(statement)
    if (ts.isImportDeclaration(statement)) {
      precedingTexts.push(text)
      continue
    }
    if (ts.isExpressionStatement(statement) && /^console\.error\(/.test(text)) {
      precedingTexts.push(text)
      continue
    }
    return `중단보다 먼저 실행되는 문이 있다(import와 console.error만 앞설 수 있다): ${text.slice(0, 120).replace(/\s+/g, ' ')}`
  }

  const hasMessage =
    /console\.error\(/.test(haltText) || precedingTexts.some(text => /^console\.error\(/.test(text))
  if (!hasMessage) {
    return '중단에 console.error 안내 메시지가 없다 — 왜 막혔는지 알 수 없는 조용한 실패가 된다'
  }
  return null
}

const scriptsSupabaseTouching = []
for (const file of scriptsAllFiles) {
  if (file === SCRIPTS_SCAN_SELF) continue
  const source = readSourceAt(join(root, file))
  if (!SCRIPTS_SUPABASE_CLIENT_PATTERN.test(source)) continue
  scriptsSupabaseTouching.push({
    file,
    writes: SCRIPTS_SUPABASE_WRITE_PATTERN.test(source),
    haltProblem: diagnoseScriptHalt(file, source),
  })
}

// 위반 ①: 무해화도 안 됐고 허용목록에도 없는 파일.
const scriptsSupabaseUnguarded = scriptsSupabaseTouching
  .filter(entry => entry.haltProblem !== null && !scriptsSupabaseAllowedPaths.has(entry.file))
  .map(entry => `${entry.file} — ${entry.writes ? '쓰기' : '조회'}: ${entry.haltProblem}`)
// 위반 ②: **쓰기**를 허용목록으로 빠져나가려는 시도. 허용목록은 조회 전용이다.
const scriptsSupabaseAllowlistedWrites = scriptsSupabaseTouching
  .filter(entry => entry.writes && scriptsSupabaseAllowedPaths.has(entry.file))
  .map(entry => entry.file)
// 위반 ③: 낡은 허용목록 항목. 파일이 없어졌거나 더 이상 Supabase를 안 건드리면
// 그 항목은 다음 사람에게 "여긴 원래 예외"라는 잘못된 신호만 남긴다.
const scriptsSupabaseTouchingPaths = new Set(scriptsSupabaseTouching.map(entry => entry.file))
const scriptsSupabaseStaleAllowlist = SCRIPTS_SUPABASE_ALLOWLIST.filter(
  entry => !scriptsSupabaseTouchingPaths.has(entry.path)
).map(entry =>
  existsSync(join(root, entry.path))
    ? `${entry.path} — 더 이상 Supabase를 건드리지 않는다(항목을 지워라)`
    : `${entry.path} — 파일이 없다(항목을 지워라)`
)
// 위반 ④: 이유 없는 허용목록 항목.
const scriptsSupabaseUnexplainedAllowlist = SCRIPTS_SUPABASE_ALLOWLIST.filter(
  entry => typeof entry.reason !== 'string' || entry.reason.trim().length < 20
).map(entry => entry.path)

// --- 이하 fail-open 방지. 스캔이 비면 offenders도 비어 조용히 통과한다. ---
//
// 자기검사 ①: 패턴이 알려진 양성 표본을 실제로 무는가. 각 항목은 이 저장소에서
// 실제로 무해화한 코드의 모양이다(파일 이름을 주석에 적어 둔다 — 모양이 어디서
// 왔는지 모르면 다음 사람이 "안 쓰는 것 같다"며 지운다).
const scriptsSupabaseClientSentinels = [
  `const { createClient } = require('@supabase/supabase-js')`, // scripts/clear-link-preview-cache.js
  `import { createClient } from '@supabase/supabase-js'`, // scripts/storage/rewrite-db-urls.mjs
  `const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY`, // scripts/utils/storage/ensure-supabase-webp.js
  `const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY`, // scripts/database/setup/add-is-member-column.js
  `const res = await fetch(url + '/rest/v1/rpc/execute_sql', { headers })`, // scripts/one-off/final-sql-execution.js
]
const scriptsSupabaseWriteSentinels = [
  `await supabase.from('member_profiles').update({ profile_photo_url: webp }).eq('id', userId)`, // ensure-supabase-webp.js
  `await supabase.from('user_activities').insert(rows)`, // generate-test-activity-data.js
  `await supabase.from('link_previews').delete().eq('url', url)`, // clear-link-preview-cache.js
  `await supabase.from('posts').upsert(rows)`,
  `await supabase.storage.from('profiles').upload(path, buffer, { upsert: true })`, // ensure-supabase-webp.js
  `await supabase.storage.from('attachments').remove([key])`,
  `await supabase.storage.createBucket('profiles', { public: true })`, // scripts/database/setup/create-storage-bucket-direct.js
  `await supabase.rpc('exec_sql', { sql_query: sql })`, // scripts/database/apply-activity-fix.js
  `await supabase.auth.admin.deleteUser(userId)`,
  `await fetch(url + '/rest/v1/posts', { method: 'PATCH', body })`,
]
const scriptsSupabaseClientBlindSpots = scriptsSupabaseClientSentinels.filter(
  sample => !SCRIPTS_SUPABASE_CLIENT_PATTERN.test(sample)
)
const scriptsSupabaseWriteBlindSpots = scriptsSupabaseWriteSentinels.filter(
  sample => !SCRIPTS_SUPABASE_WRITE_PATTERN.test(sample)
)
// 자기검사 ①-b: **패턴의 가지마다** 그것을 무는 표본이 있는가.
//
// 위 ①은 표본을 순회하므로 **표본 배열이 비면 빈 결과로 조용히 통과한다.**
// 실증: 두 sentinel 배열을 `[]`로 만들어도 초록불이었다. 그 상태에서는 패턴을
// 통째로 망가뜨려도 아무도 안 문다. 여기서는 반대 방향으로 — 가지에서 표본으로 —
// 대조하므로 배열을 비우면 모든 가지가 미검증으로 걸린다. 가지를 새로 추가할
// 때 표본을 함께 적으라고 막는 효과도 있다(그게 없으면 새 가지는 영원히
// 검증되지 않은 채로 남는다).
const scriptsSupabaseAllSentinels = [
  ...scriptsSupabaseClientSentinels,
  ...scriptsSupabaseWriteSentinels,
]
const scriptsSupabaseUnexercisedAlternatives = [
  ...SCRIPTS_SUPABASE_CLIENT_ALTERNATIVES.map(alternative => ({
    ...alternative,
    kind: 'client',
  })),
  ...SCRIPTS_SUPABASE_WRITE_ALTERNATIVES.map(alternative => ({ ...alternative, kind: 'write' })),
]
  .filter(alternative => {
    const branch = new RegExp(alternative.source)
    return !scriptsSupabaseAllSentinels.some(sample => branch.test(sample))
  })
  .map(alternative => `${alternative.kind}: ${alternative.label}`)
// 자기검사 ②: 패턴이 Turso/Drizzle 코드나 전환 기록 주석을 오탐하면, 정당한
// 파일이 허용목록으로 밀려나 목록이 부풀고 결국 아무도 안 읽는다. 주석 표본은
// `stripComments`를 통과시켜 검사한다 — 이 가드가 실제로 보는 것과 같게.
const scriptsSupabaseFalsePositiveSamples = [
  `const digest = createHash('sha256').update(buffer).digest('hex')`,
  `await db.update(memberProfiles).set({ isAdmin: true }).where(eq(memberProfiles.id, id))`,
  `const rows = await db.select().from(memberProfiles).where(eq(memberProfiles.id, id))`,
  `await client.execute({ sql: 'update member_profiles set is_admin = 1', args: [] })`,
  `// 예전에는 supabase.from('posts').update({ content }) 를 직접 불렀다`,
  `// const { createClient } = require('@supabase/supabase-js')`,
]
const scriptsSupabaseOverreach = scriptsSupabaseFalsePositiveSamples.filter(sample => {
  const stripped = stripComments(sample)
  return (
    SCRIPTS_SUPABASE_CLIENT_PATTERN.test(stripped) || SCRIPTS_SUPABASE_WRITE_PATTERN.test(stripped)
  )
})
// ②도 표본을 순회하므로 배열을 비우면 조용히 통과한다. 여기서는 가지별로
// 뒤집을 대상이 없으므로(오탐은 "어떤 가지도 물면 안 된다"이다) 개수 하한으로
// 못박는다. 마지막 둘은 **주석 표본**이라 반드시 남아야 한다 — 이 저장소가
// 반복해 밟은 함정이 "주석에 매치해 초록불"이고, 무해화 배너 자체가 금지
// 모양을 그대로 인용하고 있어서 주석 처리가 무너지면 전 파일이 오탐으로 뒤집힌다.
const SCRIPTS_FALSE_POSITIVE_MIN_SAMPLES = 6 // 현재 6
const scriptsSupabaseFalsePositiveCommentSamples = scriptsSupabaseFalsePositiveSamples.filter(
  sample => /^\s*\/\//.test(sample)
).length
const SCRIPTS_FALSE_POSITIVE_MIN_COMMENT_SAMPLES = 2 // 현재 2
// 자기검사 ③: 자기 제외가 여전히 **글롭 안의 파일**을 가리키는가. 경로가
// 어긋나면 예외가 아무것도 빼지 않게 되고(그 경우 이 파일이 위반으로 잡혀
// 바로 드러난다), 반대로 글롭이 이 파일을 놓치면 예외만 남아 의미를 잃는다.
//
// 예전 초안은 여기서 "이 파일이 패턴에 걸리는가"까지 확인하며 그걸 sentinel이
// 살아 있다는 증거로 삼았다. **거짓이었다** — sentinel을 전부 지워도 오탐 표본
// 두 개가 240자 창 안에서 우연히 `.from(...)....update(` 연쇄를 이뤄 여전히
// 걸렸다. sentinel의 생사는 자기검사 ①-b(가지별 대조)가 판정한다.
const scriptsScanSelfIsInScan = scriptsAllFiles.includes(SCRIPTS_SCAN_SELF)
// 자기검사 ③-b: 이 스캔이 읽는 확장자에서 주석이 실제로 걷히는가.
// (위 `shouldStripComments`의 주석 참고 — 이 목록이 줄어들면 오탐으로 뒤집힌다.)
const scriptsSourceReaderStripExpectations = [
  ['scripts/x.js', true],
  ['scripts/x.mjs', true],
  ['scripts/x.cjs', true],
  ['src/x.ts', true],
  ['src/x.tsx', true],
  ['README.md', false], // stripComments는 .md에서 fail-closed로 던진다 — 걷으면 안 된다
  ['package.json', false],
]
const scriptsSourceReaderStripMismatches = scriptsSourceReaderStripExpectations
  .filter(([path, expected]) => shouldStripComments(path) !== expected)
  .map(([path, expected]) => `${path} — expected stripComments=${expected}`)
// 자기검사 ③-c: 패턴 가지를 통째로 지워 가드를 좁히는 길을 막는다. 가지를
// 지우면 그 모양은 영원히 검증되지 않고, 자기검사 ①-b는 "남은 가지"만 보므로
// 침묵한다(지운 가지는 목록에 없으니 미검증으로도 안 잡힌다).
const SCRIPTS_CLIENT_ALTERNATIVE_MIN = 4 // 현재 4
const SCRIPTS_WRITE_ALTERNATIVE_MIN = 5 // 현재 5
// 자기검사 ④: 스캔이 `scripts/`를 구석구석 훑었는가. `src/` 가드와 같은 구조로
// 전체 하한·서브트리별 하한·하한표의 커버리지를 함께 본다. `scripts/testing`
// 하나가 전체의 절반이라, 전체 하한만 두면 다른 디렉터리가 통째로 빠져도
// 통과한다 — 하필 무해화한 파일들이 전부 그 "다른 디렉터리"에 있다.
const SCRIPTS_SCAN_MIN_FILES = 100 // 현재 147
const SCRIPTS_SCAN_SUBTREE_MINIMUMS = {
  'scripts/archive/': 5, // 현재 8
  'scripts/auth/': 1, // 현재 1
  'scripts/database/': 15, // 현재 23
  'scripts/migrate/': 5, // 현재 8
  'scripts/one-off/': 2, // 현재 4
  'scripts/perf/': 1, // 현재 2
  'scripts/recovery/': 1, // 현재 1
  'scripts/storage/': 2, // 현재 3
  'scripts/testing/': 47, // 현재 71
  'scripts/ticketing/': 1, // 현재 1 (공연 등록 도구)
  'scripts/turso/': 4, // 현재 7
  'scripts/utils/': 11, // 현재 17
}
const scriptsScanSubtreeShortfalls = Object.entries(SCRIPTS_SCAN_SUBTREE_MINIMUMS).flatMap(
  ([prefix, minimum]) => {
    const count = scriptsAllFiles.filter(file => file.startsWith(prefix)).length
    return count < minimum
      ? [`${prefix} — ${count} file(s) scanned, expected at least ${minimum}`]
      : []
  }
)
const scriptsScanUncoveredSubtrees = [
  ...new Set(
    scriptsAllFiles
      .map(file => file.split('/'))
      .filter(segments => segments.length > 2)
      .map(segments => `${segments[0]}/${segments[1]}/`)
  ),
]
  .filter(prefix => !(prefix in SCRIPTS_SCAN_SUBTREE_MINIMUMS))
  .sort()
// `scripts/` 바로 아래 놓인 파일(현재 `clear-link-preview-cache.js`·
// `verify-env.js` 2개)은 서브트리 하한표가 구조적으로 못 덮는다. 글롭이
// `scripts/*/**`로 좁아지면(흔한 실수다) 둘 다 조용히 빠진다 — 한쪽은
// 무해화 대상이고 다른 쪽은 허용목록 항목이라 둘 다 빠지면 위반 ③까지
// 함께 침묵한다.
const SCRIPTS_ROOT_MIN_FILES = 2 // 현재 2
const scriptsRootFileCount = scriptsAllFiles.filter(file => file.split('/').length === 2).length

const imageProxyPath = join(root, 'src/app/api/images/proxy/route.ts')
const imageProxySource = readSourceAt(imageProxyPath)
const postViewPath = join(root, 'src/app/api/posts/[id]/view/route.ts')
const postViewSource = readSourceAt(postViewPath)
const postDetailClientPath = join(root, 'src/app/[locale]/board/[id]/PostDetailClient.tsx')
const postDetailClientSource = readSourceAt(postDetailClientPath)
const mypageProfilePersonalInfoPath = join(
  root,
  'src/app/[locale]/mypage/profile/components/PersonalInfo.tsx'
)
const mypageProfilePersonalInfoSource = readSourceAt(mypageProfilePersonalInfoPath)
const mypageProfileEditFormPath = join(
  root,
  'src/app/[locale]/mypage/profile/components/ProfileEditForm.tsx'
)
const mypageProfileEditFormSource = readSourceAt(mypageProfileEditFormPath)
const mypageArtistPagePath = join(root, 'src/app/[locale]/mypage/artist/page.tsx')
const mypageArtistPageSource = readSourceAt(mypageArtistPagePath)
// 단계 2c(Task 5): DELETE 핸들러의 관리자 판정을 Supabase
// `.select('is_admin, registration_status, is_active').eq('id', user.id)`에서
// Turso 쿼리 계층 getProfileById(user.id)로 옮겼다(GET 핸들러는 Task 4에서
// 이미 같은 전환을 마쳤다). 조건식(prof?.is_admin && ... === 'approved' &&
// prof.is_active) 리터럴은 두 핸들러 모두 그대로다.
const validatesPostDetailAdminStatus =
  /getProfileById\(user\.id\)/.test(postDetailSource) &&
  /prof\?\.is_admin && prof\.registration_status === ['"]approved['"] && prof\.is_active/.test(
    postDetailSource
  )
const apiWrapperPath = join(root, 'src/utils/apiWrapper.ts')
const apiWrapperSource = readSourceAt(apiWrapperPath)
const apiResponsePath = join(root, 'src/utils/apiResponse.ts')
const apiResponseSource = readSourceAt(apiResponsePath)
const queryParamsPath = join(root, 'src/utils/queryParams.ts')
const queryParamsSource = readSourceAt(queryParamsPath)
const safeUrlPath = join(root, 'src/utils/safeUrl.ts')
const safeUrlSource = readSourceAt(safeUrlPath)
const imageUrlPath = join(root, 'src/utils/imageUrl.ts')
const imageUrlSource = readSourceAt(imageUrlPath)
const cspReportPath = join(root, 'src/app/api/security/csp-report/route.ts')
const cspReportSource = readSourceAt(cspReportPath)
const structuredDataPath = join(root, 'src/utils/structuredData.tsx')
const structuredDataSource = readSourceAt(structuredDataPath)
const advancedFilteringPath = join(root, 'src/utils/advancedFiltering.ts')
const advancedFilteringSource = readSourceAt(advancedFilteringPath)
const activityLoggerPath = join(root, 'src/utils/activityLogger.ts')
const activityLoggerSource = readSourceAt(activityLoggerPath)
const boardPagePath = join(root, 'src/app/[locale]/board/page.tsx')
const boardPageSource = readSourceAt(boardPagePath)
const projectsPagePath = join(root, 'src/app/[locale]/projects/page.tsx')
const projectsPageSource = readSourceAt(projectsPagePath)
const cooperativeInfoPath = join(
  root,
  'src/app/[locale]/mypage/profile/components/CooperativeInfo.tsx'
)
const cooperativeInfoSource = readSourceAt(cooperativeInfoPath)
const adminSettingsPagePath = join(root, 'src/app/[locale]/admin/settings/page.tsx')
const adminSettingsPageSource = readSourceAt(adminSettingsPagePath)
const adminMembersPagePath = join(root, 'src/app/[locale]/admin/members/page.tsx')
const adminMembersPageSource = readSourceAt(adminMembersPagePath)
const adminMembersRefreshAvoidsUrlCachebuster =
  /(?:cache:\s*|fetchOptions\.cache\s*=\s*)['"]no-store['"]/.test(adminMembersPageSource) &&
  /Cache-Control['"]?\s*:\s*['"]no-cache, no-store, must-revalidate['"]/.test(
    adminMembersPageSource
  ) &&
  !/params\.append\(['"]_t['"]/.test(adminMembersPageSource) &&
  !/_t['"]?,\s*Date\.now\(\)/.test(adminMembersPageSource)
const adminNotificationsPagePath = join(root, 'src/app/[locale]/admin/notifications/page.tsx')
const adminNotificationsPageSource = readSourceAt(adminNotificationsPagePath)
const adminReportGeneratorPath = join(root, 'src/app/[locale]/admin/components/ReportGenerator.tsx')
const adminReportGeneratorSource = readSourceAt(adminReportGeneratorPath)
const adminReportGenerateApiPath = join(root, 'src/app/api/admin/reports/generate/route.ts')
const adminReportGenerateApiSource = readSourceAt(adminReportGenerateApiPath)
const recentActivityPath = join(root, 'src/app/[locale]/admin/components/RecentActivity.tsx')
const recentActivitySource = readSourceAt(recentActivityPath)
const activityAnalyticsChartsPath = join(
  root,
  'src/app/[locale]/admin/components/ActivityAnalyticsCharts.tsx'
)
const activityAnalyticsChartsSource = readSourceAt(activityAnalyticsChartsPath)
const mypageSecuritySettingsPath = join(
  root,
  'src/app/[locale]/mypage/settings/components/SecuritySettings.tsx'
)
const mypageSecuritySettingsSource = readSourceAt(mypageSecuritySettingsPath)
const mypagePreferenceSettingsPath = join(
  root,
  'src/app/[locale]/mypage/settings/components/PreferenceSettings.tsx'
)
const mypagePreferenceSettingsSource = readSourceAt(mypagePreferenceSettingsPath)
const mypageInterfaceSettingsPath = join(
  root,
  'src/app/[locale]/mypage/settings/components/InterfaceSettings.tsx'
)
const mypageInterfaceSettingsSource = readSourceAt(mypageInterfaceSettingsPath)
const parsesApiWrapperPaginationSafely =
  /parseIntegerParam\(searchParams\.get\(['"]page['"]\),\s*1,\s*\{\s*min:\s*1\s*\}\)/.test(
    apiWrapperSource
  ) &&
  /parseIntegerParam\(searchParams\.get\(['"]limit['"]\),\s*defaultLimit,\s*\{[\s\S]*?min:\s*1,[\s\S]*?max:\s*maxLimit,[\s\S]*?\}\)/.test(
    apiWrapperSource
  )
const validatesApiWrapperSortFields =
  /const safeFields = allowedFields\.length > 0 \? allowedFields : \[defaultOrderBy\]/.test(
    apiWrapperSource
  ) &&
  /if \(!safeFields\.includes\(orderBy\)\)/.test(apiWrapperSource) &&
  !/if \(allowedFields\.length > 0 && !allowedFields\.includes\(orderBy\)\)/.test(apiWrapperSource)
const avoidsApiWrapperRequireAdminNameCollision =
  /export function requireAdminRole\(userRole\?: string\): void/.test(apiWrapperSource) &&
  !/export function requireAdmin\(userRole\?: string\): void/.test(apiWrapperSource)
const parsesIntegerParamsAsWholeStrings =
  queryParamsSource.includes('/^[+-]?\\d+$/') &&
  !/const\s+parsed\s*=\s*Number\.parseInt\(value\s*\|\|/.test(queryParamsSource)
const sanitizesDownloadFilenames =
  /function sanitizeDownloadFilename/.test(apiResponseSource) &&
  /replace\(\s*\/\[\\r\\n"\]\/g,\s*['"]['"]\s*\)/.test(apiResponseSource) &&
  /replace\(\s*\/\[\\\\\/\]\/g,\s*['"]_['"]\s*\)/.test(apiResponseSource) &&
  /const safeFilename = sanitizeDownloadFilename\(filename\)/.test(apiResponseSource) &&
  /filename="\$\{safeFilename\}"/.test(apiResponseSource) &&
  /encodeURIComponent\(safeFilename\)/.test(apiResponseSource) &&
  !/filename="\$\{filename\}"/.test(apiResponseSource)
const sanitizesCspReportFields =
  /function getReportObject/.test(cspReportSource) &&
  /function sanitizeReportString/.test(cspReportSource) &&
  /function sanitizeReportNumber/.test(cspReportSource) &&
  cspReportSource.includes("const cspReport = getReportObject(report?.['csp-report'])") &&
  /sanitizeReportString\(cspReport\[['"]document-uri['"]\]\)\.replace/.test(cspReportSource) &&
  /sanitizeReportString\(cspReport\[['"]blocked-uri['"]\]\)\.replace/.test(cspReportSource) &&
  /sanitizeReportNumber\(cspReport\[['"]line-number['"]\]\)/.test(cspReportSource) &&
  /Number\.isFinite\(value\)/.test(cspReportSource) &&
  !/cspReport\[['"]document-uri['"]\]\?\.replace/.test(cspReportSource) &&
  !/lineNumber:\s*cspReport\[['"]line-number['"]\]/.test(cspReportSource)
const postsApiParsesPaginationSafely =
  /parseIntegerParam\(searchParams\.get\(['"]limit['"]\),\s*20,\s*\{\s*min:\s*1,\s*max:\s*50\s*\}\)/.test(
    postsApiSource
  ) &&
  /parseIntegerParam\(pageParam\s*\?\?\s*cursorParam,\s*1,\s*\{\s*min:\s*1\s*\}\)/.test(
    postsApiSource
  ) &&
  !/Number\(pageParam\s*\|\|\s*cursorParam/.test(postsApiSource)
// ?page= 파싱은 목록 정적화(전수감사 P3)로 클라이언트 뷰로 이관됨 — 이관된
// 컴포넌트가 parseIntegerParam을 쓰고, 서버 페이지는 searchParams를 다시
// 읽지 않아야 한다(await searchParams가 생기면 ISR이 다시 사문화된다).
const serverBoardViewEarlyPath = join(root, 'src/components/board/ServerBoardView.tsx')
const serverBoardViewEarlySource = readSourceAt(serverBoardViewEarlyPath)
const projectsContentEarlyPath = join(root, 'src/app/[locale]/projects/ProjectsContent.tsx')
const projectsContentEarlySource = readSourceAt(projectsContentEarlyPath)
const boardPageParsesSearchParamsSafely =
  /parseIntegerParam\(searchParams\.get\(['"]page['"]\),\s*1,\s*\{\s*min:\s*1\s*\}\)/.test(
    serverBoardViewEarlySource
  ) &&
  !/parseInt\(/.test(serverBoardViewEarlySource) &&
  !/await searchParams/.test(boardPageSource)
const projectsPageParsesSearchParamsSafely =
  /parseIntegerParam\(searchParams\.get\(['"]page['"]\),\s*1,\s*\{\s*min:\s*1\s*\}\)/.test(
    projectsContentEarlySource
  ) &&
  !/parseInt\(/.test(projectsContentEarlySource) &&
  !/await searchParams/.test(projectsPageSource)
const parsesMemberFeeInputsSafely =
  /parseIntegerParam/.test(signupPageSource) &&
  /monthly_fee:\s*parseIntegerParam\(formData\.monthlyFee,\s*0,\s*\{\s*min:\s*0\s*\}\)/.test(
    signupPageSource
  ) &&
  !/parseInt\(formData\.monthlyFee/.test(signupPageSource) &&
  /parseIntegerParam/.test(cooperativeInfoSource) &&
  /parseIntegerParam\(e\.target\.value,\s*0,\s*\{\s*min:\s*0\s*\}\)/.test(cooperativeInfoSource) &&
  !/parseInt\(e\.target\.value\)/.test(cooperativeInfoSource)
const parsesAdminSettingNumberInputsSafely =
  /parseIntegerParam/.test(adminSettingsPageSource) &&
  [
    ['site', 'max_members'],
    ['email', 'smtp_port'],
    ['security', 'session_timeout'],
    ['security', 'max_login_attempts'],
    ['security', 'password_min_length'],
  ].every(([group, key]) =>
    new RegExp(
      `updateSettings\\([\\s\\S]*?['"]${group}['"],[\\s\\S]*?['"]${key}['"],[\\s\\S]*?parseIntegerParam\\(e\\.target\\.value,\\s*0,\\s*\\{\\s*min:\\s*0\\s*\\}\\)[\\s\\S]*?\\)`
    ).test(adminSettingsPageSource)
  ) &&
  !/parseInt\(e\.target\.value\)/.test(adminSettingsPageSource)
const parsesAdminOperationalNumberInputsSafely =
  /parseIntegerParam/.test(adminNotificationsPageSource) &&
  /expires_hours:\s*parseIntegerParam\(e\.target\.value,\s*24,\s*\{\s*min:\s*1\s*\}\)/.test(
    adminNotificationsPageSource
  ) &&
  !/parseInt\(e\.target\.value\)/.test(adminNotificationsPageSource) &&
  /parseIntegerParam/.test(adminReportGeneratorSource) &&
  /minimumActivity:\s*parseIntegerParam\(e\.target\.value,\s*0,\s*\{\s*min:\s*0\s*\}\)/.test(
    adminReportGeneratorSource
  ) &&
  !/parseInt\(e\.target\.value\)/.test(adminReportGeneratorSource) &&
  /parseIntegerParam/.test(recentActivitySource) &&
  /setDays\(parseIntegerParam\(e\.target\.value,\s*7,\s*\{\s*min:\s*1\s*\}\)\)/.test(
    recentActivitySource
  ) &&
  /setLimit\(parseIntegerParam\(e\.target\.value,\s*10,\s*\{\s*min:\s*1\s*\}\)\)/.test(
    recentActivitySource
  ) &&
  !/parseInt\(e\.target\.value\)/.test(recentActivitySource) &&
  /parseIntegerParam/.test(activityAnalyticsChartsSource) &&
  /setTopK\(parseIntegerParam\(e\.target\.value,\s*8,\s*\{\s*min:\s*1\s*\}\)\)/.test(
    activityAnalyticsChartsSource
  ) &&
  /setTrendWeeks\(parseIntegerParam\(e\.target\.value,\s*8,\s*\{\s*min:\s*1\s*\}\)\)/.test(
    activityAnalyticsChartsSource
  ) &&
  !/Number\(e\.target\.value\)/.test(activityAnalyticsChartsSource)
const avoidsAdminMembersOperationalConsoleNoise = !/console\.(?:log|debug|warn)\(/.test(
  adminMembersPageSource
)
const validatesAdminReportGenerationInputs =
  /REPORT_TYPES\s*=\s*\[/.test(adminReportGenerateApiSource) &&
  /parseReportType\(body\.reportType\)/.test(adminReportGenerateApiSource) &&
  adminReportGenerateApiSource.includes('const REPORT_DATE_PATTERN = /^\\d{4}-\\d{2}-\\d{2}$/') &&
  /parseReportDateRange\(body\.dateRange\)/.test(adminReportGenerateApiSource) &&
  /MAX_REPORT_RANGE_DAYS/.test(adminReportGenerateApiSource) &&
  /startDate > endDate/.test(adminReportGenerateApiSource) &&
  /parseReportFilters\(body\.filters\)/.test(adminReportGenerateApiSource) &&
  /parseIntegerParam\(String\(raw\.minimumActivity \?\? ['"]['"]\),\s*0,\s*\{\s*min:\s*0\s*\}\)/.test(
    adminReportGenerateApiSource
  ) &&
  /filters,/.test(adminReportGenerateApiSource) &&
  !/const reportType = typeof body\.reportType === ['"]string['"] \? body\.reportType : ['"]['"]/.test(
    adminReportGenerateApiSource
  ) &&
  !/new Date\(dateRange\.start\)/.test(adminReportGenerateApiSource) &&
  !/const filters = body\.filters/.test(adminReportGenerateApiSource)
const parsesMypageSettingNumberInputsSafely =
  /parseIntegerParam/.test(mypageSecuritySettingsSource) &&
  /minutes:\s*parseIntegerParam\(e\.target\.value,\s*480,\s*\{\s*min:\s*1\s*\}\)/.test(
    mypageSecuritySettingsSource
  ) &&
  !/parseInt\(e\.target\.value\)/.test(mypageSecuritySettingsSource) &&
  /parseIntegerParam/.test(mypagePreferenceSettingsSource) &&
  /interval_minutes:\s*parseIntegerParam\(e\.target\.value,\s*5,\s*\{\s*min:\s*1\s*\}\)/.test(
    mypagePreferenceSettingsSource
  ) &&
  !/parseInt\(e\.target\.value\)/.test(mypagePreferenceSettingsSource) &&
  /parseIntegerParam/.test(mypageInterfaceSettingsSource) &&
  /items_per_page:\s*parseIntegerParam\(e\.target\.value,\s*20,\s*\{\s*min:\s*1\s*\}\)/.test(
    mypageInterfaceSettingsSource
  ) &&
  !/parseInt\(e\.target\.value\)/.test(mypageInterfaceSettingsSource)
const parsesPostViewTimestampsSafely =
  /parseIntegerParam/.test(postDetailClientSource) &&
  /const\s+parsedLastViewTime\s*=\s*lastViewTime\s*\?\s*parseIntegerParam\(lastViewTime,\s*0,\s*\{\s*min:\s*0\s*\}\)\s*:\s*0/.test(
    postDetailClientSource
  ) &&
  !/parseInt\(lastViewTime\)/.test(postDetailClientSource) &&
  /parseIntegerParam/.test(postViewSource) &&
  /parseIntegerParam\(lastViewTime,\s*0,\s*\{\s*min:\s*0\s*\}\)/.test(postViewSource) &&
  !/parseInt\(lastViewTime\)/.test(postViewSource)
const parsesImageProxyContentLengthSafely =
  /parseIntegerParam/.test(imageProxySource) &&
  /parseIntegerParam\(res\.headers\.get\(['"]content-length['"]\),\s*0,\s*\{\s*min:\s*0\s*\}\)/.test(
    imageProxySource
  ) &&
  !/Number\(res\.headers\.get\(['"]content-length['"]\)/.test(imageProxySource)
const parsesAttachmentSizesSafely =
  /parseIntegerParam/.test(boardPostDetailSource) &&
  /parseIntegerParam\(String\(att\.file_size\s*\?\?\s*['"]['"]\),\s*0,\s*\{\s*min:\s*0\s*\}\)/.test(
    boardPostDetailSource
  ) &&
  !/Number\(att\.file_size\)/.test(boardPostDetailSource) &&
  // 목록은 board_posts_with_stats 뷰(Phase 3)로 집계가 DB로 이전됨 — 뷰 집계값
  // (total_size 등)을 그대로 더하지 않고 parseIntegerParam으로 정규화하는지 검증
  /parseIntegerParam/.test(serverBoardSource) &&
  /parseIntegerParam\(String\(row\.total_size\s*\?\?\s*['"]['"]\),\s*0,\s*\{\s*min:\s*0\s*\}\)/.test(
    serverBoardSource
  ) &&
  !/Number\(row\.(?:file_size|total_size)\)/.test(serverBoardSource) &&
  /parseIntegerParam/.test(boardDetailPageSource) &&
  /parseIntegerParam\(String\(att\.file_size\s*\?\?\s*['"]['"]\),\s*0,\s*\{\s*min:\s*0\s*\}\)/.test(
    boardDetailPageSource
  ) &&
  !/att\.file_size\s*\|\|\s*0/.test(boardDetailPageSource)
// 아티스트 사진 경계는 공유 헬퍼 toSafeArtistImageSrc(내부에서 artists 버킷의
// logicalPathFromUrl 검증)로 통일됐다(커밋 0c32462). 검사도 헬퍼 사용과
// 헬퍼 자체의 버킷 경계를 함께 고정한다.
//
// **PersonalInfo의 접두사는 `legacy_id`여야 한다.** 사진의 저장 경로를 만드는
// 것은 업로드 라우트의 `member_profiles.artist_id`(= `artist-016` 꼴)이고,
// `artists.id`(UUID)를 넘기면 게이트가 모든 아티스트에 대해 영구히 false가 되어
// **사진이 아무 에러 없이 기본 아이콘으로 사라진다.**
//
// 2026-09-01 적대 감사 전까지 이 가드는 **버그 쪽 형태(`artistData?.id`)를 그대로
// 못박고 있었다** — 즉 가드가 초록불인 채로 마이페이지 사진이 전원 사라진
// 상태를 지키고 있었다. 이 저장소의 가드가 "이 문자열이 이 파일에 있는가"만
// 본다는 한계의 실례다. 아래는 옳은 형태를 요구하고, 옛 형태를 금지한다.
const validatesRenderedArtistProfilePhotoUrls =
  /toSafeArtistImageSrc/.test(postDetailClientSource) &&
  /const\s+safeAuthorProfilePhotoUrl\s*=\s*toSafeArtistImageSrc\(authorProfile\?\.profile_photo_url,\s*['"]['"]\)/.test(
    postDetailClientSource
  ) &&
  !/src=\{authorProfile\.profile_photo_url\}/.test(postDetailClientSource) &&
  /artistId\?:\s*string\s*\|\s*null/.test(mypageProfilePersonalInfoSource) &&
  /logicalPathFromUrl\(artistPhotoUrl,\s*['"]artists['"],\s*artistId\)\s*!==\s*null/.test(
    mypageProfilePersonalInfoSource
  ) &&
  !/src=\{artistPhotoUrl\}/.test(mypageProfilePersonalInfoSource) &&
  /artistId=\{artistData\?\.legacy_id \|\| null\}/.test(mypageProfileEditFormSource) &&
  !/artistId=\{artistData\?\.id \|\| null\}/.test(mypageProfileEditFormSource) &&
  /safePreviewImageForDisplay/.test(mypageArtistPageSource) &&
  /const\s+safePreviewImageForDisplay\s*=\s*toSafeArtistImageSrc\(previewImageForDisplay,\s*['"]['"]\)/.test(
    mypageArtistPageSource
  ) &&
  !/src=\{previewImageForDisplay\}/.test(mypageArtistPageSource) &&
  /logicalPathFromUrl\(trimmed,\s*['"]artists['"]\)\s*!==\s*null/.test(safeUrlSource)
const profileEditFormGuardsArtistFetchUnmount =
  /let mounted = true/.test(mypageProfileEditFormSource) &&
  // 표준 응답 래퍼 전환(f358383)으로 페이로드 접근이 json.data?.artist로 바뀜 —
  // 검사 의도는 "언마운트 가드 안에서만 setState"이므로 대입값에는 느슨하게 결합
  /if \(mounted\) \{\s*setArtistData\([^)]*\)\s*\}/.test(mypageProfileEditFormSource) &&
  /if \(mounted\) \{\s*setArtistLoading\(false\)\s*\}/.test(mypageProfileEditFormSource) &&
  /return \(\) => \{\s*mounted = false\s*\}/.test(mypageProfileEditFormSource)
const validatesAdvancedFilterFiniteNumbers =
  /Number\.isFinite\(num\)/.test(advancedFilteringSource) &&
  !/isNaN\(num\)\s*\?\s*null\s*:\s*num/.test(advancedFilteringSource)
const validatesAdvancedSearchSqlAllowlists =
  /Sort fields require an explicit allowlist/.test(advancedFilteringSource) &&
  /Filter fields require an explicit allowlist/.test(advancedFilteringSource) &&
  /Search fields require an explicit allowlist/.test(advancedFilteringSource) &&
  /Disallowed search fields/.test(advancedFilteringSource) &&
  /Invalid pagination values/.test(advancedFilteringSource) &&
  /buildOrderByClause\(query\.sorts,\s*allowedFields\)/.test(advancedFilteringSource) &&
  !/allowedFields\.length === 0 \|\| allowedFields\.includes\(field\)/.test(
    advancedFilteringSource
  ) &&
  !/allowedFields\.length > 0 && !allowedFields\.includes\(sort\.field\)/.test(
    advancedFilteringSource
  )
const parsesSessionPingIntervalSafely =
  /parseIntegerParam/.test(activityLoggerSource) &&
  /parseIntegerParam\(process\.env\.NEXT_PUBLIC_SESSION_PING_MS\s*\?\?\s*null,\s*90000,\s*\{[\s\S]*?min:\s*1000,[\s\S]*?\}\)/.test(
    activityLoggerSource
  ) &&
  !/Number\(process\.env\.NEXT_PUBLIC_SESSION_PING_MS/.test(activityLoggerSource) &&
  !/isNaN\(pingMs\)/.test(activityLoggerSource)
const authRedirectBlocklistHandlesLocalePrefixes =
  /stripSupportedLocalePrefix/.test(safeUrlSource) &&
  /const\s+redirectPathname\s*=\s*stripSupportedLocalePrefix\(path\)/.test(safeUrlSource) &&
  /AUTH_REDIRECT_BLOCKLIST\.some\([\s\S]*?redirectPathname\s*===\s*blocked[\s\S]*?redirectPathname\.startsWith\(`\$\{blocked\}\/`\)/.test(
    safeUrlSource
  )
const adminActivitiesUsersPath = join(root, 'src/app/api/admin/activities/users/route.ts')
const adminActivitiesUsersSource = readSourceAt(adminActivitiesUsersPath)
const activityLogPath = join(root, 'src/app/api/activities/log/route.ts')
const activityLogSource = readSourceAt(activityLogPath)
const activityBatchLogPath = join(root, 'src/app/api/activities/batch-log/route.ts')
const activityBatchLogSource = readSourceAt(activityBatchLogPath)
const adminAnalyticsPatternsPath = join(root, 'src/app/api/admin/analytics/patterns/route.ts')
const adminAnalyticsPatternsSource = readSourceAt(adminAnalyticsPatternsPath)
const adminAnalyticsTrendsPath = join(root, 'src/app/api/admin/analytics/trends/route.ts')
const adminAnalyticsTrendsSource = readSourceAt(adminAnalyticsTrendsPath)
const adminPerformancePath = join(root, 'src/app/api/admin/performance/route.ts')
const adminPerformanceSource = readSourceAt(adminPerformancePath)
const adminStatsPath = join(root, 'src/app/api/admin/stats/route.ts')
const adminStatsSource = readSourceAt(adminStatsPath)
const adminStatsMonthlyPath = join(root, 'src/app/api/admin/stats/monthly/route.ts')
const adminStatsMonthlySource = readSourceAt(adminStatsMonthlyPath)
const adminMembersStatsPath = join(root, 'src/app/api/admin/members/stats/route.ts')
const adminMembersStatsSource = readSourceAt(adminMembersStatsPath)
const adminPostsStatsPath = join(root, 'src/app/api/admin/posts/stats/route.ts')
const adminPostsStatsSource = readSourceAt(adminPostsStatsPath)
const adminActivityPath = join(root, 'src/app/api/admin/activity/route.ts')
const adminActivitySource = readSourceAt(adminActivityPath)
const adminArtistsPath = join(root, 'src/app/api/admin/artists/route.ts')
const adminArtistsSource = readSourceAt(adminArtistsPath)
const adminArtistsMembersPath = join(root, 'src/app/api/admin/artists/members/route.ts')
const adminArtistsMembersSource = readSourceAt(adminArtistsMembersPath)
const adminMembersPath = join(root, 'src/app/api/admin/members/route.ts')
const adminMembersSource = readSourceAt(adminMembersPath)
const adminMembersAdvancedSearchPath = join(
  root,
  'src/app/api/admin/members/advanced-search/route.ts'
)
const adminMembersAdvancedSearchSource = readSourceAt(adminMembersAdvancedSearchPath)
const settingsAdminAuthPath = join(root, 'src/lib/server/settingsAdminAuth.ts')
const settingsAdminAuthSource = existsSync(settingsAdminAuthPath)
  ? readSourceAt(settingsAdminAuthPath)
  : ''
const adminSettingsApiPath = join(root, 'src/app/api/admin/settings/route.ts')
const adminSettingsApiSource = readSourceAt(adminSettingsApiPath)
const adminSettingsBackupApiPath = join(root, 'src/app/api/admin/settings/backup/route.ts')
const adminSettingsBackupApiSource = readSourceAt(adminSettingsBackupApiPath)
const adminSettingsCacheApiPath = join(root, 'src/app/api/admin/settings/cache/route.ts')
const adminSettingsCacheApiSource = readSourceAt(adminSettingsCacheApiPath)
const adminSettingsResetApiPath = join(root, 'src/app/api/admin/settings/reset/route.ts')
const adminSettingsResetApiSource = readSourceAt(adminSettingsResetApiPath)
const adminPostsPath = join(root, 'src/app/api/admin/posts/route.ts')
const adminPostsSource = readSourceAt(adminPostsPath)
const adminPostsAdvancedSearchPath = join(root, 'src/app/api/admin/posts/advanced-search/route.ts')
const adminPostsAdvancedSearchSource = readSourceAt(adminPostsAdvancedSearchPath)
const adminReportsGeneratePath = join(root, 'src/app/api/admin/reports/generate/route.ts')
const adminReportsGenerateSource = readSourceAt(adminReportsGeneratePath)
const adminActivitiesRealTimePath = join(root, 'src/app/api/admin/activities/real-time/route.ts')
const adminActivitiesRealTimeSource = readSourceAt(adminActivitiesRealTimePath)
const adminActivitiesRealTimeStreamPath = join(
  root,
  'src/app/api/admin/activities/real-time/stream/route.ts'
)
const adminActivitiesRealTimeStreamSource = readSourceAt(adminActivitiesRealTimeStreamPath)
const apiPerformanceMonitorPath = join(root, 'src/utils/apiPerformanceMonitor.ts')
const apiPerformanceMonitorSource = readSourceAt(apiPerformanceMonitorPath)
const adminAnalyticsConstantsPath = join(root, 'src/constants/adminAnalytics.ts')
const adminAnalyticsConstantsSource = readSourceAt(adminAnalyticsConstantsPath)
const userSettingsConstantsPath = join(root, 'src/constants/userSettings.ts')
const userSettingsConstantsSource = readSourceAt(userSettingsConstantsPath)
const userSettingsApiPath = join(root, 'src/app/api/settings/route.ts')
const userSettingsApiSource = readSourceAt(userSettingsApiPath)
const userSettingsResetApiPath = join(root, 'src/app/api/settings/reset/route.ts')
const userSettingsResetApiSource = readSourceAt(userSettingsResetApiPath)
const activityConstantsPath = join(root, 'src/constants/activity.ts')
const activityConstantsSource = readSourceAt(activityConstantsPath)
// 단계 4(활동로그·세션 Turso 전환)에서 admin/activities/users와
// admin/analytics/patterns가 수동 Supabase 쿼리 빌더(`query.eq(...)`)를
// Turso 쿼리 계층 호출(`listActivitiesWithProfile({ userId, ... })`/
// `analyzeActivityPatterns(sanitizedUserId, ...)`)로 대체했다 — 검증
// 순서(validateUUID → sanitizedUserId → 쿼리 계층 호출)는 그대로다.
const validatesAdminAnalyticsUserIdFilters =
  /validateUUID/.test(adminActivitiesUsersSource) &&
  /let\s+sanitizedUserId[\s\S]*?=\s*null/.test(adminActivitiesUsersSource) &&
  /listActivitiesWithProfile\(\{[\s\S]*?userId:\s*sanitizedUserId/.test(
    adminActivitiesUsersSource
  ) &&
  /validateUUID/.test(adminAnalyticsPatternsSource) &&
  /let\s+sanitizedUserId[\s\S]*?=\s*null/.test(adminAnalyticsPatternsSource) &&
  /analyzeActivityPatterns\(sanitizedUserId/.test(adminAnalyticsPatternsSource)
const validatesAdminAnalyticsQueryEnums =
  /TREND_PERIODS/.test(adminAnalyticsConstantsSource) &&
  /TREND_TYPES/.test(adminAnalyticsConstantsSource) &&
  /PERFORMANCE_ACTIONS/.test(adminAnalyticsConstantsSource) &&
  /parseTrendPeriod/.test(adminAnalyticsConstantsSource) &&
  /parseTrendType/.test(adminAnalyticsConstantsSource) &&
  /parsePerformanceAction/.test(adminAnalyticsConstantsSource) &&
  /const periodParam = searchParams\.get\(['"]period['"]\) \|\| ['"]daily['"]/.test(
    adminAnalyticsTrendsSource
  ) &&
  /const period = parseTrendPeriod\(periodParam\)/.test(adminAnalyticsTrendsSource) &&
  /const trendTypeParam = searchParams\.get\(['"]type['"]\) \|\| ['"]activity['"]/.test(
    adminAnalyticsTrendsSource
  ) &&
  /const trendType = parseTrendType\(trendTypeParam\)/.test(adminAnalyticsTrendsSource) &&
  /if\s*\(!period\)/.test(adminAnalyticsTrendsSource) &&
  /if\s*\(!trendType\)/.test(adminAnalyticsTrendsSource) &&
  /const actionParam = searchParams\.get\(['"]action['"]\) \|\| ['"]dashboard['"]/.test(
    adminPerformanceSource
  ) &&
  /const action = parsePerformanceAction\(actionParam\)/.test(adminPerformanceSource) &&
  /if\s*\(!action\)/.test(adminPerformanceSource) &&
  !/const period = searchParams\.get\(['"]period['"]\) \|\| ['"]daily['"]/.test(
    adminAnalyticsTrendsSource
  ) &&
  !/const trendType = searchParams\.get\(['"]type['"]\) \|\| ['"]activity['"]/.test(
    adminAnalyticsTrendsSource
  ) &&
  !/const action = searchParams\.get\(['"]action['"]\) \|\| ['"]dashboard['"]/.test(
    adminPerformanceSource
  )
const validatesAdminPerformanceExportDates =
  /MAX_EXPORT_RANGE_MS/.test(adminPerformanceSource) &&
  /function parseMetricTimestamp/.test(adminPerformanceSource) &&
  /Date\.parse\(value\)/.test(adminPerformanceSource) &&
  /Number\.isFinite\(parsed\)/.test(adminPerformanceSource) &&
  /parsedStartTime === null \|\| parsedEndTime === null/.test(adminPerformanceSource) &&
  /parsedStartTime > parsedEndTime/.test(adminPerformanceSource) &&
  /parsedEndTime - parsedStartTime > MAX_EXPORT_RANGE_MS/.test(adminPerformanceSource) &&
  /new Date\(parsedStartTime\)\.toISOString\(\)/.test(adminPerformanceSource) &&
  /new Date\(parsedEndTime\)\.toISOString\(\)/.test(adminPerformanceSource) &&
  !/exportApiMetrics\(startTime,\s*endTime/.test(adminPerformanceSource)
const validatesUserSettingsAllowlists =
  /USER_SETTING_CATEGORIES/.test(userSettingsConstantsSource) &&
  /USER_SETTING_KEYS/.test(userSettingsConstantsSource) &&
  /parseUserSettingCategory/.test(userSettingsConstantsSource) &&
  /isUserSettingKey/.test(userSettingsConstantsSource) &&
  /satisfies\s+readonly\s+SettingCategory\[\]/.test(userSettingsConstantsSource) &&
  /parseUserSettingCategory\(categoryParam\)/.test(userSettingsApiSource) &&
  /parseJsonObjectBody/.test(userSettingsApiSource) &&
  !/request\.json\(\)/.test(userSettingsApiSource) &&
  /if\s*\(categoryParam && !category\)/.test(userSettingsApiSource) &&
  /isUserSettingKey\(category,\s*setting_key\)/.test(userSettingsApiSource) &&
  // RPC(upsert_user_setting)의 auth.uid() 의존을 없애고 앱 계층 직접
  // upsert로 옮긴 뒤(단계 2b-4)에는, 검증된 category/setting_key가 항상
  // 세션 사용자 id로 스코프된 쓰기(POST 단건 + PUT 벌크 각 1회, 총 2회)로
  // 이어지는지를 직접 확인한다.
  //
  // Task 4: user_settings 권위가 Turso로 옮겨지며 이 두 쓰기가 Supabase
  // `.from('user_settings').upsert({user_id:user.id,...}, {onConflict:
  // '...'})`에서 쿼리 계층 호출 `upsertUserSetting({userId: user.id, ...})`
  // (src/db/queries/settings.ts)로 바뀌었다. 이 라우트에는 Supabase 호출이
  // 한 줄도 남지 않았으므로 옛 패턴 분기는 죽은 코드였다 — 두 쓰기 각각이
  // 세션 사용자 id로 스코프되는지를 호출부에 고정한다(리뷰 1회차 Important 1).
  (userSettingsApiSource.match(/upsertUserSetting\(\{\s*userId:\s*user\.id,/g) ?? []).length >= 2 &&
  /parseUserSettingCategory\(parsed\.data\.category\)/.test(userSettingsResetApiSource) &&
  // 초기화 경로도 RPC(reset_user_settings)의 auth.uid() 의존을 없애고 직접
  // DELETE로 옮겼다(단계 2b-4). 세션 사용자로 스코프하는 필터가 이 삭제의
  // 유일한 방어선이다 — 빠지면 카테고리만 맞는 전 사용자의 설정이 지워진다.
  // 이 경로는 E2E가 덮지 않으므로 정적 검사가 유일한 그물이다. Task 4:
  // 쿼리 계층 resetUserSettings({userId: user.id, ...})로 옮겼고 이 라우트에는
  // Supabase 호출이 한 줄도 남지 않았다 — 옛 패턴 분기는 죽은 코드였다
  // (리뷰 1회차 Important 1).
  /resetUserSettings\(\{\s*userId:\s*user\.id,/.test(userSettingsResetApiSource) &&
  /if\s*\(parsed\.data\.category && !category\)/.test(userSettingsResetApiSource) &&
  /if\s*\(setting_key && !category\)/.test(userSettingsResetApiSource) &&
  /isUserSettingKey\(category,\s*setting_key\)/.test(userSettingsResetApiSource) &&
  !/const category = searchParams\.get\(['"]category['"]\)/.test(userSettingsApiSource) &&
  !/category:\s*z\.string\(\)\.min\(1\)\.max\(64\),/.test(userSettingsApiSource)
// 단계 4: admin/activities/users가 `query = query.eq(...)` 대신
// `listActivitiesWithProfile({ actionType, targetType, ... })`(검증된
// actionType/targetType를 그대로 전달)를 쓴다 — 검증 순서는 그대로다.
const validatesAdminActivityTypeFilters =
  /ACTIVITY_ACTION_TYPES/.test(activityConstantsSource) &&
  /ACTIVITY_TARGET_TYPES/.test(activityConstantsSource) &&
  /parseActivityActionType/.test(activityConstantsSource) &&
  /parseActivityTargetType/.test(activityConstantsSource) &&
  /satisfies\s+readonly\s+ActivityActionType\[\]/.test(activityConstantsSource) &&
  /satisfies\s+readonly\s+ActivityTargetType\[\]/.test(activityConstantsSource) &&
  /parseActivityActionType\(actionTypeParam\)/.test(adminActivitiesUsersSource) &&
  /parseActivityTargetType\(targetTypeParam\)/.test(adminActivitiesUsersSource) &&
  /if\s*\(actionTypeParam && !actionType\)/.test(adminActivitiesUsersSource) &&
  /if\s*\(targetTypeParam && !targetType\)/.test(adminActivitiesUsersSource) &&
  /listActivitiesWithProfile\(\{[\s\S]*?actionType,/.test(adminActivitiesUsersSource) &&
  /listActivitiesWithProfile\(\{[\s\S]*?targetType,/.test(adminActivitiesUsersSource) &&
  !/const actionType = searchParams\.get\(['"]action_type['"]\)/.test(adminActivitiesUsersSource) &&
  !/const targetType = searchParams\.get\(['"]target_type['"]\)/.test(adminActivitiesUsersSource)
const adminActivitiesUsersUsesSharedApiRoute =
  /from\s+['"]@\/lib\/server\/apiRoute['"]/.test(adminActivitiesUsersSource) &&
  /export const GET = defineApiRoute/.test(adminActivitiesUsersSource) &&
  /auth:\s*['"]admin['"]/.test(adminActivitiesUsersSource) &&
  /rateLimit:\s*RATE_LIMITS\.ADMIN_API/.test(adminActivitiesUsersSource) &&
  !/withRateLimit\(/.test(adminActivitiesUsersSource) &&
  !/requireAdmin\(\)/.test(adminActivitiesUsersSource)
const adminAnalyticsRoutesUseSharedApiRoute =
  /from\s+['"]@\/lib\/server\/apiRoute['"]/.test(adminAnalyticsPatternsSource) &&
  /export const GET = defineApiRoute/.test(adminAnalyticsPatternsSource) &&
  /auth:\s*['"]admin['"]/.test(adminAnalyticsPatternsSource) &&
  /rateLimit:\s*RATE_LIMITS\.ADMIN_API/.test(adminAnalyticsPatternsSource) &&
  !/withRateLimit\(/.test(adminAnalyticsPatternsSource) &&
  !/requireAdmin\(\)/.test(adminAnalyticsPatternsSource) &&
  /from\s+['"]@\/lib\/server\/apiRoute['"]/.test(adminAnalyticsTrendsSource) &&
  /export const GET = defineApiRoute/.test(adminAnalyticsTrendsSource) &&
  /auth:\s*['"]admin['"]/.test(adminAnalyticsTrendsSource) &&
  /rateLimit:\s*RATE_LIMITS\.ADMIN_API/.test(adminAnalyticsTrendsSource) &&
  !/withRateLimit\(/.test(adminAnalyticsTrendsSource) &&
  !/requireAdmin\(\)/.test(adminAnalyticsTrendsSource)
const adminStatsRouteSources = [
  { path: adminStatsPath, source: adminStatsSource, rateLimitKey: 'admin_stats' },
  {
    path: adminStatsMonthlyPath,
    source: adminStatsMonthlySource,
    rateLimitKey: 'admin_stats_monthly',
  },
  {
    path: adminMembersStatsPath,
    source: adminMembersStatsSource,
    rateLimitKey: 'admin_members_stats',
  },
  { path: adminPostsStatsPath, source: adminPostsStatsSource, rateLimitKey: 'admin_posts_stats' },
]
const adminStatsRoutesUseSharedApiRoute = adminStatsRouteSources.every(
  ({ source, rateLimitKey }) =>
    /from\s+['"]@\/lib\/server\/apiRoute['"]/.test(source) &&
    /export const GET = defineApiRoute/.test(source) &&
    /auth:\s*['"]admin['"]/.test(source) &&
    /rateLimit:\s*\{\s*\.\.\.RATE_LIMITS\.ADMIN_API/.test(source) &&
    new RegExp(`createUserKeyGenerator\\(['"]${rateLimitKey}['"]\\)`).test(source) &&
    /rateLimitHeaders:\s*true/.test(source) &&
    !/applyRateLimit\(/.test(source) &&
    !/addRateLimitHeaders/.test(source) &&
    !/requireAdmin\(\)/.test(source)
)
const adminListingRouteSources = [
  { path: adminActivityPath, source: adminActivitySource, rateLimitKey: 'admin_activity' },
  { path: adminArtistsPath, source: adminArtistsSource, rateLimitKey: 'admin_artists' },
  {
    path: adminArtistsMembersPath,
    source: adminArtistsMembersSource,
    rateLimitKey: 'admin_artists_members',
  },
  { path: adminMembersPath, source: adminMembersSource, rateLimitKey: 'admin_members' },
  { path: adminPostsPath, source: adminPostsSource, rateLimitKey: 'admin_posts' },
]
const adminListingRoutesUseSharedApiRoute = adminListingRouteSources.every(
  ({ source, rateLimitKey }) =>
    /from\s+['"]@\/lib\/server\/apiRoute['"]/.test(source) &&
    /export const GET = defineApiRoute/.test(source) &&
    /auth:\s*['"]admin['"]/.test(source) &&
    /rateLimit:\s*\{\s*\.\.\.RATE_LIMITS\.ADMIN_API/.test(source) &&
    new RegExp(`createUserKeyGenerator\\(['"]${rateLimitKey}['"]\\)`).test(source) &&
    /rateLimitHeaders:\s*true/.test(source) &&
    !/applyRateLimit\(/.test(source) &&
    !/addRateLimitHeaders/.test(source) &&
    !/requireAdmin\(\)/.test(source)
)
const adminPostsAdvancedSearchUsesSharedApiRoute =
  /from\s+['"]@\/lib\/server\/apiRoute['"]/.test(adminPostsAdvancedSearchSource) &&
  /export const POST = defineApiRoute/.test(adminPostsAdvancedSearchSource) &&
  /export const GET = defineApiRoute/.test(adminPostsAdvancedSearchSource) &&
  (adminPostsAdvancedSearchSource.match(/auth:\s*['"]admin['"]/g) ?? []).length >= 2 &&
  /rateLimit:\s*\{\s*\.\.\.RATE_LIMITS\.ADMIN_API/.test(adminPostsAdvancedSearchSource) &&
  /createUserKeyGenerator\(['"]posts_advanced_search['"]\)/.test(adminPostsAdvancedSearchSource) &&
  /body:\s*\{[\s\S]*?invalidResponse/.test(adminPostsAdvancedSearchSource) &&
  !/parseJsonObjectBody/.test(adminPostsAdvancedSearchSource) &&
  !/applyRateLimit\(/.test(adminPostsAdvancedSearchSource) &&
  !/requireAdmin\(\)/.test(adminPostsAdvancedSearchSource)
const adminMembersAdvancedSearchUsesSharedApiRoute =
  /from\s+['"]@\/lib\/server\/apiRoute['"]/.test(adminMembersAdvancedSearchSource) &&
  /export const POST = defineApiRoute/.test(adminMembersAdvancedSearchSource) &&
  /export const GET = defineApiRoute/.test(adminMembersAdvancedSearchSource) &&
  (adminMembersAdvancedSearchSource.match(/auth:\s*['"]admin['"]/g) ?? []).length >= 2 &&
  /rateLimit:\s*\{\s*\.\.\.RATE_LIMITS\.ADMIN_API/.test(adminMembersAdvancedSearchSource) &&
  /createUserKeyGenerator\(['"]members_advanced_search['"]\)/.test(
    adminMembersAdvancedSearchSource
  ) &&
  (adminMembersAdvancedSearchSource.match(/rateLimitHeaders:\s*true/g) ?? []).length >= 2 &&
  /body:\s*\{[\s\S]*?invalidResponse/.test(adminMembersAdvancedSearchSource) &&
  !/parseJsonObjectBody/.test(adminMembersAdvancedSearchSource) &&
  !/applyRateLimit\(/.test(adminMembersAdvancedSearchSource) &&
  !/addRateLimitHeaders/.test(adminMembersAdvancedSearchSource) &&
  !/requireAdmin\(\)/.test(adminMembersAdvancedSearchSource)
const adminMembersBulkUsesSharedApiRoute =
  /from\s+['"]@\/lib\/server\/apiRoute['"]/.test(adminMembersBulkApiSource) &&
  /export const POST = defineApiRoute/.test(adminMembersBulkApiSource) &&
  /export const GET = defineApiRoute/.test(adminMembersBulkApiSource) &&
  (adminMembersBulkApiSource.match(/auth:\s*['"]admin['"]/g) ?? []).length >= 2 &&
  /rateLimit:\s*\{\s*\.\.\.RATE_LIMITS\.BULK_OPERATIONS/.test(adminMembersBulkApiSource) &&
  /createUserKeyGenerator\(['"]bulk_operations['"]\)/.test(adminMembersBulkApiSource) &&
  /rateLimit:\s*\{\s*\.\.\.RATE_LIMITS\.ADMIN_API/.test(adminMembersBulkApiSource) &&
  /createUserKeyGenerator\(['"]admin_members_bulk_status['"]\)/.test(adminMembersBulkApiSource) &&
  (adminMembersBulkApiSource.match(/rateLimitHeaders:\s*true/g) ?? []).length >= 2 &&
  /body:\s*\{[\s\S]*?invalidResponse/.test(adminMembersBulkApiSource) &&
  !/parseJsonObjectBody/.test(adminMembersBulkApiSource) &&
  !/applyRateLimit\(/.test(adminMembersBulkApiSource) &&
  !/addRateLimitHeaders/.test(adminMembersBulkApiSource) &&
  !/requireAdmin\(\)/.test(adminMembersBulkApiSource)
const hasSettingsAdminAuthResolver =
  /export type SettingsAdminAuth/.test(settingsAdminAuthSource) &&
  /export function createSettingsAdminAuth/.test(settingsAdminAuthSource) &&
  // 단계 4 Task 5: `createSupabaseServer()`로 만들던 `db`가 사라졌다. 신원은
  // readSessionUser(), 관리자 판정은 checkAdminPermission(Turso 프로필)이다.
  /readSessionUser\(\)/.test(settingsAdminAuthSource) &&
  /checkAdminPermission\(user\.id\)/.test(settingsAdminAuthSource) &&
  /createErrorResponse\(\{\s*success:\s*false,\s*error:\s*['"]인증이 필요합니다\./.test(
    settingsAdminAuthSource
  )
const adminSettingsRouteSources = [
  {
    path: adminSettingsApiPath,
    source: adminSettingsApiSource,
    methods: ['GET', 'PUT'],
    keys: ['admin_settings_get', 'admin_settings_update'],
  },
  {
    path: adminSettingsBackupApiPath,
    source: adminSettingsBackupApiSource,
    methods: ['GET', 'POST'],
    keys: ['admin_settings_backup', 'admin_settings_restore'],
  },
  {
    path: adminSettingsCacheApiPath,
    source: adminSettingsCacheApiSource,
    methods: ['GET', 'POST'],
    keys: ['admin_settings_cache_status', 'admin_settings_cache_invalidate'],
  },
  {
    path: adminSettingsResetApiPath,
    source: adminSettingsResetApiSource,
    methods: ['POST'],
    keys: ['admin_settings_reset'],
  },
]
const adminSettingsRoutesUseSharedBoundary =
  hasSettingsAdminAuthResolver &&
  adminSettingsRouteSources.every(({ source, methods, keys }) => {
    if (
      !/from\s+['"]@\/lib\/server\/apiRoute['"]/.test(source) ||
      !/from\s+['"]@\/lib\/server\/settingsAdminAuth['"]/.test(source) ||
      !keys.every(key => new RegExp(`createUserKeyGenerator\\(['"]${key}['"]\\)`).test(source)) ||
      /parseJsonObjectBody/.test(source) ||
      /applyRateLimit\(/.test(source) ||
      /addRateLimitHeaders/.test(source) ||
      /checkAdminPermission/.test(source)
    ) {
      return false
    }

    // 메서드별(defineApiRoute 블록별)로 공유 auth·rate limit 헤더를 강제한다.
    // 파일 어딘가에 한 번만 있으면 통과하던 예전 방식은 GET만 보호되고 POST가
    // bare/누락돼도 통과할 수 있었다.
    return methods.every(method => {
      const block = extractDefineApiRouteBlock(source, method)
      return (
        block !== null &&
        /auth:\s*createSettingsAdminAuth\(/.test(block) &&
        /rateLimitHeaders:\s*true/.test(block)
      )
    })
  })
// `system_settings_history`는 "누가 설정을 바꿨는가"의 **유일한** 기록이다
// (단계 4에서 Postgres 트리거 log_system_settings_change를
// src/db/queries/settings.ts의 updateSystemSetting이 코드로 재현한다).
// 그 기록의 changed_by는 라우트가 넘긴 actorId를 그대로 쓰므로, actorId가
// 인증된 관리자의 id가 아니면 이력 전체가 조용히 거짓이 된다 — 상수 문자열로
// 바꿔도 응답·동작은 전혀 달라지지 않아 아무도 눈치채지 못한다
// (리뷰 1회차 Important 6: 지금은 어떤 가드·테스트도 이걸 고정하지 않았다).
const settingsWriteRouteSources = [
  { path: adminSettingsApiPath, source: adminSettingsApiSource },
  { path: adminSettingsBackupApiPath, source: adminSettingsBackupApiSource },
  { path: adminSettingsResetApiPath, source: adminSettingsResetApiSource },
]
const pinsSystemSettingsHistoryActor = settingsWriteRouteSources.every(({ source }) => {
  // 주석에 적힌 `actorId: user.id`로 통과하지 않도록 주석·import를 먼저 지운다.
  const code = stripCommentsAndImports(source)
  // 호출부 **개수**와 수집된 인자 블록 개수를 대조한다.
  //
  // 이 가드는 원래 fail-open이었다. 수집 정규식 `\(\{[^)]*?\}\)`는 인자 안에
  // `)`가 하나라도 들어가면(예: `actorId: resolveActor()`) 그 호출을 목록에서
  // **통째로 누락**한다. `calls.every(...)`는 없는 항목을 검사하지 않고
  // `calls.length > 0`은 옆에 있는 정상 호출 하나로 충족되므로, 누락된 호출에
  // `actorId: 'system'`을 심어도 초록불이 나왔다. 형제 가드인 minutes의
  // `createMinutes\(\{` 핀은 같은 상황에서 매치 자체가 실패해 fail-closed다 —
  // 이쪽만 방향이 반대였다.
  //
  // 그래서 "본 호출 수 = 수집한 호출 수"를 먼저 단정한다. 수집이 하나라도
  // 새면 검사 결과가 아니라 **가드 고장**으로 실패한다.
  const callSiteCount = (code.match(/\bupdateSystemSetting\(/g) ?? []).length
  const calls = code.match(/updateSystemSetting\(\{[^)]*?\}\)/g) ?? []
  return (
    callSiteCount > 0 &&
    calls.length === callSiteCount &&
    // `user`는 defineApiRoute가 넘긴 인증 컨텍스트에서만 나와야 한다.
    /const \{ user \} = auth/.test(code) &&
    calls.every(call => /actorId:\s*user\.id,?/.test(call))
  )
})
const adminStandaloneRoutesUseSharedApiRoute =
  /from\s+['"]@\/lib\/server\/apiRoute['"]/.test(adminPerformanceSource) &&
  /export const GET = defineApiRoute/.test(adminPerformanceSource) &&
  /auth:\s*['"]admin['"]/.test(adminPerformanceSource) &&
  /rateLimit:\s*\{\s*\.\.\.RATE_LIMITS\.ADMIN_API/.test(adminPerformanceSource) &&
  /createUserKeyGenerator\(['"]admin_performance['"]\)/.test(adminPerformanceSource) &&
  /rateLimitHeaders:\s*true/.test(adminPerformanceSource) &&
  !/applyRateLimit\(/.test(adminPerformanceSource) &&
  !/addRateLimitHeaders/.test(adminPerformanceSource) &&
  !/requireAdmin\(\)/.test(adminPerformanceSource) &&
  /from\s+['"]@\/lib\/server\/apiRoute['"]/.test(adminActivitiesRealTimeSource) &&
  /export const GET = defineApiRoute/.test(adminActivitiesRealTimeSource) &&
  /auth:\s*['"]admin['"]/.test(adminActivitiesRealTimeSource) &&
  /rateLimit:\s*RATE_LIMITS\.ADMIN_API/.test(adminActivitiesRealTimeSource) &&
  !/withRateLimit\(/.test(adminActivitiesRealTimeSource) &&
  !/requireAdmin\(\)/.test(adminActivitiesRealTimeSource) &&
  /from\s+['"]@\/lib\/server\/apiRoute['"]/.test(adminReportsGenerateSource) &&
  /export const POST = defineApiRoute/.test(adminReportsGenerateSource) &&
  /auth:\s*['"]admin['"]/.test(adminReportsGenerateSource) &&
  /rateLimit:\s*RATE_LIMITS\.ADMIN_API/.test(adminReportsGenerateSource) &&
  /body:\s*\{[\s\S]*?invalidResponse/.test(adminReportsGenerateSource) &&
  !/parseJsonObjectBody/.test(adminReportsGenerateSource) &&
  !/applyRateLimit\(/.test(adminReportsGenerateSource) &&
  !/requireAdmin\(\)/.test(adminReportsGenerateSource)
const adminRealtimeStreamUsesSharedStreamRoute =
  hasSharedStreamRouteWrapper &&
  /from\s+['"]@\/lib\/server\/streamRoute['"]/.test(adminActivitiesRealTimeStreamSource) &&
  /export const GET = defineStreamRoute/.test(adminActivitiesRealTimeStreamSource) &&
  /auth:\s*['"]admin['"]/.test(adminActivitiesRealTimeStreamSource) &&
  /rateLimit:\s*\{\s*\.\.\.RATE_LIMITS\.ADMIN_API/.test(adminActivitiesRealTimeStreamSource) &&
  /createUserKeyGenerator\(['"]admin_realtime_stream['"]\)/.test(
    adminActivitiesRealTimeStreamSource
  ) &&
  !/applyRateLimit\(/.test(adminActivitiesRealTimeStreamSource) &&
  !/RATE_LIMIT_CONFIGS/.test(adminActivitiesRealTimeStreamSource) &&
  !/requireAdmin\(\)/.test(adminActivitiesRealTimeStreamSource) &&
  !/addRateLimitHeaders/.test(adminActivitiesRealTimeStreamSource)
const adminEventApplicationsUsesSharedApiRoute =
  /from\s+['"]@\/lib\/server\/apiRoute['"]/.test(adminEventApplicationsApiSource) &&
  /export const GET = defineApiRoute/.test(adminEventApplicationsApiSource) &&
  /export const PATCH = defineApiRoute/.test(adminEventApplicationsApiSource) &&
  /export const PUT = defineApiRoute/.test(adminEventApplicationsApiSource) &&
  /export const DELETE = defineApiRoute/.test(adminEventApplicationsApiSource) &&
  (adminEventApplicationsApiSource.match(/auth:\s*['"]admin['"]/g) ?? []).length >= 4 &&
  /body:\s*\{[\s\S]*?invalidResponse/.test(adminEventApplicationsApiSource) &&
  !/parseJsonObjectBody/.test(adminEventApplicationsApiSource) &&
  !/requireAdmin\(\)/.test(adminEventApplicationsApiSource)
const adminMemberMutationRoutesUseSharedApiRoute =
  /from\s+['"]@\/lib\/server\/apiRoute['"]/.test(adminMemberActionApiSource) &&
  /export const POST = defineApiRoute/.test(adminMemberActionApiSource) &&
  /auth:\s*['"]admin['"]/.test(adminMemberActionApiSource) &&
  /rateLimit:\s*\{\s*\.\.\.RATE_LIMITS\.ADMIN_API/.test(adminMemberActionApiSource) &&
  /createUserKeyGenerator\(['"]admin_member_action['"]\)/.test(adminMemberActionApiSource) &&
  /rateLimitHeaders:\s*true/.test(adminMemberActionApiSource) &&
  /body:\s*\{[\s\S]*?invalidResponse/.test(adminMemberActionApiSource) &&
  !/parseJsonObjectBody/.test(adminMemberActionApiSource) &&
  !/applyRateLimit\(/.test(adminMemberActionApiSource) &&
  !/addRateLimitHeaders/.test(adminMemberActionApiSource) &&
  !/requireAdmin\(\)/.test(adminMemberActionApiSource) &&
  /from\s+['"]@\/lib\/server\/apiRoute['"]/.test(adminMemberFlagsApiSource) &&
  /export const PATCH = defineApiRoute/.test(adminMemberFlagsApiSource) &&
  /auth:\s*['"]admin['"]/.test(adminMemberFlagsApiSource) &&
  /rateLimit:\s*\{\s*\.\.\.RATE_LIMITS\.ADMIN_API/.test(adminMemberFlagsApiSource) &&
  /createUserKeyGenerator\(['"]admin_member_flags['"]\)/.test(adminMemberFlagsApiSource) &&
  /rateLimitHeaders:\s*true/.test(adminMemberFlagsApiSource) &&
  /body:\s*\{[\s\S]*?invalidResponse/.test(adminMemberFlagsApiSource) &&
  !/parseJsonObjectBody/.test(adminMemberFlagsApiSource) &&
  !/applyRateLimit\(/.test(adminMemberFlagsApiSource) &&
  !/addRateLimitHeaders/.test(adminMemberFlagsApiSource) &&
  !/requireAdmin\(\)/.test(adminMemberFlagsApiSource)
const adminArtistMemberMutationRoutesUseSharedApiRoute =
  /from\s+['"]@\/lib\/server\/apiRoute['"]/.test(adminArtistMembersApiSource) &&
  /export const POST = defineApiRoute/.test(adminArtistMembersApiSource) &&
  /auth:\s*['"]admin['"]/.test(adminArtistMembersApiSource) &&
  /params/.test(adminArtistMembersApiSource) &&
  /rateLimit:\s*\{\s*\.\.\.RATE_LIMITS\.ADMIN_API/.test(adminArtistMembersApiSource) &&
  /createUserKeyGenerator\(['"]admin_artists_id_members['"]\)/.test(adminArtistMembersApiSource) &&
  /rateLimitHeaders:\s*true/.test(adminArtistMembersApiSource) &&
  /body:\s*\{[\s\S]*?invalidResponse/.test(adminArtistMembersApiSource) &&
  !/parseJsonObjectBody/.test(adminArtistMembersApiSource) &&
  !/applyRateLimit\(/.test(adminArtistMembersApiSource) &&
  !/addRateLimitHeaders/.test(adminArtistMembersApiSource) &&
  !/requireAdmin\(\)/.test(adminArtistMembersApiSource) &&
  /from\s+['"]@\/lib\/server\/apiRoute['"]/.test(adminArtistMemberApiSource) &&
  /export const DELETE = defineApiRoute/.test(adminArtistMemberApiSource) &&
  /auth:\s*['"]admin['"]/.test(adminArtistMemberApiSource) &&
  /params/.test(adminArtistMemberApiSource) &&
  /rateLimit:\s*\{\s*\.\.\.RATE_LIMITS\.ADMIN_API/.test(adminArtistMemberApiSource) &&
  /createUserKeyGenerator\(['"]admin_artists_member_action['"]\)/.test(
    adminArtistMemberApiSource
  ) &&
  /rateLimitHeaders:\s*true/.test(adminArtistMemberApiSource) &&
  !/applyRateLimit\(/.test(adminArtistMemberApiSource) &&
  !/addRateLimitHeaders/.test(adminArtistMemberApiSource) &&
  !/requireAdmin\(\)/.test(adminArtistMemberApiSource)
// 단계 4: log_user_activity/log_user_activities_batch RPC를 Turso 쿼리
// 계층(logUserActivity/logUserActivitiesBatch)으로 대체했다 — RPC의
// `p_action_type`/`p_target_type`/`p_target_id` 파라미터명은 이제
// `action_type`/`target_type`/`target_id`(logUserActivity의 snake_case
// 입력 필드명)이지만, 검증된 지역변수(actionType/targetType/targetId)만
// 실린다는 성질은 그대로 유지한다.
const validatesActivityLogTypes =
  /parseActivityActionType\(action_type\)/.test(activityLogSource) &&
  /parseActivityTargetType\(target_type\)/.test(activityLogSource) &&
  /validateUUID\(target_id,\s*['"]대상 ID['"]\)/.test(activityLogSource) &&
  /action_type:\s*actionType/.test(activityLogSource) &&
  /target_type:\s*targetType/.test(activityLogSource) &&
  /target_id:\s*targetId/.test(activityLogSource) &&
  /parseActivityActionType\(log\.action_type\)/.test(activityBatchLogSource) &&
  /parseActivityTargetType\(log\.target_type\)/.test(activityBatchLogSource) &&
  /validateUUID\(log\.target_id,\s*['"]대상 ID['"]\)/.test(activityBatchLogSource) &&
  // 배치는 logUserActivitiesBatch(배열 인자, 단계 4)로 일괄 기록 — 검증된
  // 값(actionType/targetType/targetId)만 payload에 실리는지 확인
  /logUserActivitiesBatch\(/.test(activityBatchLogSource) &&
  /action_type:\s*actionType/.test(activityBatchLogSource) &&
  /target_type:\s*targetType/.test(activityBatchLogSource) &&
  /target_id:\s*targetId/.test(activityBatchLogSource) &&
  /target_type:\s*['"]system['"]/.test(loginPageSource) &&
  !/target_type:\s*['"]auth['"]/.test(loginPageSource) &&
  !/action_type:\s*action_type,/.test(activityLogSource) &&
  !/target_type:\s*target_type,/.test(activityLogSource) &&
  !/target_id:\s*target_id,/.test(activityLogSource) &&
  !/action_type:\s*log\.action_type/.test(activityBatchLogSource) &&
  !/target_type:\s*log\.target_type/.test(activityBatchLogSource) &&
  !/target_id:\s*log\.target_id/.test(activityBatchLogSource)
const boardRoomDynamicRouteChecks = [
  {
    path: 'src/app/api/board-room/meetings/[id]/route.ts',
    label: '회의 ID',
    methods: ['GET', 'PATCH', 'DELETE'],
  },
  {
    path: 'src/app/api/board-room/agendas/[id]/route.ts',
    label: '안건 ID',
    methods: ['PATCH', 'DELETE'],
  },
  {
    path: 'src/app/api/board-room/minutes/[id]/route.ts',
    label: '회의록 ID',
    methods: ['PATCH', 'DELETE'],
  },
  {
    path: 'src/app/api/board-room/documents/[id]/route.ts',
    label: '서류 ID',
    methods: ['DELETE'],
  },
].filter(({ path: routePath, label, methods }) => {
  const source = readSourceAt(join(root, routePath))
  return !(
    /validateUUID/.test(source) &&
    source.includes(label) &&
    methods.every(method =>
      new RegExp(
        `export\\s+async\\s+function\\s+${method}[\\s\\S]*?validate[A-Za-z]+Id\\(params\\.id\\)[\\s\\S]*?const\\s+id\\s*=\\s*routeId\\.id`
      ).test(source)
    )
  )
})
const boardRoomAttendeesPath = join(root, 'src/app/api/board-room/attendees/route.ts')
const boardRoomAttendeesSource = readSourceAt(boardRoomAttendeesPath)
const boardRoomConstantsPath = join(root, 'src/constants/boardRoom.ts')
const boardRoomConstantsSource = readSourceAt(boardRoomConstantsPath)
const boardRoomMeetingsPath = join(root, 'src/app/api/board-room/meetings/route.ts')
const boardRoomMeetingsSource = readSourceAt(boardRoomMeetingsPath)
const boardRoomMeetingDetailPath = join(root, 'src/app/api/board-room/meetings/[id]/route.ts')
const boardRoomMeetingDetailSource = readSourceAt(boardRoomMeetingDetailPath)
const boardRoomAgendaDetailPath = join(root, 'src/app/api/board-room/agendas/[id]/route.ts')
const boardRoomAgendaDetailSource = readSourceAt(boardRoomAgendaDetailPath)
const boardRoomMinutesPath = join(root, 'src/app/api/board-room/minutes/route.ts')
const boardRoomMinutesSource = readSourceAt(boardRoomMinutesPath)
const boardRoomMinutesDetailPath = join(root, 'src/app/api/board-room/minutes/[id]/route.ts')
const boardRoomMinutesDetailSource = readSourceAt(boardRoomMinutesDetailPath)
const contentFormatConstantsPath = join(root, 'src/constants/contentFormat.ts')
const contentFormatConstantsSource = readSourceAt(contentFormatConstantsPath)
// Task 4: board_meeting_attendees 권위가 Turso로 옮겨지며 GET의 조회가
// Supabase `.eq('meeting_id', sanitizedMeetingId)`에서 쿼리 계층 호출
// `listMeetingAttendees(sanitizedMeetingId)`(src/db/queries/board.ts)로,
// PUT의 쓰기가 행마다 `meeting_id: sanitizedMeetingId`를 싣던 것에서
// `upsertMeetingAttendees(sanitizedMeetingId, rows)`(첫 인자로 스코프)로
// 바뀌었다. 이 라우트에는 Supabase 호출이 한 줄도 남지 않았고, 옛
// `meeting_id: sanitizedMeetingId` 패턴은 이제 응답 본문에만 남아 DB 쓰기를
// 전혀 고정하지 못한다 — 새 호출부에만 고정한다(리뷰 1회차 Important 1).
const validatesBoardRoomAttendeesMeetingId =
  /validateUUID/.test(boardRoomAttendeesSource) &&
  /validateMeetingId/.test(boardRoomAttendeesSource) &&
  /validateMemberId/.test(boardRoomAttendeesSource) &&
  /const\s+routeMeetingId\s*=\s*validateMeetingId\(meetingId\)/.test(boardRoomAttendeesSource) &&
  /const\s+sanitizedMeetingId\s*=\s*routeMeetingId\.id/.test(boardRoomAttendeesSource) &&
  /listMeetingAttendees\(sanitizedMeetingId\)/.test(boardRoomAttendeesSource) &&
  /upsertMeetingAttendees\(sanitizedMeetingId,/.test(boardRoomAttendeesSource) &&
  /const\s+memberId\s*=\s*validateMemberId\(r\.member_id\)/.test(boardRoomAttendeesSource) &&
  /member_id:\s*memberId\.id/.test(boardRoomAttendeesSource)
// Task 4: board_minutes 권위가 Turso로 옮겨지며 이 두 라우트가
// `createMinutes({..., contentFormat, ...})`/
// `updateMinutes(id, {..., contentFormat: bodyContentFormat})`
// (src/db/queries/board.ts, 필드명 camelCase)를 쓴다. 두 라우트에 Supabase
// 호출은 한 줄도 남지 않았으므로 옛 패턴 분기는 죽은 코드였다.
//
// 생성 쪽 긍정 검사는 반드시 `createMinutes({...})` 호출부에 고정한다 —
// 파일 어디의 `contentFormat,` 토큰(함수 인자·구조분해·로그)으로도 만족되면
// 아무것도 안 지킨다(리뷰 1회차 Important 2). 두 라우트 모두 "검증 안 된 body
// 값 직행" 음의 검사를 snake_case/camelCase 양쪽으로 건다.
const validatesBoardRoomMinutesContentFormat =
  /CONTENT_FORMATS\s*=\s*\[['"]plain['"],\s*['"]html['"],\s*['"]markdown['"]\]\s+as const/.test(
    contentFormatConstantsSource
  ) &&
  /parseContentFormat/.test(contentFormatConstantsSource) &&
  /parseContentFormat\(body\.content_format\)/.test(boardRoomMinutesSource) &&
  /createMinutes\(\{[^)]*?\bcontentFormat,/.test(boardRoomMinutesSource) &&
  /parseContentFormat\(body\.content_format\)/.test(boardRoomMinutesDetailSource) &&
  // c39679f에서 요청 포맷/유효 포맷 구분을 위해 지역 변수가 bodyContentFormat으로
  // 개명됨 — "allowlist 검증값만 대입" 결선을 함께 고정
  /bodyContentFormat = parseContentFormat\(body\.content_format\)/.test(
    boardRoomMinutesDetailSource
  ) &&
  /update\.contentFormat = bodyContentFormat/.test(boardRoomMinutesDetailSource) &&
  !/update\.content_format = body\.content_format/.test(boardRoomMinutesDetailSource) &&
  !/update\.contentFormat = body\.content_format/.test(boardRoomMinutesDetailSource) &&
  !/content_format:\s*body\.content_format/.test(boardRoomMinutesSource) &&
  !/contentFormat:\s*body\.content_format/.test(boardRoomMinutesSource)
const validatesBoardRoomMeetingDateInputs =
  /parseBoardMeetingDate/.test(boardRoomConstantsSource) &&
  /\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$/.test(boardRoomConstantsSource) &&
  /parseBoardMeetingDeadline/.test(boardRoomConstantsSource) &&
  /parseBoardMeetingCandidateDates/.test(boardRoomConstantsSource) &&
  /MAX_BOARD_MEETING_CANDIDATE_DATES/.test(boardRoomConstantsSource) &&
  /parseBoardMeetingCandidateDates\(body\.candidate_dates\)/.test(boardRoomMeetingsSource) &&
  /parseBoardMeetingDeadline\(body\.vote_deadline\)/.test(boardRoomMeetingsSource) &&
  /parseBoardMeetingDeadline\(body\.vote_deadline\)/.test(boardRoomMeetingDetailSource) &&
  /const confirmDate = parseBoardMeetingDate\(body\.confirm_date\)/.test(
    boardRoomMeetingDetailSource
  ) &&
  // Task 4: board_meetings/board_meeting_date_options 권위가 Turso로
  // 옮겨지며 확정 날짜 검증이 Supabase `.eq('candidate_date', confirmDate)`
  // 에서 쿼리 계층 호출 `getDateOptionByMeetingAndDate(id, confirmDate)`
  // (src/db/queries/board.ts)로, 갱신 필드가 `update.meeting_date =
  // confirmDate`에서 `update.meetingDate = confirmDate`(camelCase)로
  // 바뀌었다. 이 라우트에는 Supabase 호출이 한 줄도 남지 않았으므로 옛 패턴
  // 분기는 죽은 코드였다(리뷰 1회차 Important 1).
  /getDateOptionByMeetingAndDate\(id,\s*confirmDate\)/.test(boardRoomMeetingDetailSource) &&
  /update\.meetingDate = confirmDate/.test(boardRoomMeetingDetailSource) &&
  /body\.status !== undefined/.test(boardRoomMeetingDetailSource) &&
  /BOARD_MEETING_STATUS/.test(boardRoomMeetingDetailSource) &&
  !/filter\(\(date\): date is string => typeof date === ['"]string['"]\)/.test(
    boardRoomMeetingsSource
  ) &&
  !/vote_deadline = body\.vote_deadline/.test(boardRoomMeetingDetailSource) &&
  !/\.eq\(['"]candidate_date['"],\s*body\.confirm_date\)/.test(boardRoomMeetingDetailSource)
// Task 4: board_agendas 권위가 Turso로 옮겨지며 갱신 필드가
// `update.sort_order = sortOrder`에서 `update.sortOrder = sortOrder`
// (camelCase, src/db/queries/board.ts의 updateAgenda 시그니처)로 바뀌었다.
// 이 라우트에는 Supabase 호출이 한 줄도 남지 않았으므로 옛 표기 분기는 죽은
// 코드였다(리뷰 1회차 Important 1). 음의 검사만 두 표기를 함께 막는다.
const validatesBoardRoomAgendaSortOrder =
  /parseBoardAgendaSortOrder/.test(boardRoomConstantsSource) &&
  /Number\.isInteger\(value\)/.test(boardRoomConstantsSource) &&
  /MAX_BOARD_AGENDA_SORT_ORDER/.test(boardRoomConstantsSource) &&
  /parseBoardAgendaSortOrder\(body\.sort_order\)/.test(boardRoomAgendaDetailSource) &&
  /update\.sortOrder = sortOrder/.test(boardRoomAgendaDetailSource) &&
  !/update\.sort_order = body\.sort_order/.test(boardRoomAgendaDetailSource) &&
  !/update\.sortOrder = body\.sort_order/.test(boardRoomAgendaDetailSource)
// Task 4: 세 라우트 모두 board_agendas/board_minutes/board_meeting_date_options
// 권위가 Turso로 옮겨지며 Supabase 오브젝트 리터럴(`meeting_id:
// sanitizedMeetingId`)·`.eq(...)` 조회가 쿼리 계층 함수 호출
// (src/db/queries/board.ts)로 바뀌었다. 세 라우트에 Supabase 호출은 한 줄도
// 남지 않았고, 옛 `option_id: sanitizedOptionId` 같은 표기는 이제 응답 본문에만
// 남아 DB 경계를 전혀 고정하지 못한다 — 새 호출부(`dbWritePattern`/
// `lookupPattern`)에만 고정한다(리뷰 1회차 Important 1). "검증된 sanitized
// 값만 DB 경계에 쓰인다"는 성질은 그대로 지킨다.
const boardRoomCreateRouteIdChecks = [
  {
    path: 'src/app/api/board-room/agendas/route.ts',
    idLabel: '회의 ID',
    rawName: 'meetingId',
    sanitizedName: 'sanitizedMeetingId',
    dbWritePattern: /createAgenda\(\{[^)]*?meetingId:\s*sanitizedMeetingId/,
    lookupPattern: /getLastAgendaSortOrder\(sanitizedMeetingId\)/,
  },
  {
    path: 'src/app/api/board-room/minutes/route.ts',
    idLabel: '회의 ID',
    rawName: 'meetingId',
    sanitizedName: 'sanitizedMeetingId',
    dbWritePattern: /createMinutes\(\{[^)]*?meetingId:\s*sanitizedMeetingId/,
    lookupPattern: /getMinutesIdByMeetingId\(sanitizedMeetingId\)/,
  },
  {
    path: 'src/app/api/board-room/date-votes/route.ts',
    idLabel: '후보 날짜 ID',
    rawName: 'optionId',
    sanitizedName: 'sanitizedOptionId',
    dbWritePattern: /upsertDateVote\(sanitizedOptionId,/,
    lookupPattern: /getDateOptionMeetingId\(sanitizedOptionId\)/,
  },
].filter(({ path: routePath, idLabel, rawName, sanitizedName, dbWritePattern, lookupPattern }) => {
  const source = readSourceAt(join(root, routePath))
  return !(
    /validateUUID/.test(source) &&
    source.includes(idLabel) &&
    new RegExp(`validate[A-Za-z]+Id\\(${rawName}\\)`).test(source) &&
    new RegExp(`const\\s+${sanitizedName}\\s*=`).test(source) &&
    dbWritePattern.test(source) &&
    lookupPattern.test(source)
  )
})
const articleCardPath = join(root, 'src/components/ArticleCard.tsx')
const articleCardSource = readSourceAt(articleCardPath)
const ticketingCardPath = join(root, 'src/components/TicketingCard.tsx')
const ticketingCardSource = readSourceAt(ticketingCardPath)
const featuredProjectsPath = join(root, 'src/components/FeaturedProjects.tsx')
const featuredProjectsSource = readSourceAt(featuredProjectsPath)
const featuredArtistsPath = join(root, 'src/components/FeaturedArtists.tsx')
const featuredArtistsSource = readSourceAt(featuredArtistsPath)
// 홈의 아티스트 사진은 FeaturedArtists(타이포 인덱스로 재설계되어 사진이 없다)가
// 아니라 히어로 필름스트립이 렌더한다. 정화 지점도 그쪽으로 옮겨졌다.
const heroFilmstripPath = join(root, 'src/components/HeroFilmstrip.tsx')
const heroFilmstripSource = readSourceAt(heroFilmstripPath)
const artistProjectsPath = join(root, 'src/components/ArtistProjects.tsx')
const artistProjectsSource = readSourceAt(artistProjectsPath)
const baseCardPath = join(root, 'src/components/common/BaseCard.tsx')
const baseCardSource = readSourceAt(baseCardPath)
const lightboxPath = join(root, 'src/components/Lightbox.tsx')
const lightboxSource = readSourceAt(lightboxPath)
const optimizedImagePath = join(root, 'src/components/OptimizedImage.tsx')
const optimizedImageSource = readSourceAt(optimizedImagePath)
const projectsContentPath = join(root, 'src/app/[locale]/projects/ProjectsContent.tsx')
const projectsContentSource = readSourceAt(projectsContentPath)
const adminArtistCardPath = join(root, 'src/app/[locale]/admin/artists/components/ArtistCard.tsx')
const adminArtistCardSource = readSourceAt(adminArtistCardPath)
const adminAssignArtistModalPath = join(
  root,
  'src/app/[locale]/admin/artists/components/AssignArtistModal.tsx'
)
const adminAssignArtistModalSource = readSourceAt(adminAssignArtistModalPath)
const postContentRendererPath = join(root, 'src/components/PostContentRenderer.tsx')
const postContentRendererSource = readSourceAt(postContentRendererPath)
const artistProfilePagePath = join(root, 'src/app/[locale]/artists/[slug]/page.tsx')
const artistProfilePageSource = readSourceAt(artistProfilePagePath)
const artistsContentPath = join(root, 'src/app/[locale]/artists/ArtistsContent.tsx')
const artistsContentSource = readSourceAt(artistsContentPath)
const portfolioLinksPath = join(
  root,
  'src/app/[locale]/mypage/artist/components/PortfolioLinks.tsx'
)
const portfolioLinksSource = readSourceAt(portfolioLinksPath)
const youtubeVideosPath = join(root, 'src/app/[locale]/mypage/artist/components/YoutubeVideos.tsx')
const youtubeVideosSource = readSourceAt(youtubeVideosPath)
const projectDetailPath = join(root, 'src/app/[locale]/projects/[slug]/ProjectDetailContent.tsx')
const projectDetailSource = readSourceAt(projectDetailPath)
const projectDetailPagePath = join(root, 'src/app/[locale]/projects/[slug]/page.tsx')
const projectDetailPageSource = readSourceAt(projectDetailPagePath)
const adminLayoutPath = join(root, 'src/app/[locale]/admin/components/AdminLayout.tsx')
const adminLayoutSource = readSourceAt(adminLayoutPath)
const adminDashboardPath = join(root, 'src/app/[locale]/admin/page.tsx')
const adminDashboardSource = readSourceAt(adminDashboardPath)
const boardEditPagePath = join(root, 'src/app/[locale]/board/[id]/edit/page.tsx')
const boardEditPageSource = readSourceAt(boardEditPagePath)
const validatesBoardRouteIdsBeforeDataAccess =
  /function normalizePostRouteId/.test(boardDetailPageSource) &&
  /validateUUID\(id,\s*['"]게시글 ID['"]\)/.test(boardDetailPageSource) &&
  /const postId = normalizePostRouteId\(resolvedParams\.id\)/.test(boardDetailPageSource) &&
  /if \(!postId\) \{\s*notFound\(\)/.test(boardDetailPageSource) &&
  /const postIdValidation = validateUUID\(id,\s*['"]게시글 ID['"]\)/.test(boardEditPageSource) &&
  /if \(!postIdValidation\.isValid\) \{\s*notFound\(\)/.test(boardEditPageSource) &&
  /const postId = postIdValidation\.sanitized/.test(boardEditPageSource) &&
  !/query: \{ redirect: `\/board\/\$\{id\}\/edit` \}/.test(boardEditPageSource)
const boardWritePagePath = join(root, 'src/app/[locale]/board/write/page.tsx')
const boardWritePageSource = readSourceAt(boardWritePagePath)
const activityPagePath = join(root, 'src/app/[locale]/mypage/activity/page.tsx')
const activityPageSource = readSourceAt(activityPagePath)
const registerPendingPagePath = join(root, 'src/app/[locale]/register/pending/page.tsx')
const registerPendingPageSource = readSourceAt(registerPendingPagePath)
const errorBoundaryPath = join(root, 'src/components/ErrorBoundary.tsx')
const errorBoundarySource = readSourceAt(errorBoundaryPath)
const errorTrackingPath = join(root, 'src/utils/errorTracking.ts')
const errorTrackingSource = readSourceAt(errorTrackingPath)
const clientErrorApiPath = join(root, 'src/app/api/client-error/route.ts')
const clientErrorApiSource = readSourceAt(clientErrorApiPath)
const routeProtectionPath = join(root, 'src/utils/routeProtection.ts')
const routeProtectionSource = readSourceAt(routeProtectionPath)
const loadingStatePath = join(root, 'src/hooks/useLoadingState.ts')
const loadingStateSource = readSourceAt(loadingStatePath)
const commentLikeButtonPath = join(root, 'src/components/CommentLikeButton.tsx')
const commentLikeButtonSource = readSourceAt(commentLikeButtonPath)
const profilePhotoUploaderPath = join(root, 'src/components/ProfilePhotoUploader.tsx')
const profilePhotoUploaderSource = readSourceAt(profilePhotoUploaderPath)
const notificationNavigationPath = join(root, 'src/utils/notificationNavigation.ts')
const notificationNavigationSource = readSourceAt(notificationNavigationPath)
const notificationDropdownPath = join(root, 'src/components/NotificationDropdown.tsx')
const notificationDropdownSource = readSourceAt(notificationDropdownPath)
const notificationsPagePath = join(root, 'src/app/[locale]/notifications/page.tsx')
const notificationsPageSource = readSourceAt(notificationsPagePath)
const adminReportsPagePath = join(root, 'src/app/[locale]/admin/reports/page.tsx')
const adminReportsPageSource = readSourceAt(adminReportsPagePath)
const eventApplicationsPagePath = join(root, 'src/app/[locale]/admin/event-applications/page.tsx')
const eventApplicationsPageSource = readSourceAt(eventApplicationsPagePath)
const boardDocumentListPath = join(root, 'src/app/[locale]/board-room/_components/DocumentList.tsx')
const boardDocumentListSource = readSourceAt(boardDocumentListPath)
const footerPath = join(root, 'src/components/Footer.tsx')
const footerSource = readSourceAt(footerPath)
const connectPagePath = join(root, 'src/app/[locale]/connect/page.tsx')
const connectPageSource = readSourceAt(connectPagePath)
const eventApplicationFormPath = join(root, 'src/components/EventApplicationForm.tsx')
const eventApplicationFormSource = readSourceAt(eventApplicationFormPath)
const boardRoomMeetingsPagePath = join(root, 'src/app/[locale]/board-room/meetings/page.tsx')
const boardRoomMeetingsPageSource = readSourceAt(boardRoomMeetingsPagePath)
const localizedNavigationFiles = [
  ...globSync('src/app/[[]locale[]]/**/*.tsx', {
    cwd: root,
    exclude: ['**/node_modules/**', '**/.next/**'],
  }),
  ...globSync('src/components/**/*.tsx', {
    cwd: root,
    exclude: ['**/node_modules/**', '**/.next/**'],
  }),
]
const nonLocalizedNextLinkImports = localizedNavigationFiles.filter(file => {
  const source = readSourceAt(join(root, file))
  return /from\s+['"]next\/link['"]/.test(source)
})
const nonLocalizedUseRouterImports = localizedNavigationFiles.filter(file => {
  const source = readSourceAt(join(root, file))
  return (
    /from\s+['"]next\/navigation['"]/.test(source) &&
    /import\s+\{[^}]*\buseRouter\b[^}]*\}\s+from\s+['"]next\/navigation['"]/.test(source)
  )
})
const preservesLocaleForInternalNavigation =
  nonLocalizedNextLinkImports.length === 0 &&
  nonLocalizedUseRouterImports.length === 0 &&
  /from\s+['"]@\/i18n\/navigation['"]/.test(adminLayoutSource) &&
  /usePathname/.test(adminLayoutSource) &&
  /from\s+['"]@\/i18n\/navigation['"]/.test(adminDashboardSource) &&
  /from\s+['"]@\/i18n\/navigation['"]/.test(articleCardSource) &&
  /from\s+['"]@\/i18n\/navigation['"]/.test(artistProjectsSource) &&
  /from\s+['"]@\/i18n\/navigation['"]/.test(baseCardSource) &&
  /from\s+['"]@\/i18n\/navigation['"]/.test(boardEditPageSource) &&
  /locale:\s*locale|\blocale,/.test(boardEditPageSource) &&
  /from\s+['"]@\/i18n\/navigation['"]/.test(boardWritePageSource) &&
  /locale:\s*locale|\blocale,/.test(boardWritePageSource) &&
  /useLocale/.test(activityPageSource) &&
  /routing\.defaultLocale/.test(activityPageSource) &&
  /window\.open\(localizedLink,\s*['_"]_blank['_"],\s*['_"]noopener,noreferrer['_"]\)/.test(
    activityPageSource
  ) &&
  /useRouter/.test(registerPendingPageSource) &&
  /router\.push\(['"]\/board['"]\)/.test(registerPendingPageSource) &&
  /getLocaleAwareHomePath/.test(errorBoundarySource) &&
  !/window\.location\.href\s*=\s*['"]\/['"]/.test(errorBoundarySource) &&
  /from\s+['"]@\/i18n\/navigation['"]/.test(routeProtectionSource) &&
  /useLocale/.test(routeProtectionSource) &&
  /getLocalizedBrowserPath/.test(routeProtectionSource) &&
  /getCurrentBrowserPath\(\)\s*!==\s*expectedBrowserPath/.test(routeProtectionSource) &&
  !/window\.location\.pathname\s*!==\s*path/.test(routeProtectionSource)
const validatesNotificationNavigationTargets =
  /UUID_PATTERN/.test(notificationNavigationSource) &&
  /notification\.related_post_id/.test(notificationNavigationSource) &&
  !/notification\.data\?\.post_id/.test(notificationNavigationSource) &&
  /getNotificationRoute\(notification,\s*\{\s*fallbackToNotifications:\s*true\s*\}\)/.test(
    notificationDropdownSource
  ) &&
  /getNotificationRoute\(notification\)/.test(notificationsPageSource) &&
  !/notification\.data\?\.post_id/.test(notificationDropdownSource) &&
  !/notification\.data\?\.post_id/.test(notificationsPageSource)
const protectsExternalCardsFromUnsafeUrls =
  /isSafeInternalPath/.test(articleCardSource) &&
  /toSafeHttpUrl/.test(articleCardSource) &&
  /safeExternalUrl/.test(articleCardSource) &&
  !/new URL\(article\.url\)/.test(articleCardSource) &&
  /toSafeHttpUrl/.test(ticketingCardSource) &&
  /safeTicketingUrl/.test(ticketingCardSource) &&
  !/new URL\(ticketing\.url\)/.test(ticketingCardSource)
const filtersRelatedArticlesToSafeExternalUrls =
  /toSafeHttpUrl/.test(projectDetailPageSource) &&
  /const\s+safeUrl\s*=\s*toSafeHttpUrl\(article\.url\)/.test(projectDetailPageSource) &&
  /safeUrl\s*\?\s*\{\s*\.\.\.article,\s*url:\s*safeUrl\s*\}\s*:\s*null/.test(
    projectDetailPageSource
  ) &&
  !/article\s*=>\s*!article\.url\.startsWith\(['"]\/projects\/['"]\)/.test(projectDetailPageSource)
const protectsMarkdownUrlsFromUnsafeRendering =
  /toSafeLinkHref/.test(postContentRendererSource) &&
  /createImageProxy/.test(postContentRendererSource) &&
  /isSafeInternalPath/.test(postContentRendererSource) &&
  !/href=\{href\}/.test(postContentRendererSource) &&
  !/src=\{src\}/.test(postContentRendererSource) &&
  /toSafeLinkHref/.test(artistProfilePageSource) &&
  !/href=\{href\}/.test(artistProfilePageSource) &&
  /toSafeLinkHref/.test(projectDetailSource) &&
  !/href=\{href\}/.test(projectDetailSource)
const protectsPublicImageSourcesFromUnsafeUrls =
  /toSafeInternalImagePath/.test(featuredProjectsSource) &&
  /const\s+safeCoverImage\s*=\s*toSafeInternalImagePath\(project\.coverImage\)/.test(
    featuredProjectsSource
  ) &&
  !/src=\{project\.coverImage\}/.test(featuredProjectsSource) &&
  // 히어로 필름스트립이 홈의 아티스트 사진을 렌더한다. profileImage는 내부 경로와
  // Storage URL이 섞여 있어 정화 없이 넘기면 외부 URL이 그대로 <img>에 실린다.
  /toSafeArtistImageSrc/.test(heroFilmstripSource) &&
  /src:\s*toSafeArtistImageSrc\(artist\.profileImage\)/.test(heroFilmstripSource) &&
  !/src:\s*artist\.profileImage/.test(heroFilmstripSource) &&
  // FeaturedArtists는 사진 없는 타이포 인덱스다. 사진이 되돌아오면 정화를 거쳐야
  // 하므로 raw src가 생기는지 계속 감시한다.
  !/src=\{artist\.profileImage\}/.test(featuredArtistsSource) &&
  /toSafeInternalImagePath/.test(artistProjectsSource) &&
  /const\s+safeCoverImage\s*=\s*toSafeInternalImagePath\(project\.coverImage\)/.test(
    artistProjectsSource
  ) &&
  !/src=\{project\.coverImage\}/.test(artistProjectsSource) &&
  /toSafeInternalImagePath/.test(baseCardSource) &&
  /const\s+safeImageSrc\s*=\s*toSafeInternalImagePath\(image\.src\)/.test(baseCardSource) &&
  !/src=\{image\.src\}/.test(baseCardSource) &&
  /toSafeArtistImageSrc/.test(artistsContentSource) &&
  /const\s+safeProfileImage\s*=\s*toSafeArtistImageSrc\(artist\.profileImage\)/.test(
    artistsContentSource
  ) &&
  !/src=\{artist\.profileImage\}/.test(artistsContentSource) &&
  /toSafeArtistImageSrc/.test(artistProfilePageSource) &&
  /safeProfileImage/.test(artistProfilePageSource) &&
  !/src=\{artist\.profileImage\}/.test(artistProfilePageSource) &&
  /toSafeInternalImagePath/.test(projectsContentSource) &&
  /const\s+safeCoverImage\s*=\s*toSafeInternalImagePath\(project\.coverImage\)/.test(
    projectsContentSource
  ) &&
  !/src=\{project\.coverImage\}/.test(projectsContentSource) &&
  /toSafeArtistImageSrc/.test(adminArtistCardSource) &&
  /const\s+safeProfileImage\s*=\s*toSafeArtistImageSrc\(artist\.profileImage\)/.test(
    adminArtistCardSource
  ) &&
  !/src=\{artist\.profileImage\}/.test(adminArtistCardSource) &&
  /toSafeArtistImageSrc/.test(adminAssignArtistModalSource) &&
  /const\s+safeProfileImage\s*=\s*toSafeArtistImageSrc\(artist\.profileImage\)/.test(
    adminAssignArtistModalSource
  ) &&
  !/src=\{artist\.profileImage\}/.test(adminAssignArtistModalSource) &&
  /toSafeInternalImagePath/.test(projectDetailSource) &&
  /safeCoverImage/.test(projectDetailSource) &&
  /safeRelatedCoverImage/.test(projectDetailSource) &&
  /safeGalleryImage/.test(projectDetailSource) &&
  !/src=\{project\.coverImage\}/.test(projectDetailSource) &&
  !/src=\{relatedProject\.coverImage\}/.test(projectDetailSource) &&
  !/src=\{image\}/.test(projectDetailSource) &&
  /toSafeInternalImagePath/.test(lightboxSource) &&
  /const\s+safeImages\s*=\s*images\.map\(image\s*=>\s*toSafeInternalImagePath\(image\)\)/.test(
    lightboxSource
  ) &&
  /safeCurrentIndex/.test(lightboxSource) &&
  /src=\{safeImages\[safeCurrentIndex\]\}/.test(lightboxSource) &&
  !/src=\{images\[currentIndex\]\}/.test(lightboxSource)
const preservesAdminArtistAssignmentApiErrors =
  /let errorMessage = `서버 오류 \(\$\{response\.status\}\)`/.test(adminAssignArtistModalSource) &&
  /errorMessage = errorData\.error/.test(adminAssignArtistModalSource) &&
  /throw new Error\(errorMessage\)/.test(adminAssignArtistModalSource) &&
  !/throw new Error\(errorData\.error \|\| `서버 오류/.test(adminAssignArtistModalSource) &&
  /throw new Error\(['"]서버 응답 형식이 올바르지 않습니다\.['"]\)/.test(
    adminAssignArtistModalSource
  ) &&
  /result\.success !== true/.test(adminAssignArtistModalSource) &&
  !/Treating as success despite parse error/.test(adminAssignArtistModalSource)
const protectsProfileAndOperationalLinksFromUnsafeUrls =
  /toSafeEmailHref/.test(safeUrlSource) &&
  /toSafePhoneHref/.test(safeUrlSource) &&
  /toSafeNaverMapSearchHref/.test(safeUrlSource) &&
  /safePortfolioLinks/.test(artistProfilePageSource) &&
  /artistEmailHref/.test(artistProfilePageSource) &&
  /artistPhoneHref/.test(artistProfilePageSource) &&
  !/href=\{`mailto:\$\{artist\.contact\}`\}/.test(artistProfilePageSource) &&
  !/href=\{`tel:\$\{artist\.contact/.test(artistProfilePageSource) &&
  /youtubeChannelLink/.test(artistProfilePageSource) &&
  !/href=\{link\.url\}/.test(artistProfilePageSource) &&
  /toSafeHttpUrl/.test(portfolioLinksSource) &&
  /href=\{safeUrl\}/.test(portfolioLinksSource) &&
  !/href=\{link\.url\}/.test(portfolioLinksSource) &&
  /toSafeHttpUrl/.test(youtubeVideosSource) &&
  /href=\{safeUrl\}/.test(youtubeVideosSource) &&
  !/href=\{video\.url\}/.test(youtubeVideosSource) &&
  /safeVideoUrl/.test(projectDetailSource) &&
  /safeApplicationFormUrl/.test(projectDetailSource) &&
  !/href=\{project\.videoUrl\}/.test(projectDetailSource) &&
  !/href=\{project\.applicationForm\.url\}/.test(projectDetailSource) &&
  /safePhotoUrl/.test(eventApplicationsPageSource) &&
  !/href=\{app\.photo_url\}/.test(eventApplicationsPageSource) &&
  !/src=\{app\.photo_url\}/.test(eventApplicationsPageSource) &&
  /safeDownloadUrl/.test(boardDocumentListSource) &&
  !/href=\{doc\.download_url\}/.test(boardDocumentListSource) &&
  /safeInstagramUrl/.test(footerSource) &&
  /safeYoutubeUrl/.test(footerSource) &&
  /safeEmailHref/.test(footerSource) &&
  /safePhoneHref/.test(footerSource) &&
  /safeAddressHref/.test(footerSource) &&
  !/href=\{`mailto:\$\{data\.contact\.email\}`\}/.test(footerSource) &&
  !/href=\{`tel:\$\{data\.contact\.phone\}`\}/.test(footerSource) &&
  !/map\.naver\.com\/v5\/search\/\$\{encodeURIComponent\(data\.contact\.address\)\}/.test(
    footerSource
  ) &&
  !/href=\{data\.social\./.test(footerSource) &&
  /safeInstagramUrl/.test(connectPageSource) &&
  /safeYoutubeUrl/.test(connectPageSource) &&
  /safeEmailHref/.test(connectPageSource) &&
  /safePhoneHref/.test(connectPageSource) &&
  /safeAddressHref/.test(connectPageSource) &&
  !/href=\{`mailto:\$\{globalData\.contact\.email\}`\}/.test(connectPageSource) &&
  !/href=\{`tel:\$\{globalData\.contact\.phone\}`\}/.test(connectPageSource) &&
  !/map\.naver\.com\/v5\/search\/\$\{encodeURIComponent\(globalData\.contact\.address\)\}/.test(
    connectPageSource
  ) &&
  !/href=\{globalData\.social\./.test(connectPageSource)
const preservesSafeLoginRedirects =
  /useSearchParams/.test(loginPageSource) &&
  /toSafeInternalRedirectPath/.test(loginPageSource) &&
  /searchParams\.get\(['"]redirect['"]\)/.test(loginPageSource) &&
  /explicitRedirectPath/.test(loginPageSource) &&
  /navigateWithRetry\(explicitRedirectPath/.test(loginPageSource)
const avoidsClientOperationalConsoleNoise =
  !/console\.log\(/.test(loginPageSource) &&
  !/\[LOGIN DEBUG\]/.test(loginPageSource) &&
  !/console\.log\(/.test(notificationsPageSource) &&
  !/console\.log\(/.test(adminReportsPageSource) &&
  !/console\.log\(/.test(adminAssignArtistModalSource) &&
  !/console\.log\(/.test(adminSettingsPageSource) &&
  /debugRouteProtection/.test(routeProtectionSource) &&
  /errorRouteProtection/.test(routeProtectionSource) &&
  !/console\.log\(/.test(
    routeProtectionSource
      .replace(/const debugRouteProtection[\s\S]*?\n\}/, '')
      .replace(/const warnRouteProtection[\s\S]*?\n\}/, '')
      .replace(/const errorRouteProtection[\s\S]*?\n\}/, '')
  ) &&
  !/console\.error\(/.test(
    routeProtectionSource
      .replace(/const debugRouteProtection[\s\S]*?\n\}/, '')
      .replace(/const warnRouteProtection[\s\S]*?\n\}/, '')
      .replace(/const errorRouteProtection[\s\S]*?\n\}/, '')
  ) &&
  /process\.env\.NODE_ENV === ['"]development['"][\s\S]*?Auto-recovery attempt/.test(
    errorBoundarySource
  )
// 단계 4 Task 5: middleware.ts의 유일한 debug 로그였던 "Supabase env missing,
// skipping auth middleware"가 그 분기와 함께 사라져 로거 자체를 걷어냈다.
// 그래서 middleware.ts에는 "console.log로 되돌아가지 않는다"는 음성 단정만
// 남기고, 로거 경유 요구는 실제로 debug 로그가 있는 auth.ts에만 건다 —
// 없는 로그를 요구하면 아무도 못 지키는(또는 지키려고 죽은 로그를 넣는)
// 가드가 된다.
const middlewareUsesStructuredDebugLogging =
  /createLogger\(['"]middleware\/auth['"]\)/.test(authMiddlewareSource) &&
  /log\.debug/.test(authMiddlewareSource) &&
  !/console\.log\(/.test(rootMiddlewareSource) &&
  !/console\.log\(/.test(authMiddlewareSource) &&
  !/\[MIDDLEWARE DEBUG\]/.test(authMiddlewareSource)
const adminReportsGuardsStatsFetchLifecycle =
  /const mountedRef = useRef\(true\)/.test(adminReportsPageSource) &&
  /const statsRequestSeqRef = useRef\(0\)/.test(adminReportsPageSource) &&
  /mountedRef\.current = false/.test(adminReportsPageSource) &&
  /const requestSeq = \+\+statsRequestSeqRef\.current/.test(adminReportsPageSource) &&
  /const shouldApplyStatsResult = \(\) =>\s*mountedRef\.current && requestSeq === statsRequestSeqRef\.current/.test(
    adminReportsPageSource
  ) &&
  /if \(!shouldApplyStatsResult\(\)\) \{\s*return\s*\}/.test(adminReportsPageSource) &&
  /if \(shouldApplyStatsResult\(\)\) \{\s*setStatsLoading\(false\)\s*\}/.test(
    adminReportsPageSource
  )
const avoidsLoadingStateProductionConsoleNoise =
  /const shouldLogLoadingState = options\.enableLogging && process\.env\.NODE_ENV === ['"]development['"]/.test(
    loadingStateSource
  ) && !/if \(options\.enableLogging\) \{\s*console\.(?:log|warn|error)\(/.test(loadingStateSource)
const loadingStateAppliesOperationOptions =
  /startLoading\(mergedOptions\)/.test(loadingStateSource) &&
  /finishLoading\(result,\s*mergedOptions\)/.test(loadingStateSource) &&
  /failLoading\(error as Error,\s*mergedOptions\)/.test(loadingStateSource) &&
  /startLoading\(key,\s*mergedOptions\)/.test(loadingStateSource) &&
  /finishLoading\(key,\s*result,\s*mergedOptions\)/.test(loadingStateSource) &&
  /failLoading\(key,\s*error as Error,\s*mergedOptions\)/.test(loadingStateSource)
const singleLoadingStateClearsPreviousTimeout =
  /const startLoading = useCallback\(\s*\(\s*effectiveOptions:[\s\S]*?if \(timeoutRef\.current\) \{\s*clearTimeout\(timeoutRef\.current\)\s*timeoutRef\.current = null\s*\}[\s\S]*?timeoutRef\.current = setTimeout/.test(
    loadingStateSource
  )
const commentLikeButtonCleansAnimationTimer =
  /useRef<NodeJS\.Timeout \| null>\(null\)/.test(commentLikeButtonSource) &&
  /const animationTimeoutRef/.test(commentLikeButtonSource) &&
  /clearTimeout\(animationTimeoutRef\.current\)/.test(commentLikeButtonSource) &&
  /animationTimeoutRef\.current = null/.test(commentLikeButtonSource) &&
  /useEffect\(\(\) => \{\s*return \(\) => \{[\s\S]*?clearTimeout\(animationTimeoutRef\.current\)/.test(
    commentLikeButtonSource
  ) &&
  !/setTimeout\(\(\) => setIsAnimating\(false\),\s*300\)/.test(commentLikeButtonSource)
const profilePhotoUploaderCleansUploadTimers =
  /const progressIntervalRef = useRef<ReturnType<typeof setInterval> \| null>\(null\)/.test(
    profilePhotoUploaderSource
  ) &&
  /const resetTimeoutRef = useRef<ReturnType<typeof setTimeout> \| null>\(null\)/.test(
    profilePhotoUploaderSource
  ) &&
  /const clearUploadTimers = useCallback/.test(profilePhotoUploaderSource) &&
  /clearInterval\(progressIntervalRef\.current\)/.test(profilePhotoUploaderSource) &&
  /clearTimeout\(resetTimeoutRef\.current\)/.test(profilePhotoUploaderSource) &&
  /useEffect\(\(\) => \{\s*return clearUploadTimers\s*\}, \[clearUploadTimers\]\)/.test(
    profilePhotoUploaderSource
  ) &&
  !/const progressInterval = setInterval/.test(profilePhotoUploaderSource) &&
  !/clearInterval\(progressInterval\)/.test(profilePhotoUploaderSource)
const adminSettingsSchedulesStatusClear =
  /const scheduleStatusClear = \(delayMs: number,\s*options: \{ clearError\?: boolean \} = \{\}\) => \{[\s\S]*?clearStatusTimer\(\)[\s\S]*?statusTimerRef\.current = setTimeout/.test(
    adminSettingsPageSource
  )
const adminSettingsStatusTimersPreserveNewErrors =
  /scheduleStatusClear\(3000,\s*\{ clearError: false \}\)/.test(adminSettingsPageSource) &&
  /const \{ clearError = true \} = options/.test(adminSettingsPageSource) &&
  /if \(clearError\) \{\s*setError\(null\)\s*\}/.test(adminSettingsPageSource)
const adminSettingsCleansStatusTimers =
  /const statusTimerRef = useRef<ReturnType<typeof setTimeout> \| null>\(null\)/.test(
    adminSettingsPageSource
  ) &&
  /const clearStatusTimer = \(\) => \{[\s\S]*?clearTimeout\(statusTimerRef\.current\)/.test(
    adminSettingsPageSource
  ) &&
  adminSettingsSchedulesStatusClear &&
  adminSettingsStatusTimersPreserveNewErrors &&
  /useEffect\(\(\) => \{[\s\S]*?return clearStatusTimer[\s\S]*?\}, \[\]\)/.test(
    adminSettingsPageSource
  ) &&
  !/setTimeout\(\(\) => setSuccess\(null\),\s*3000\)/.test(adminSettingsPageSource) &&
  !/setTimeout\(\(\) => \{\s*setSuccess\(null\)\s*setError\(null\)\s*\},\s*5000\)/.test(
    adminSettingsPageSource
  )
const sendsClientErrorReportsToApi =
  /fetch\(['"]\/api\/client-error['"]/.test(errorTrackingSource) &&
  /keepalive:\s*immediate/.test(errorTrackingSource) &&
  /client-error endpoint rejected report/.test(errorTrackingSource) &&
  /Promise\.allSettled\(requests\)/.test(errorTrackingSource) &&
  /fetch\(['"]\/api\/client-error['"]/.test(errorBoundarySource) &&
  /keepalive:\s*true/.test(errorBoundarySource) &&
  /function sanitizeClientErrorUrl/.test(clientErrorApiSource) &&
  /parsed\.origin/.test(clientErrorApiSource) &&
  /parsed\.pathname/.test(clientErrorApiSource) &&
  !/const url = body\.url \? String\(body\.url\)/.test(clientErrorApiSource) &&
  !/console\.log\(['"]Sending errors to external service/.test(errorTrackingSource) &&
  !/fetch\(['"]\/api\/errors['"]/.test(errorTrackingSource) &&
  !/Error logged to service/.test(errorBoundarySource)
const redactsSecurityEventDetails =
  /function sanitizeSecurityEventDetails/.test(securitySource) &&
  /function sanitizeSecurityEventValue/.test(securitySource) &&
  /function sanitizeSecurityUrl/.test(securitySource) &&
  /parsed\.origin/.test(securitySource) &&
  /parsed\.pathname/.test(securitySource) &&
  /maskSecurityEmail/.test(securitySource) &&
  /REDACTED_SECURITY_VALUE/.test(securitySource) &&
  /const sanitizedDetails = sanitizeSecurityEventDetails\(details\)/.test(securitySource) &&
  /\.\.\.sanitizedDetails/.test(securitySource) &&
  !/\.\.\.details,\s*\n\s*timestamp/.test(securitySource) &&
  !/Invalid URL format:['"],\s*url/.test(securitySource)
const avoidsProjectPreviewRawUrlLogs =
  /createLogger\(['"]projects\/project-page['"]\)/.test(projectDetailPageSource) &&
  /function describeExternalUrlForLog/.test(projectDetailPageSource) &&
  /parsed\.origin/.test(projectDetailPageSource) &&
  /parsed\.pathname/.test(projectDetailPageSource) &&
  !/Failed to fetch preview for \$\{article\.url\}/.test(projectDetailPageSource)
const validatesEventApplicationPhotoPreviewUrls =
  /isValidEventApplicationPhotoUrl/.test(eventApplicationFormSource) &&
  /uploadedPhotoUrl/.test(eventApplicationFormSource) &&
  /isValidEventApplicationPhotoUrl\(uploadedPhotoUrl\)/.test(eventApplicationFormSource) &&
  /const\s+safePhotoUrl\s*=\s*isValidEventApplicationPhotoUrl\(photoUrl\)\s*\?\s*photoUrl\s*:\s*['"]['"]/.test(
    eventApplicationFormSource
  ) &&
  /src=\{safePhotoUrl\}/.test(eventApplicationFormSource) &&
  /payload\.photo_url\s*=\s*safePhotoUrl\s*\|\|\s*undefined/.test(eventApplicationFormSource) &&
  !/src=\{photoUrl\}/.test(eventApplicationFormSource) &&
  !/payload\.photo_url\s*=\s*photoUrl\s*\|\|\s*undefined/.test(eventApplicationFormSource)
const parsesImageAllowedQualitiesSafely =
  /parseIntegerParam/.test(optimizedImageSource) &&
  /parseIntegerParam\(value,\s*Number\.NaN,\s*\{\s*min:\s*1,\s*max:\s*100\s*\}\)/.test(
    optimizedImageSource
  ) &&
  !/parseInt\(value\.trim\(\),\s*10\)/.test(optimizedImageSource)
const avoidsOptimizedImageProductionUrlLogs =
  /process\.env\.NODE_ENV === ['"]development['"][\s\S]*?이미지 로딩 실패:[\s\S]*?currentSrc/.test(
    optimizedImageSource
  ) &&
  /process\.env\.NODE_ENV === ['"]development['"][\s\S]*?모든 이미지 로딩 실패:[\s\S]*?currentSrc/.test(
    optimizedImageSource
  ) &&
  // 컷오버 후(2026-09-01) 이 로그는 Supabase가 아니라 Blob 판정을 따르므로
  // 문구가 '저장소 이미지 재시도'로 바뀌었다. 가드가 보는 것은 문구가 아니라
  // **이 로그가 development 블록 안에 있는가**이며, 그 조건은 그대로다.
  /process\.env\.NODE_ENV === ['"]development['"][\s\S]*?저장소 이미지 재시도[\s\S]*?currentSrc/.test(
    optimizedImageSource
  ) &&
  /process\.env\.NODE_ENV === ['"]development['"][\s\S]*?로딩 지연 감지[\s\S]*?currentSrc/.test(
    optimizedImageSource
  ) &&
  /process\.env\.NODE_ENV === ['"]development['"][\s\S]*?최종 타임아웃[\s\S]*?currentSrc/.test(
    optimizedImageSource
  ) &&
  !/console\.warn\(`\[OptimizedImage\] 모든 이미지 로딩 실패: \$\{currentSrc\}`\)/.test(
    optimizedImageSource.replace(
      /if \(process\.env\.NODE_ENV === ['"]development['"]\) \{[\s\S]*?\}/g,
      ''
    )
  ) &&
  !/console\.warn\([\s\S]*?\$\{currentSrc\}[\s\S]*?\)/.test(
    optimizedImageSource.replace(
      /if \(process\.env\.NODE_ENV === ['"]development['"]\) \{[\s\S]*?\}/g,
      ''
    )
  )
const validatesGeneratedImageUrls =
  /toSafeHttpUrl/.test(imageUrlSource) &&
  /toSafeInternalImagePath/.test(imageUrlSource) &&
  /function normalizeImagePath/.test(imageUrlSource) &&
  /\^https\?:\\\/\\\//.test(imageUrlSource) &&
  /toSafeHttpUrl\(trimmed\)/.test(imageUrlSource) &&
  /toSafeInternalImagePath\(normalized,\s*['"]['"]\)/.test(imageUrlSource) &&
  /normalizeImagePath\(imagePath\) !== null/.test(imageUrlSource) &&
  !/finalPath\.startsWith\(['"]http['"]\)/.test(imageUrlSource) &&
  !/imagePath\.startsWith\(['"]http['"]\)/.test(imageUrlSource) &&
  /toSafeHttpUrl\(link\.url\)/.test(structuredDataSource) &&
  /toSafeHttpUrl\(ticket\.url\) \?\? eventUrl/.test(structuredDataSource) &&
  !/url && url\.startsWith\(['"]http['"]\)/.test(structuredDataSource) &&
  !/url:\s*ticket\.url/.test(structuredDataSource) &&
  /toSecureMetadataImageUrl/.test(projectDetailPageSource) &&
  /secureOgImageUrl/.test(projectDetailPageSource) &&
  !/secureUrl:\s*ogImageUrl\.startsWith\(['"]https:\/\/['"]\)\s*\?\s*ogImageUrl\s*:\s*`\$\{base\}\$\{ogImageUrl\}`/.test(
    projectDetailPageSource
  )
const serializesJsonLdSafely =
  /export function serializeJsonLd/.test(structuredDataSource) &&
  /replace\(\s*\/<\/g,\s*['"]\\\\u003c['"]\s*\)/.test(structuredDataSource) &&
  /replace\(\s*\/>\/g,\s*['"]\\\\u003e['"]\s*\)/.test(structuredDataSource) &&
  /replace\(\s*\/&\/g,\s*['"]\\\\u0026['"]\s*\)/.test(structuredDataSource) &&
  /__html:\s*serializeJsonLd\(data\)/.test(structuredDataSource) &&
  /serializeJsonLd\(jsonLd\)/.test(connectPageSource) &&
  !/__html:\s*JSON\.stringify/.test(structuredDataSource) &&
  !/__html:\s*JSON\.stringify/.test(connectPageSource)
const sortsBoardRoomMeetingYearsSafely =
  /UNKNOWN_YEAR/.test(boardRoomMeetingsPageSource) &&
  /getMeetingYearKey/.test(boardRoomMeetingsPageSource) &&
  /Number\.isInteger\(year\)/.test(boardRoomMeetingsPageSource) &&
  /날짜 미상/.test(boardRoomMeetingsPageSource) &&
  !/Number\(b\)\s*-\s*Number\(a\)/.test(boardRoomMeetingsPageSource)
const mediaUploadPath = join(root, 'src/app/api/media/upload/route.ts')
const mediaUploadSource = readSourceAt(mediaUploadPath)
const avoidsServerOperationalConsoleLogs =
  /createLogger\(['"]api\/security\/csp-report['"]\)/.test(cspReportSource) &&
  /log\.debug\(['"]Ignored CSP report['"]/.test(cspReportSource) &&
  !/console\.log\(/.test(cspReportSource) &&
  // verify-session은 Task 3에서 createLogger를 걷어냈다(1개 → 0개, 인증 헬퍼
  // 수렴 과정에서 로거 의존을 없앰). 나머지 6개 파일은 이 브랜치에서 미변경이라
  // createLogger 존재 요구를 그대로 두지만, 이 파일만 "console.log가 없다"만 본다.
  !/console\.log\(/.test(authVerifySessionCode) &&
  /createLogger\(['"]api\/og\/post['"]\)/.test(postOgImageSource) &&
  /maskId/.test(postOgImageSource) &&
  !/console\.log\(/.test(postOgImageSource) &&
  !/Unsafe attachment image URL, using default OG image['"],\s*imageUrl/.test(postOgImageSource) &&
  /createLogger\(['"]api\/posts\/view['"]\)/.test(postViewSource) &&
  /maskId/.test(postViewSource) &&
  !/console\.log\(/.test(postViewSource) &&
  /createLogger\(['"]api\/mypage\/artist['"]\)/.test(artistProfileSource) &&
  !/console\.log\(/.test(artistProfileSource) &&
  /createLogger\(['"]apiPerformanceMonitor['"]\)/.test(apiPerformanceMonitorSource) &&
  !/console\.log\(/.test(apiPerformanceMonitorSource)
const restrictsMediaUploadBuckets =
  /type\s+AllowedBucket\s*=/.test(mediaUploadSource) &&
  /function\s+isAllowedBucket/.test(mediaUploadSource) &&
  /bucket:\s*AllowedBucket/.test(mediaUploadSource) &&
  /지원하지 않는 Storage bucket입니다/.test(mediaUploadSource)
const sanitizesUploadMetadata =
  /RESERVED_METADATA_KEYS/.test(mediaUploadSource) &&
  /parseMetadataObject/.test(mediaUploadSource) &&
  /sanitizeUserMetadata/.test(mediaUploadSource) &&
  /RESERVED_METADATA_KEYS\.has\(key\)/.test(mediaUploadSource) &&
  /sanitizeUserMetadata\(parseMetadataObject\(metadataValue\)\)/.test(mediaUploadSource) &&
  !/userMetadata\s*=\s*JSON\.parse\(metadataStr\)/.test(mediaUploadSource) &&
  /parseCropSettings/.test(artistPhotoSource) &&
  /getImageDimensions/.test(artistPhotoSource) &&
  /const\s+imageDimensions\s*=\s*await\s+getImageDimensions\(fileBuffer\)/.test(
    artistPhotoSource
  ) &&
  /width:\s*imageDimensions\.width/.test(artistPhotoSource) &&
  /height:\s*imageDimensions\.height/.test(artistPhotoSource) &&
  !/providedMetadata\s*=\s*JSON\.parse/.test(artistPhotoSource) &&
  !/\.\.\.providedMetadata/.test(artistPhotoSource)
const unsafeSearchParamIntegerParsers = appFiles.filter(file => {
  const source = readSourceAt(join(root, file))
  return (
    /parseInt\s*\([^)]*searchParams/.test(source) ||
    /Number\.parseInt\s*\([^)]*searchParams/.test(source)
  )
})
const jsonBodyEmptyObjectFallbacks = appFiles.filter(file => {
  const source = readSourceAt(join(root, file))
  return /request\.json\(\)\.catch\(\s*\(\)\s*=>\s*\(\{\}\)\s*\)/.test(source)
})
const adminMutationJsonBypasses = globSync('src/app/api/admin/**/route.ts', {
  cwd: root,
  exclude: ['**/node_modules/**', '**/.next/**'],
}).filter(file => {
  const source = readSourceAt(join(root, file))
  return /request\.json\(\)/.test(source) && !/parseJsonObjectBody/.test(source)
})
const unsafeBlankWindowOpeners = appFiles.filter(file => {
  const source = readSourceAt(join(root, file))
  return /window\.open\([^)]*,\s*['"]_blank['"]\s*\)/.test(source)
})

const failures = []

if (edgeRuntimeFiles.length > 0) {
  failures.push(
    `Edge runtime declarations remain:\n${edgeRuntimeFiles.map(file => `- ${file}`).join('\n')}`
  )
}

if (logsAtConstruction) {
  failures.push(
    `distributedRateLimiter logs fallback risk during module construction: ${relative(
      root,
      rateLimiterPath
    )}`
  )
}

if (!parsesRedisRateLimitStatsSafely) {
  failures.push(
    `Redis rate-limit stats must parse whole integer counter strings only instead of accepting partial parseInt values: ${relative(
      root,
      rateLimiterPath
    )}`
  )
}

if (!supportsVercelMarketplaceUpstashEnv) {
  failures.push(
    `Distributed rate limiting and production env verification must accept Vercel Marketplace Upstash Redis env names (KV_REST_API_URL/TOKEN) as well as legacy UPSTASH_REDIS_REST_URL/TOKEN:\n- ${relative(
      root,
      rateLimiterPath
    )}\n- ${relative(root, verifyEnvPath)}`
  )
}

if (!productionRateLimiterFailsClosed) {
  failures.push(
    `Production rate limiting must fail closed when Upstash is missing or Redis fails instead of silently using per-instance memory fallback: ${relative(
      root,
      rateLimiterPath
    )}`
  )
}

if (!deploymentGuideAvailable) {
  console.warn(
    `SKIPPED: ${relative(root, deploymentGuidePath)} not found (docs/ is gitignored and untracked, so CI checkouts don't have it) — deployment-guide fail-closed wording check skipped; other runtime risk checks still ran.`
  )
}

if (!productionRateLimiterDocsFailClosed || !productionRateLimiterDeploymentGuideDocsFailClosed) {
  failures.push(
    `Rate limiter wrappers and production docs must describe the same fail-closed behavior as the runtime implementation:\n- ${relative(
      root,
      rateLimiterCompatPath
    )}\n- ${relative(root, rateLimitWrapperPath)}\n- ${relative(root, rateLimiterPath)}\n- ${relative(
      root,
      readmePath
    )}\n- ${relative(root, deploymentGuidePath)}`
  )
}

if (!hasSharedServerRateLimitFacade) {
  failures.push(
    `API route rate limiting must go through the shared server facade so route code depends on one operational boundary: ${relative(
      root,
      serverRateLimitPath
    )}`
  )
}

if (!legacyRateLimitWrappersDelegateToServerFacade) {
  failures.push(
    `Legacy rate-limit wrapper modules must delegate to @/lib/server/rateLimit instead of duplicating route-facing logic:\n- ${relative(
      root,
      rateLimiterCompatPath
    )}\n- ${relative(root, rateLimitWrapperPath)}`
  )
}

if (apiRoutesUsingLegacyRateLimitImports.length > 0) {
  failures.push(
    `API routes must import rate-limit helpers from @/lib/server/rateLimit instead of legacy utils modules:\n${apiRoutesUsingLegacyRateLimitImports
      .map(file => `- ${file}`)
      .join('\n')}`
  )
}

if (apiRoutesUsingDistributedRateLimitSymbols.length > 0) {
  failures.push(
    `API routes must use the public rate-limit facade names instead of distributed implementation symbols:\n${apiRoutesUsingDistributedRateLimitSymbols
      .map(file => `- ${file}`)
      .join('\n')}`
  )
}

if (!hasSharedJsonApiRouteWrapper) {
  failures.push(
    `Ordinary JSON API routes need a shared server route assembly helper that preserves route-owned response shapes while centralizing rate-limit, auth, body parsing, and error handling: ${relative(
      root,
      serverApiRoutePath
    )}`
  )
}

if (!adminActivitiesUsersUsesSharedApiRoute) {
  failures.push(
    `The admin activities users JSON route should exercise the shared API route assembly boundary instead of hand-wiring rate limit and admin auth: ${relative(
      root,
      adminActivitiesUsersPath
    )}`
  )
}

if (!adminAnalyticsRoutesUseSharedApiRoute) {
  failures.push(
    `Admin analytics JSON routes should use the shared API route assembly boundary instead of hand-wiring rate limit and admin auth:\n- ${relative(
      root,
      adminAnalyticsPatternsPath
    )}\n- ${relative(root, adminAnalyticsTrendsPath)}`
  )
}

if (!adminStatsRoutesUseSharedApiRoute) {
  failures.push(
    `Admin stats JSON routes should use the shared API route assembly boundary while preserving their per-route user rate-limit keys and headers:\n${adminStatsRouteSources
      .map(({ path }) => `- ${relative(root, path)}`)
      .join('\n')}`
  )
}

if (!adminListingRoutesUseSharedApiRoute) {
  failures.push(
    `Admin listing JSON routes should use the shared API route assembly boundary while preserving their per-route user rate-limit keys and headers:\n${adminListingRouteSources
      .map(({ path }) => `- ${relative(root, path)}`)
      .join('\n')}`
  )
}

if (!adminPostsAdvancedSearchUsesSharedApiRoute) {
  failures.push(
    `Admin posts advanced-search route should use the shared API route assembly boundary while preserving its search payload validation and per-route rate-limit key: ${relative(
      root,
      adminPostsAdvancedSearchPath
    )}`
  )
}

if (!adminMembersAdvancedSearchUsesSharedApiRoute) {
  failures.push(
    `Admin members advanced-search route should use the shared API route assembly boundary while preserving its search payload validation, per-route rate-limit key, and success headers: ${relative(
      root,
      adminMembersAdvancedSearchPath
    )}`
  )
}

if (!adminMembersBulkUsesSharedApiRoute) {
  failures.push(
    `Admin members bulk route should use the shared API route assembly boundary while preserving distinct bulk/status rate-limit policies, body parsing, and success headers: ${relative(
      root,
      adminMembersBulkApiPath
    )}`
  )
}

if (!adminSettingsRoutesUseSharedBoundary) {
  failures.push(
    `Admin settings routes should share a settings-specific Supabase auth resolver and the JSON API route assembly boundary instead of hand-wiring auth, rate limits, and JSON parsing:\n${adminSettingsRouteSources
      .map(({ path }) => `- ${relative(root, path)}`)
      .join('\n')}\n- ${relative(root, settingsAdminAuthPath)}`
  )
}

if (!pinsSystemSettingsHistoryActor) {
  failures.push(
    `System settings writes must record the authenticated admin as the history actor (actorId: user.id from the route auth context) — system_settings_history is the only record of who changed a setting:\n${settingsWriteRouteSources
      .map(({ path }) => `- ${relative(root, path)}`)
      .join('\n')}`
  )
}

if (!adminStandaloneRoutesUseSharedApiRoute) {
  failures.push(
    `Admin performance, real-time activity, and report-generation routes should use the shared API route assembly boundary while preserving route-specific rate-limit/header/body behavior:\n- ${relative(
      root,
      adminPerformancePath
    )}\n- ${relative(root, adminActivitiesRealTimePath)}\n- ${relative(
      root,
      adminReportsGeneratePath
    )}`
  )
}

if (!adminRealtimeStreamUsesSharedStreamRoute) {
  failures.push(
    `Admin real-time SSE stream should use a stream-specific route assembly boundary for auth and rate limiting without adding JSON route headers:\n- ${relative(
      root,
      adminActivitiesRealTimeStreamPath
    )}\n- ${relative(root, serverStreamRoutePath)}`
  )
}

if (!adminEventApplicationsUsesSharedApiRoute) {
  failures.push(
    `Admin event application CRUD routes should use the shared API route assembly boundary for repeated admin auth and JSON body parsing while preserving existing ApiError/ApiSuccess payloads: ${relative(
      root,
      adminEventApplicationsApiPath
    )}`
  )
}

if (!adminMemberMutationRoutesUseSharedApiRoute) {
  failures.push(
    `Admin member action and flag mutation routes should use the shared API route assembly boundary while preserving per-route rate-limit keys, body validation, and audit logging:\n- ${relative(
      root,
      adminMemberActionApiPath
    )}\n- ${relative(root, adminMemberFlagsApiPath)}`
  )
}

if (!adminArtistMemberMutationRoutesUseSharedApiRoute) {
  failures.push(
    `Admin artist member assignment routes should use the shared API route assembly boundary for admin auth, params, body parsing, and per-route rate-limit headers:\n- ${relative(
      root,
      adminArtistMembersApiPath
    )}\n- ${relative(root, adminArtistMemberApiPath)}`
  )
}

if (!preventsLinkPreviewPreflightRedirects) {
  failures.push(
    `Link preview preflight must not follow redirects before SSRF checks: ${relative(
      root,
      linkPreviewPath
    )}`
  )
}

if (!linkPreviewUsesSharedSsrfProtection) {
  failures.push(
    `Link preview must use the shared SSRF host protection helper instead of a duplicate DNS/IP implementation: ${relative(
      root,
      linkPreviewPath
    )}`
  )
}

if (!parsesLinkPreviewContentLengthSafely) {
  failures.push(
    `Link preview content-length checks must parse whole integer strings only instead of accepting partial parseInt values: ${relative(
      root,
      linkPreviewPath
    )}`
  )
}

if (!avoidsLinkPreviewOperationalConsoleLogs) {
  failures.push(
    `Link preview normal fetch/extraction traces must use development-only logger.debug instead of unconditional console.log metadata dumps: ${relative(
      root,
      linkPreviewPath
    )}`
  )
}

if (!ssrfProtectionHandlesLiteralIpsStrictly) {
  failures.push(
    `Shared SSRF host protection must normalize literal IPv6 hosts and reject private/reserved literal IP ranges before DNS lookup: ${relative(
      root,
      ssrfProtectionPath
    )}`
  )
}

if (!validateUUIDRejectsTempIds) {
  failures.push(
    `validateUUID must reject temp-* IDs so DB UUID route/body checks cannot pass non-UUID values: ${relative(
      root,
      validationPath
    )}`
  )
}

if (!middlewareUsesBetterAuthSessionOnly) {
  failures.push(
    `Middleware must resolve identity through Better Auth only (no NEXT_PUBLIC_SUPABASE_* env gate) while keeping copyResponseCookies' cookie+CSP propagation to redirect/maintenance responses: ${relative(
      root,
      rootMiddlewarePath
    )}`
  )
}

if (!middlewareVerifiesJwtLocally) {
  failures.push(
    `Middleware auth must resolve identity via readMiddlewareSession() (Better Auth cookie cache) — any other identity source adds a network round trip to every request: ${relative(
      root,
      authMiddlewarePath
    )}`
  )
}

if (!middlewarePreservesProtectedLoginRedirects) {
  failures.push(
    `Middleware auth redirects must preserve protected internal paths and handle locale-prefixed paths before sending users to login: ${relative(
      root,
      authMiddlewarePath
    )}`
  )
}

if (!middlewareProtectsOnlyValidBoardEditIds) {
  failures.push(
    `Middleware must only treat /board/:id/edit as a protected edit route when :id is a UUID, so malformed post IDs fall through to page-level 404 instead of login redirects: ${relative(
      root,
      authMiddlewarePath
    )}`
  )
}

if (!middlewareRedirectsApprovedRegistrationPagesToBoard) {
  failures.push(
    `Middleware registration-page redirects must send approved active users to /board instead of deriving a non-existent /register/approved path: ${relative(
      root,
      authMiddlewarePath
    )}`
  )
}

if (!postCreationUsesServerApi || !boardPostCreationAvoidsRefreshQuery) {
  failures.push(
    `Board post creation must go through the server API and return to a clean board URL without a refresh cachebuster:\n- ${relative(
      root,
      usePostCreationPath
    )}\n- ${relative(root, writePageClientPath)}`
  )
}

if (!postsApiCreatesPostsWithServerAuthAndInvalidatesBoard) {
  failures.push(
    `POST /api/posts must authenticate on the server, enforce approved active member status, create posts with server-derived author_id, and invalidate board caches: ${relative(
      root,
      postsApiPath
    )}`
  )
}

if (!postEditUsesServerApi || !postsApiUpdatesPostsWithServerAuthAndInvalidatesBoard) {
  failures.push(
    `Board post editing must go through PATCH /api/posts/:id with server-side membership/ownership checks and board cache invalidation:\n- ${relative(
      root,
      editPageClientPath
    )}\n- ${relative(root, postDetailApiPath)}`
  )
}

if (!profilePageUsesServerApi || !profileApiRestrictsSelfUpdates) {
  failures.push(
    `My page profile edits must go through /api/mypage/profile with server-side approved-member checks and a narrow self-update allowlist:\n- ${relative(
      root,
      mypageProfilePagePath
    )}\n- ${relative(root, mypageProfileApiPath)}`
  )
}

if (!commentLikesAvoidBearerTokenForwarding) {
  failures.push(
    `Comment likes must rely on the server cookie session API and must not forward browser access tokens in Authorization headers: ${relative(
      root,
      useCommentLikesPath
    )}`
  )
}

if (!likeHooksUseServerSessionTruth) {
  failures.push(
    `Post/comment like hooks must use /api/auth/verify-session as the client session truth and must not read the session in the browser themselves:\n- ${relative(
      root,
      usePostLikesPath
    )}\n- ${relative(root, useCommentLikesPath)}`
  )
}

if (!activityLoggerAvoidsBearerTokenForwarding) {
  failures.push(
    `Activity logging must rely on the server cookie session API and must not store or forward browser access tokens in Authorization headers: ${relative(
      root,
      activityLoggerEarlyPath
    )}`
  )
}

if (!mypagePermissionUsesServerSessionTruth) {
  failures.push(
    `My page permission/navigation checks must use /api/auth/verify-session as the server truth and avoid direct browser member_profiles reads:\n- ${relative(
      root,
      authVerifySessionPath
    )}\n- ${relative(root, mypagePermissionCheckPath)}\n- ${relative(root, mypageNavigationPath)}`
  )
}

if (!boardUserSectionUsesServerSessionTruth) {
  failures.push(
    `Board user actions must use /api/auth/verify-session as the server truth and avoid direct browser member_profiles reads:\n- ${relative(
      root,
      boardUserSectionPath
    )}\n- ${relative(root, authVerifySessionPath)}`
  )
}

if (!navigationUsesServerSessionTruth) {
  failures.push(
    `Global navigation auth/menu state must use /api/auth/verify-session as the server truth and avoid direct browser member_profiles/getSession reads:\n- ${relative(
      root,
      navigationPath
    )}\n- ${relative(root, authVerifySessionPath)}`
  )
}

if (!verifySessionTreatsMissingSessionAsNormal) {
  failures.push(
    `Verify-session must treat missing auth sessions as a normal unauthenticated state instead of emitting server error logs: ${relative(
      root,
      authVerifySessionPath
    )}`
  )
}

if (!authClientPagesUseServerSessionTruth) {
  failures.push(
    `Auth-facing client pages must rely on server session/profile truth instead of browser member_profiles/getSession reads:\n- ${relative(
      root,
      loginPagePath
    )}\n- ${relative(root, authRegisterPendingPagePath)}\n- ${relative(
      root,
      authMypageArtistPagePath
    )}\n- ${relative(root, authVerifySessionPath)}`
  )
}

if (!resetPasswordUsesServerSessionTruth) {
  failures.push(
    `Reset-password must confirm identity via the Better Auth reset token (?token=) and submit through authClient.resetPassword() instead of a cookie session or a browser-side session read: ${relative(
      root,
      resetPasswordPagePath
    )}`
  )
}

if (!boardRoomClientPagesUseServerSessionTruth) {
  failures.push(
    `Board-room client admin checks must use /api/auth/verify-session as the server truth and avoid direct browser member_profiles reads:\n${boardRoomClientPageSources
      .map(({ path }) => `- ${relative(root, path)}`)
      .join('\n')}\n- ${relative(root, authVerifySessionPath)}`
  )
}

if (!hasSharedOperationalBoundaryHelpers) {
  failures.push(
    `Server operational boundaries must expose shared env and authz helpers before more route refactors:\n- ${relative(
      root,
      serverEnvPath
    )}\n- ${relative(root, authzPath)}`
  )
}

if (!existingAuthHelpersUseSharedOperationalBoundaries) {
  failures.push(
    `Existing admin and board-room auth helpers must consume the shared authz boundary and the Turso profile query layer, and must not hand a database client back to routes (no \`db\` in their success types):\n- ${relative(
      root,
      adminAuthPathForBoundary
    )}\n- ${relative(root, boardRoomAuthPathForBoundary)}`
  )
}

if (!authCallbackParsesMonthlyFeeSafely) {
  failures.push(
    `member_profiles creation must sanitize monthly_fee so NaN cannot be inserted, via signupProfile.ts's integer() helper — auth/callback/route.ts must not handle monthly_fee at all (that responsibility moved to Better Auth's sign-up hook/route):\n- ${relative(
      root,
      authCallbackPath
    )}\n- ${relative(root, signupProfilePath)}`
  )
}

if (!authCallbackSafelyDefaultsUntrustedLocaleAndNext) {
  failures.push(
    `Auth callback must safely default untrusted locale/next query params (resolveSafeLocale/resolveSafeNext) so it cannot become an open redirect: ${relative(
      root,
      authCallbackPath
    )}`
  )
}

if (!verifiesAttachmentSignature) {
  failures.push(
    `Post attachment uploads must verify file signatures before Storage upload: ${relative(
      root,
      postAttachmentsPath
    )}`
  )
}

if (!rejectsTempIdsOnPostAttachments) {
  failures.push(
    `Post attachment routes must not accept temp-{UUID} ids — that path was unreachable and has been removed: ${relative(
      root,
      postAttachmentsPath
    )}`
  )
}

if (!verifiesBoardDocumentSignature) {
  failures.push(
    `Board document uploads must verify file signatures before Storage upload: ${relative(
      root,
      boardDocumentsPath
    )}`
  )
}

if (!validatesBoardDocumentStoragePaths) {
  failures.push(
    `Board document list/download/delete routes must keep path containment and ownership checks separated and wired to the provider layer:\n- ${relative(
      root,
      boardDocumentsPath
    )}\n- ${relative(root, boardDocumentDetailPath)}\n- ${relative(
      root,
      boardDocumentDownloadPath
    )}\n- ${relative(root, boardDocumentsLibPath)}`
  )
}

if (!boardDocumentPrivateStorageIsBlobOnly) {
  failures.push(
    `Board documents must live in the private Blob store only: every read/write/delete has to go through blobPathForBoardDocument() (the containment check that keeps \`backups/\` DB dumps out of reach), uploads must not overwrite, and no Supabase Storage fallback may come back:\n- ${relative(
      root,
      privateProviderPath
    )}`
  )
}

if (!verifiesArtistPhotoSignature) {
  failures.push(
    `Artist photo uploads must verify image signatures before processing: ${relative(
      root,
      artistPhotoPath
    )}`
  )
}

if (!validatesArtistPhotoCleanupStoragePaths) {
  failures.push(
    `Artist photo cleanup must validate metadata variant paths and legacy Storage URLs under the artist prefix before remove: ${relative(
      root,
      artistPhotoPath
    )}`
  )
}

if (!validatesArtistProfilePhotoStorageUrl) {
  failures.push(
    `Artist profile updates must preserve uploaded photo variant metadata but reject photo URLs or variant paths outside the project Storage artist prefix: ${relative(
      root,
      artistProfilePath
    )}`
  )
}

if (!preventsArtistProfileServerGitSideEffects) {
  failures.push(
    `Artist profile PATCH must not write fallback JSON or run git commands from the web request path; Supabase plus cache revalidation is the live source of truth:\n- ${relative(
      root,
      artistProfilePath
    )}\n- ${relative(root, jsonSyncPath)}`
  )
}

if (!validatesPostOgAttachmentStorageUrl) {
  failures.push(
    `Post OG image redirects must only use project Storage attachment URLs and fall back for unsafe attachment rows: ${relative(
      root,
      postOgImagePath
    )}`
  )
}

if (!validatesStaticOgImageRedirects) {
  failures.push(
    `Artist/project OG image redirects must only use safe internal image paths from local JSON data:\n- ${relative(
      root,
      artistOgImagePath
    )}\n- ${relative(root, projectOgImagePath)}\n- ${relative(root, legacyOgImagePath)}`
  )
}

if (!validatesImagesApiPublicPathBoundary) {
  failures.push(
    `Images API must use path.relative containment and supported image MIME allow-listing before reading files: ${relative(
      root,
      imagesApiPath
    )}`
  )
}

if (!scopesCommentDeleteToPost) {
  failures.push(
    `Comment deletion must scope both ownership lookup and delete query to the route post id: ${relative(
      root,
      commentDeletePath
    )}`
  )
}

if (!validatesAttachmentMetadataUpdate) {
  failures.push(
    `Post attachment metadata updates/deletes must validate field types and scope writes to the route post id: ${relative(
      root,
      postAttachmentDetailPath
    )}`
  )
}

if (!validatesAttachmentDeleteAdminStatus) {
  failures.push(
    `Post attachment delete admin override must require approved active admin status: ${relative(
      root,
      postAttachmentDetailPath
    )}`
  )
}

if (!validatesAttachmentDeleteStoragePath) {
  failures.push(
    `Post attachment delete must derive Storage remove paths from validated project Storage URLs under the route post prefix: ${relative(
      root,
      postAttachmentDetailPath
    )}`
  )
}

if (!validatesPostAttachmentRenderUrls) {
  failures.push(
    `Post attachment render/download surfaces must only expose project Storage attachment URLs:\n- ${relative(
      root,
      postAttachmentsDisplayPath
    )}\n- ${relative(root, attachmentCardPath)}\n- ${relative(root, imageModalPath)}\n- ${relative(
      root,
      attachmentActionsPath
    )}`
  )
}

if (!validatesAdminPostRouteId) {
  failures.push(
    `Admin post actions must validate the route post id before lookup/update: ${relative(
      root,
      adminPostDetailPath
    )}`
  )
}

if (!adminPostActionUsesSharedApiRoute) {
  failures.push(
    `Admin post action route should use the shared API route assembly boundary while preserving its per-route rate-limit key, body parsing, and response headers: ${relative(
      root,
      adminPostDetailPath
    )}`
  )
}

if (!validatesNotificationRouteId) {
  failures.push(
    `Notification item actions must validate the route notification id before RPC/delete: ${relative(
      root,
      notificationDetailPath
    )}`
  )
}

if (!enforcesNotificationOwnershipFilter) {
  failures.push(
    `markAllNotificationsRead/markNotificationRead/deleteNotification must each scope to the calling user's own notifications via eq(notifications.userId, userId) (markAllNotificationsRead additionally only unread rows via isNull(notifications.readAt)) — this is the only defense against reading/marking/deleting other users' notifications: ${relative(
      root,
      notificationsWritePath
    )}`
  )
}

if (!validatesNotificationMutationIds) {
  failures.push(
    `Notification APIs must validate notification types/user/post IDs, expiry timestamps, title/message text, and sanitize JSON data before query/RPC calls:\n- ${relative(
      root,
      notificationsPath
    )}\n- ${relative(root, bulkNotificationsPath)}\n- ${relative(
      root,
      notificationDataPath
    )}\n- ${relative(root, notificationExpiryPath)}\n- ${relative(root, notificationTypesPath)}`
  )
}

if (!validatesUserLikesRouteId) {
  failures.push(
    `User likes listing must validate the route user id before RPC/count queries: ${relative(
      root,
      userLikesPath
    )}`
  )
}

if (!validatesUserLikesAdminStatus) {
  failures.push(
    `User likes admin override must require approved active admin status: ${relative(
      root,
      userLikesPath
    )}`
  )
}

if (!validatesPostDetailAdminStatus) {
  failures.push(
    `Post detail deleted-post admin override must require approved active admin status: ${relative(
      root,
      postDetailPath
    )}`
  )
}

if (!validatesBoardRouteIdsBeforeDataAccess) {
  failures.push(
    `Board detail/edit pages must validate route post ids before metadata fetches, DB queries, or login redirect query composition:\n- ${relative(
      root,
      boardDetailPagePath
    )}\n- ${relative(root, boardEditPagePath)}`
  )
}

if (!parsesApiWrapperPaginationSafely) {
  failures.push(
    `API wrapper pagination must fall back from non-numeric page/limit values instead of returning NaN: ${relative(
      root,
      apiWrapperPath
    )}`
  )
}

if (!validatesApiWrapperSortFields) {
  failures.push(
    `API wrapper sort parsing must default to a closed allowlist instead of accepting arbitrary orderBy values when callers omit allowedFields: ${relative(
      root,
      apiWrapperPath
    )}`
  )
}

if (!avoidsApiWrapperRequireAdminNameCollision) {
  failures.push(
    `apiWrapper must not export a route-auth-looking requireAdmin helper that can be confused with lib/server/adminAuth.requireAdmin; use requireAdminRole for role-string checks: ${relative(
      root,
      apiWrapperPath
    )}`
  )
}

if (!parsesIntegerParamsAsWholeStrings) {
  failures.push(
    `Integer query parameters must only accept whole integer strings before clamping: ${relative(
      root,
      queryParamsPath
    )}`
  )
}

if (!sanitizesDownloadFilenames) {
  failures.push(
    `File download helpers must sanitize Content-Disposition filenames before writing response headers: ${relative(
      root,
      apiResponsePath
    )}`
  )
}

if (!sanitizesCspReportFields) {
  failures.push(
    `CSP report collection must sanitize report field types before string/number operations so malformed browser reports return 400 instead of 500: ${relative(
      root,
      cspReportPath
    )}`
  )
}

if (!postsApiParsesPaginationSafely) {
  failures.push(
    `Posts API pagination must use parseIntegerParam so malformed page/cursor values fall back consistently: ${relative(
      root,
      postsApiPath
    )}`
  )
}

if (!boardPageParsesSearchParamsSafely) {
  failures.push(
    `Board page search params must use parseIntegerParam so malformed page values do not leak into pagination or canonical metadata: ${relative(
      root,
      boardPagePath
    )}`
  )
}

if (!projectsPageParsesSearchParamsSafely) {
  failures.push(
    `Projects page search params must use parseIntegerParam so malformed page values do not leak into pagination or canonical metadata: ${relative(
      root,
      projectsPagePath
    )}`
  )
}

if (!parsesMemberFeeInputsSafely) {
  failures.push(
    `Member monthly fee inputs must parse whole integer strings only instead of accepting partial parseInt values:\n- ${relative(
      root,
      signupPagePath
    )}\n- ${relative(root, cooperativeInfoPath)}`
  )
}

if (!parsesAdminSettingNumberInputsSafely) {
  failures.push(
    `Admin setting number inputs must parse whole integer strings only instead of accepting partial parseInt values: ${relative(
      root,
      adminSettingsPagePath
    )}`
  )
}

if (!parsesAdminOperationalNumberInputsSafely) {
  failures.push(
    `Admin operational number inputs must parse whole integer strings only instead of accepting partial parseInt/Number values:\n- ${relative(
      root,
      adminNotificationsPagePath
    )}\n- ${relative(root, adminReportGeneratorPath)}\n- ${relative(
      root,
      recentActivityPath
    )}\n- ${relative(root, activityAnalyticsChartsPath)}`
  )
}

if (!avoidsAdminMembersOperationalConsoleNoise) {
  failures.push(
    `Admin members page must not log member IDs, request bodies, or member records to the browser console: ${relative(
      root,
      adminMembersPagePath
    )}`
  )
}

if (!adminMembersRefreshAvoidsUrlCachebuster) {
  failures.push(
    `Admin member list refresh must use fetch cache controls instead of appending timestamp cachebuster query parameters: ${relative(
      root,
      adminMembersPagePath
    )}`
  )
}

if (!validatesAdminReportGenerationInputs) {
  failures.push(
    `Admin report generation must validate report type, date range, and reflected filters before building report metadata or queries: ${relative(
      root,
      adminReportGenerateApiPath
    )}`
  )
}

if (!parsesMypageSettingNumberInputsSafely) {
  failures.push(
    `Mypage setting number inputs must parse whole integer strings only instead of accepting partial parseInt values:\n- ${relative(
      root,
      mypageSecuritySettingsPath
    )}\n- ${relative(root, mypagePreferenceSettingsPath)}\n- ${relative(
      root,
      mypageInterfaceSettingsPath
    )}`
  )
}

if (!parsesPostViewTimestampsSafely) {
  failures.push(
    `Post view duplicate-window timestamps must parse safely so malformed client storage/header values do not suppress view increments:\n- ${relative(
      root,
      postDetailClientPath
    )}\n- ${relative(root, postViewPath)}`
  )
}

if (!parsesImageProxyContentLengthSafely) {
  failures.push(
    `Image proxy content-length checks must parse whole integer strings only instead of accepting Number-coerced remote header values: ${relative(
      root,
      imageProxyPath
    )}`
  )
}

if (!parsesAttachmentSizesSafely) {
  failures.push(
    `Post attachment size totals must parse whole non-negative integer byte strings before adding response stats:\n- ${relative(
      root,
      boardPostDetailPath
    )}\n- ${relative(root, serverBoardPath)}\n- ${relative(root, boardDetailPagePath)}`
  )
}

if (!validatesRenderedArtistProfilePhotoUrls) {
  failures.push(
    `Rendered artist profile photo URLs must be revalidated against project Storage artist prefixes before reaching img src:\n- ${relative(
      root,
      postDetailClientPath
    )}\n- ${relative(root, mypageProfilePersonalInfoPath)}\n- ${relative(
      root,
      mypageProfileEditFormPath
    )}\n- ${relative(root, mypageArtistPagePath)}`
  )
}

if (!profileEditFormGuardsArtistFetchUnmount) {
  failures.push(
    `Profile edit artist data fetch must avoid setting state after the form unmounts: ${relative(
      root,
      mypageProfileEditFormPath
    )}`
  )
}

if (!validatesEventApplicationPhotoPreviewUrls) {
  failures.push(
    `Event application photo upload responses, previews, and submit payloads must revalidate project Storage URLs before trusting photo_url: ${relative(
      root,
      eventApplicationFormPath
    )}`
  )
}

if (!parsesImageAllowedQualitiesSafely) {
  failures.push(
    `OptimizedImage allowed-quality env parsing must reject partial parseInt values and clamp through the shared whole-integer parser: ${relative(
      root,
      optimizedImagePath
    )}`
  )
}

if (!avoidsOptimizedImageProductionUrlLogs) {
  failures.push(
    `OptimizedImage must not emit raw image src values to production console warnings when fallback loading fails: ${relative(
      root,
      optimizedImagePath
    )}`
  )
}

if (!validatesGeneratedImageUrls) {
  failures.push(
    `Generated image and JSON-LD URLs must pass through safe HTTP/internal-image helpers before reaching metadata, sitemaps, or structured data:\n- ${relative(
      root,
      imageUrlPath
    )}\n- ${relative(root, structuredDataPath)}`
  )
}

if (!serializesJsonLdSafely) {
  failures.push(
    `JSON-LD script output must escape script-breaking characters instead of passing raw JSON.stringify into dangerouslySetInnerHTML:\n- ${relative(
      root,
      structuredDataPath
    )}\n- ${relative(root, connectPagePath)}`
  )
}

if (!sortsBoardRoomMeetingYearsSafely) {
  failures.push(
    `Board-room meeting year grouping must avoid NaN year labels and sort malformed dates last: ${relative(
      root,
      boardRoomMeetingsPagePath
    )}`
  )
}

if (!validatesAdvancedFilterFiniteNumbers) {
  failures.push(
    `Advanced search numeric filters must reject non-finite Number conversions before building SQL params: ${relative(
      root,
      advancedFilteringPath
    )}`
  )
}

if (!validatesAdvancedSearchSqlAllowlists) {
  failures.push(
    `Advanced search SQL builders must require explicit field allowlists and bounded pagination before composing SQL: ${relative(
      root,
      advancedFilteringPath
    )}`
  )
}

if (!parsesSessionPingIntervalSafely) {
  failures.push(
    `Activity logger session ping interval must use bounded whole-integer env parsing instead of Number/isNaN fallback logic: ${relative(
      root,
      activityLoggerPath
    )}`
  )
}

if (!authRedirectBlocklistHandlesLocalePrefixes) {
  failures.push(
    `Auth redirect sanitization must block locale-prefixed auth pages like /en/login to avoid post-login loops: ${relative(
      root,
      safeUrlPath
    )}`
  )
}

if (!validatesAdminAnalyticsUserIdFilters) {
  failures.push(
    `Admin analytics user_id filters must validate UUIDs before service-role queries:\n- ${relative(
      root,
      adminActivitiesUsersPath
    )}\n- ${relative(root, adminAnalyticsPatternsPath)}`
  )
}

if (!validatesAdminAnalyticsQueryEnums) {
  failures.push(
    `Admin analytics and performance query modes must use shared runtime allowlists before switch handling or response echoing:\n- ${relative(
      root,
      adminAnalyticsConstantsPath
    )}\n- ${relative(root, adminAnalyticsTrendsPath)}\n- ${relative(root, adminPerformancePath)}`
  )
}

if (!validatesAdminPerformanceExportDates) {
  failures.push(
    `Admin performance metric exports must validate, order-check, bound, and normalize startTime/endTime before filtering metrics: ${relative(
      root,
      adminPerformancePath
    )}`
  )
}

if (!validatesUserSettingsAllowlists) {
  failures.push(
    `User settings APIs must validate category and setting_key against the default settings contract before filtering or RPC writes:\n- ${relative(
      root,
      userSettingsConstantsPath
    )}\n- ${relative(root, userSettingsApiPath)}\n- ${relative(root, userSettingsResetApiPath)}`
  )
}

if (!validatesAdminActivityTypeFilters) {
  failures.push(
    `Admin activity action_type and target_type filters must use shared runtime enum allowlists before service-role queries:\n- ${relative(
      root,
      activityConstantsPath
    )}\n- ${relative(root, adminActivitiesUsersPath)}`
  )
}

if (!validatesActivityLogTypes) {
  failures.push(
    `Activity logging APIs must validate action_type, target_type, and target_id before calling log_user_activity:\n- ${relative(
      root,
      activityLogPath
    )}\n- ${relative(root, activityBatchLogPath)}\n- ${relative(root, activityConstantsPath)}`
  )
}

if (boardRoomDynamicRouteChecks.length > 0) {
  failures.push(
    `Board-room service-role dynamic routes must validate UUID route ids before Supabase queries:\n${boardRoomDynamicRouteChecks
      .map(({ path }) => `- ${path}`)
      .join('\n')}`
  )
}

if (!validatesBoardRoomAttendeesMeetingId) {
  failures.push(
    `Board-room attendees API must validate meeting_id before service-role lookup/upsert: ${relative(
      root,
      boardRoomAttendeesPath
    )}`
  )
}

if (!validatesBoardRoomMinutesContentFormat) {
  failures.push(
    `Board-room minutes APIs must allowlist content_format before storing renderer mode values:\n- ${relative(
      root,
      contentFormatConstantsPath
    )}\n- ${relative(root, boardRoomMinutesPath)}\n- ${relative(root, boardRoomMinutesDetailPath)}`
  )
}

if (!validatesBoardRoomMeetingDateInputs) {
  failures.push(
    `Board-room meeting APIs must validate candidate dates, vote deadlines, confirm dates, and status transitions before storing schedule values:\n- ${relative(
      root,
      boardRoomConstantsPath
    )}\n- ${relative(root, boardRoomMeetingsPath)}\n- ${relative(root, boardRoomMeetingDetailPath)}`
  )
}

if (!validatesBoardRoomAgendaSortOrder) {
  failures.push(
    `Board-room agenda updates must validate sort_order as a bounded integer before storing display order:\n- ${relative(
      root,
      boardRoomConstantsPath
    )}\n- ${relative(root, boardRoomAgendaDetailPath)}`
  )
}

if (boardRoomCreateRouteIdChecks.length > 0) {
  failures.push(
    `Board-room body IDs must be validated before service-role queries or writes:\n${boardRoomCreateRouteIdChecks
      .map(({ path }) => `- ${path}`)
      .join('\n')}`
  )
}

if (!protectsExternalCardsFromUnsafeUrls) {
  failures.push(
    `External article/ticketing cards must sanitize hrefs and avoid render-time URL parsing crashes:\n- ${relative(
      root,
      articleCardPath
    )}\n- ${relative(root, ticketingCardPath)}`
  )
}

if (!filtersRelatedArticlesToSafeExternalUrls) {
  failures.push(
    `Projects page related-article data must normalize to safe external http(s) URLs before ArticleCard receives it: ${relative(
      root,
      projectDetailPagePath
    )}`
  )
}

if (!protectsMarkdownUrlsFromUnsafeRendering) {
  failures.push(
    `Markdown renderers must sanitize link hrefs and proxy external image src values before rendering:\n- ${relative(
      root,
      postContentRendererPath
    )}\n- ${relative(root, artistProfilePagePath)}\n- ${relative(root, projectDetailPath)}`
  )
}

if (!protectsPublicImageSourcesFromUnsafeUrls) {
  failures.push(
    `Public card, artist, and project image sources must use safe internal image paths before reaching OptimizedImage:\n- ${relative(
      root,
      featuredProjectsPath
    )}\n- ${relative(root, heroFilmstripPath)}\n- ${relative(
      root,
      featuredArtistsPath
    )}\n- ${relative(root, artistProjectsPath)}\n- ${relative(
      root,
      baseCardPath
    )}\n- ${relative(root, projectsContentPath)}\n- ${relative(
      root,
      adminArtistCardPath
    )}\n- ${relative(root, adminAssignArtistModalPath)}\n- ${relative(
      root,
      artistsContentPath
    )}\n- ${relative(root, artistProfilePagePath)}\n- ${relative(
      root,
      projectDetailPath
    )}\n- ${relative(root, lightboxPath)}`
  )
}

if (!preservesAdminArtistAssignmentApiErrors) {
  failures.push(
    `Artist assignment UI must preserve JSON API error messages and reject malformed success responses instead of treating them as success: ${relative(
      root,
      adminAssignArtistModalPath
    )}`
  )
}

if (!protectsProfileAndOperationalLinksFromUnsafeUrls) {
  failures.push(
    `Profile, projects, admin, and board-room download links must sanitize href/src URL values before rendering:\n- ${relative(
      root,
      artistProfilePagePath
    )}\n- ${relative(root, portfolioLinksPath)}\n- ${relative(
      root,
      youtubeVideosPath
    )}\n- ${relative(root, projectDetailPath)}\n- ${relative(
      root,
      eventApplicationsPagePath
    )}\n- ${relative(root, boardDocumentListPath)}`
  )
}

if (!validatesEventApplicationStatusAllowlist) {
  failures.push(
    `Event application status filters and mutations must share a runtime allowlist instead of accepting arbitrary strings:\n- ${relative(
      root,
      adminEventApplicationsApiPath
    )}\n- ${relative(root, eventApplicationStatusPath)}`
  )
}

if (!validatesAdminEventApplicationSlug) {
  failures.push(
    `Admin event application filters must normalize and validate event_slug before querying:\n- ${relative(
      root,
      adminEventApplicationsApiPath
    )}`
  )
}

if (!validatesEventApplicationDeleteId) {
  failures.push(
    `Event application deletion must validate and normalize the id with validateUUID before deleting:\n- ${relative(
      root,
      adminEventApplicationsApiPath
    )}`
  )
}

if (!validatesBoardCategoryFilters) {
  failures.push(
    `Board category filters must use the shared parseBoardCategory allowlist before Supabase category queries:\n- ${relative(
      root,
      boardCategoriesPath
    )}\n- ${relative(root, serverBoardPath)}\n- ${relative(root, boardCategoryPagePath)}\n- ${relative(
      root,
      boardPostsApiPath
    )}\n- ${relative(root, boardListPostsApiPath)}\n- ${relative(root, publicPostsApiPath)}`
  )
}

if (!validatesPublicPostsCursor) {
  failures.push(
    `Public posts cursor pagination must reject malformed cursor/sort values and keep deterministic created_at/id ordering:\n- ${relative(
      root,
      publicPostsApiPath
    )}`
  )
}

if (!validatesCommentCursors) {
  failures.push(
    `Comment cursor pagination must reject malformed cursors and validate cursor IDs before keyset RPC/query use:\n- ${relative(
      root,
      keysetCursorPath
    )}\n- ${relative(root, commentsApiPath)}\n- ${relative(root, commentsListApiPath)}`
  )
}

if (!annotatesAuthenticatedCommentLikeState) {
  failures.push(
    `Authenticated board comment lists must annotate each comment with the current user's like state so already-liked comments render correctly on SSR detail and load-more paths:\n- ${relative(
      root,
      boardDetailPagePath
    )}\n- ${relative(root, commentsApiPath)}\n- ${relative(
      root,
      commentsListApiPath
    )}\n- ${relative(root, commentLikesHelperPath)}`
  )
}

if (!validatesPostRouteIdsUseSanitizedUuid) {
  failures.push(
    `Dynamic/member route IDs must use sanitized values for DB/RPC boundaries after validation:\n- ${relative(
      root,
      adminEventApplicationsApiPath
    )}\n- ${relative(root, adminMemberActionApiPath)}\n- ${relative(
      root,
      adminMemberFlagsApiPath
    )}\n- ${relative(root, adminMembersBulkApiPath)}\n- ${relative(
      root,
      adminArtistMembersApiPath
    )}\n- ${relative(root, adminArtistMemberApiPath)}\n- ${relative(
      root,
      postContentApiPath
    )}\n- ${relative(root, commentsApiPath)}\n- ${relative(
      root,
      commentsListApiPath
    )}\n- ${relative(root, postLikesApiPath)}\n- ${relative(root, postOgImagePath)}\n- ${relative(
      root,
      postUserDataApiPath
    )}\n- ${relative(root, commentLikeApiPath)}`
  )
}

if (!validatesPostsListLikedSetUsesTurso) {
  failures.push(
    `Board post-list "liked by me" set must read from Turso (getLikedPostIds) and must not reintroduce a raw Supabase post_likes read — new likes must show as hearted in the list immediately after cutover: ${relative(
      root,
      boardListPostsApiPath
    )}`
  )
}

if (supabaseAccessOffenders.length > 0) {
  failures.push(
    `No file under src/ may touch Supabase any more — every table moved to Turso and every object moved to Vercel Blob (stage 4, Task 5). Offending file(s) import a Supabase SDK/client module, call PostgREST-style .from('table'), or hand-roll a /rest/v1/ request:\n${supabaseAccessOffenders
      .map(file => `- ${file}`)
      .join('\n')}`
  )
}

if (supabaseAccessPatternBlindSpots.length > 0) {
  failures.push(
    `The Supabase-access guard's own pattern went blind: it no longer matches known-positive samples, so it would report "0 offenders" for code it is supposed to catch. Repair the pattern before trusting the guard again. Missed sample(s):\n${supabaseAccessPatternBlindSpots
      .map(sample => `- ${sample}`)
      .join('\n')}`
  )
}

if (supabaseAccessOverreach.length > 0) {
  failures.push(
    `The Supabase-access guard now flags legitimate Turso/Drizzle code or transition-history comments, which would force someone to add exceptions and hollow the guard out. Over-matching sample(s):\n${supabaseAccessOverreach
      .map(sample => `- ${sample}`)
      .join('\n')}`
  )
}

if (scriptsSupabaseUnguarded.length > 0) {
  failures.push(
    `Every file under scripts/ that touches Supabase must either abort before it reaches the database, or sit on SCRIPTS_SUPABASE_ALLOWLIST with a reason. Supabase is an abandoned copy since the 2026-08-26 Turso cutover: a script that still runs against it prints a success message and changes nothing anyone can see, which is the most expensive failure mode this repository has. Neutralize it the way scripts/archive/supabase-board/ does — a top-level console.error(...) + process.exit(1) ahead of every require/DB call, saying what the script wanted to do and where to look now (Turso: src/db/queries/, src/db/schema/, turso db shell ggac-prod). Offending file(s):\n${scriptsSupabaseUnguarded
      .map(entry => `- ${entry}`)
      .join('\n')}`
  )
}

if (scriptsSupabaseAllowlistedWrites.length > 0) {
  failures.push(
    `SCRIPTS_SUPABASE_ALLOWLIST is for read-only Supabase tooling only — a file that WRITES to Supabase can never be allowlisted, only neutralized. Allowing writes through the list is exactly how this guard would be hollowed out one "just this once" at a time. Remove the entry and add the halt instead:\n${scriptsSupabaseAllowlistedWrites
      .map(file => `- ${file}`)
      .join('\n')}`
  )
}

if (scriptsSupabaseStaleAllowlist.length > 0) {
  failures.push(
    `SCRIPTS_SUPABASE_ALLOWLIST has entries that no longer describe anything. A stale entry tells the next reader "this directory is allowed to talk to Supabase", which is how allowlists rot into blanket exemptions:\n${scriptsSupabaseStaleAllowlist
      .map(entry => `- ${entry}`)
      .join('\n')}`
  )
}

if (scriptsSupabaseUnexplainedAllowlist.length > 0) {
  failures.push(
    `Every SCRIPTS_SUPABASE_ALLOWLIST entry needs a reason someone can check — what it reads, why that is still legitimate, and when it stops being legitimate. Entries without one:\n${scriptsSupabaseUnexplainedAllowlist
      .map(path => `- ${path}`)
      .join('\n')}`
  )
}

if (scriptsSupabaseClientBlindSpots.length > 0 || scriptsSupabaseWriteBlindSpots.length > 0) {
  failures.push(
    `The scripts/ Supabase guard's own patterns went blind: they no longer match known-positive samples, so the guard would report "0 offenders" for code it is supposed to catch. Repair the patterns before trusting it again. Missed sample(s):\n${[
      ...scriptsSupabaseClientBlindSpots,
      ...scriptsSupabaseWriteBlindSpots,
    ]
      .map(sample => `- ${sample}`)
      .join('\n')}`
  )
}

if (scriptsSupabaseOverreach.length > 0) {
  failures.push(
    `The scripts/ Supabase guard now flags legitimate Turso/Drizzle/libsql code or transition-history comments. Over-matching pushes honest files onto the allowlist until nobody reads it any more. Over-matching sample(s):\n${scriptsSupabaseOverreach
      .map(sample => `- ${sample}`)
      .join('\n')}`
  )
}

if (scriptsSupabaseUnexercisedAlternatives.length > 0) {
  failures.push(
    `Every branch of the scripts/ Supabase patterns needs at least one positive sample, otherwise nothing proves that branch still bites. Per-sample checks cannot show this: emptying the sentinel arrays makes them iterate over nothing and pass — that hole was real in this guard's first draft. Add a sample that matches each branch below (or delete the branch if it is genuinely dead):\n${scriptsSupabaseUnexercisedAlternatives
      .map(entry => `- ${entry}`)
      .join('\n')}`
  )
}

if (scriptsSupabaseFalsePositiveSamples.length < SCRIPTS_FALSE_POSITIVE_MIN_SAMPLES) {
  failures.push(
    `The scripts/ Supabase over-reach check has only ${scriptsSupabaseFalsePositiveSamples.length} sample(s) (expected at least ${SCRIPTS_FALSE_POSITIVE_MIN_SAMPLES}). It iterates over the samples, so an emptied list passes vacuously and nothing stops the patterns from swallowing legitimate Turso/Drizzle/libsql code.`
  )
}

if (scriptsSupabaseFalsePositiveCommentSamples < SCRIPTS_FALSE_POSITIVE_MIN_COMMENT_SAMPLES) {
  failures.push(
    `The scripts/ Supabase over-reach check needs at least ${SCRIPTS_FALSE_POSITIVE_MIN_COMMENT_SAMPLES} comment sample(s) and has ${scriptsSupabaseFalsePositiveCommentSamples}. Comment samples are the ones that prove readSourceAt still strips comments from .js/.mjs: every neutralized script quotes the forbidden shapes verbatim in its banner, so if comment stripping breaks, the whole scripts/ tree flips to false positives and the fix people reach for is weakening the patterns.`
  )
}

if (scriptsSourceReaderStripMismatches.length > 0) {
  failures.push(
    `readSourceAt must strip comments from every extension the scripts/ Supabase scan reads (.js/.mjs/.cjs as well as .ts/.tsx), and must not try to strip the file types where the TypeScript-based stripper fails closed (.md/.json). Reverting that list does not break anything today — every script under scripts/ mentions Supabase in code as well as in prose — but it silently flips every file that mentions Supabase only in a comment into a violation, and the repair people reach for then is weakening the patterns. Mismatch(es):\n${scriptsSourceReaderStripMismatches
      .map(entry => `- ${entry}`)
      .join('\n')}`
  )
}

if (
  SCRIPTS_SUPABASE_CLIENT_ALTERNATIVES.length < SCRIPTS_CLIENT_ALTERNATIVE_MIN ||
  SCRIPTS_SUPABASE_WRITE_ALTERNATIVES.length < SCRIPTS_WRITE_ALTERNATIVE_MIN
) {
  failures.push(
    `The scripts/ Supabase patterns lost a branch (client ${SCRIPTS_SUPABASE_CLIENT_ALTERNATIVES.length}/${SCRIPTS_CLIENT_ALTERNATIVE_MIN}, write ${SCRIPTS_SUPABASE_WRITE_ALTERNATIVES.length}/${SCRIPTS_WRITE_ALTERNATIVE_MIN}). Deleting a branch is the quietest way to narrow this guard: the per-branch sample check only walks the branches that still exist, so a deleted one is neither exercised nor reported. If a branch is genuinely dead, lower the floor in the same commit and say why.`
  )
}

if (!scriptsScanSelfIsInScan) {
  failures.push(
    `SCRIPTS_SCAN_SELF (${SCRIPTS_SCAN_SELF}) is the single file excluded from the scripts/ Supabase scan, but the scan no longer covers that path — so the exclusion now hides nothing and, worse, whatever this file became is unscanned by accident rather than by decision. Fix the glob or the path.`
  )
}

if (scriptsAllFiles.length < SCRIPTS_SCAN_MIN_FILES) {
  failures.push(
    `The scripts/ scan covered only ${scriptsAllFiles.length} file(s) (expected at least ${SCRIPTS_SCAN_MIN_FILES}). An empty or near-empty scan passes vacuously, so treat it as a broken guard rather than a clean repository.`
  )
}

if (scriptsScanSubtreeShortfalls.length > 0) {
  failures.push(
    `The scripts/ scan skipped whole subtrees, blinding the Supabase guard there. A total-count floor alone cannot catch this: scripts/testing is about half of all files, so a glob that narrowed to it would still "pass" while silently skipping scripts/database, scripts/one-off, scripts/recovery and scripts/storage — where every neutralized script lives. Subtree(s) below their floor:\n${scriptsScanSubtreeShortfalls
      .map(entry => `- ${entry}`)
      .join('\n')}`
  )
}

if (scriptsScanUncoveredSubtrees.length > 0) {
  failures.push(
    `SCRIPTS_SCAN_SUBTREE_MINIMUMS has no floor for scripts/ subtree(s) the scan currently covers. Without a floor, those directories can drop out of the scan entirely and still pass on the total count alone. Add a floor of roughly two thirds of the current file count for each:\n${scriptsScanUncoveredSubtrees
      .map(prefix => `- ${prefix}`)
      .join('\n')}`
  )
}

if (scriptsRootFileCount < SCRIPTS_ROOT_MIN_FILES) {
  failures.push(
    `The scripts/ scan covered ${scriptsRootFileCount} file(s) directly under scripts/ (expected at least ${SCRIPTS_ROOT_MIN_FILES}). The per-subtree floors cannot cover that position, and both files that live there are load-bearing for this guard: clear-link-preview-cache.js is a neutralized script and verify-env.js is an allowlist entry, so a glob narrowed to scripts/*/** would silently drop the offender check and the stale-allowlist check together.`
  )
}

if (appFiles.length < APP_FILES_MIN) {
  failures.push(
    `The src/app scan (appFiles) covered only ${appFiles.length} file(s) (expected at least ${APP_FILES_MIN}). It feeds the edge-runtime ban, the unsafe searchParam integer parser check, the JSON-body {} fallback check and the blank-window opener check — all of which pass vacuously on an empty list, so an empty scan is a broken guard, not a clean repository.`
  )
}

if (appFilesMissed.length > 0) {
  failures.push(
    `The src/app glob (appFiles) no longer matches every route/page/layout file that an independent directory walk finds. Whatever it skips is silently exempt from the edge-runtime ban and the three unsafe-pattern checks. Missing file(s):\n${appFilesMissed
      .map(file => `- ${file}`)
      .join('\n')}`
  )
}

if (ownershipGateViolations.length > 0) {
  failures.push(
    `Ownership gates must exist as branches that actually deny — the condition plus the response it returns, in the expected number of places. Checking only that the expression appears somewhere let a reviewer delete the attachment-delete gate outright (any logged-in user could then delete another member's attachments) while this file still exited 0:\n${ownershipGateViolations
      .map(entry => `- ${entry}`)
      .join('\n')}`
  )
}

if (authorizationHelperBodyViolations.length > 0) {
  failures.push(
    `Authorization helper bodies must keep their deny branches — pinning only the call sites lets someone loosen the helper itself and every caller opens at once (checkAdminPermission gates every auth: 'admin' route; requireActiveMember gates 27 files). Postgres RLS is gone, so these bodies are the boundary. Missing branch(es):\n${authorizationHelperBodyViolations
      .map(entry => `- ${entry}`)
      .join('\n')}`
  )
}

if (rawReadFileCallSites !== RAW_READ_FILE_CALL_SITES) {
  failures.push(
    `This guard file must read every source through readSourceAt() (comments stripped) — it found ${rawReadFileCallSites} direct file-read call(s) instead of the expected ${RAW_READ_FILE_CALL_SITES} (the bodies of readSourceAt and readRawSourceAt). A raw read means an authorization check can be commented out while its text still satisfies a positive assertion; that is exactly how the posts/[id] ownership gates passed after being deleted.`
  )
}

if (unexpectedRawSourceBindings.length > 0 || missingRawSourceBindings.length > 0) {
  failures.push(
    `readRawSourceAt() is only for assertions whose contract is the comment/doc wording itself (the rate limiter fail-closed notes). Any other use puts a check back on comment text.${
      unexpectedRawSourceBindings.length > 0
        ? `\nUnexpected raw source binding(s):\n${unexpectedRawSourceBindings.map(name => `- ${name}`).join('\n')}`
        : ''
    }${
      missingRawSourceBindings.length > 0
        ? `\nExpected raw source binding(s) that disappeared (update ALLOWED_RAW_SOURCE_BINDINGS deliberately):\n${missingRawSourceBindings.map(name => `- ${name}`).join('\n')}`
        : ''
    }`
  )
}

if (privilegedRouteFiles.length < PRIVILEGED_ROUTE_FILES_MIN) {
  failures.push(
    `The privileged-route scan (src/app/api/admin, src/app/api/board-room) covered only ${privilegedRouteFiles.length} file(s) (expected at least ${PRIVILEGED_ROUTE_FILES_MIN}). This scan is what forces every admin/board-room handler to declare an auth gate; an empty scan silently exempts all of them.`
  )
}

if (privilegedRouteFilesMissed.length > 0) {
  failures.push(
    `The privileged-route glob no longer matches every route file that an independent directory walk finds under src/app/api/admin and src/app/api/board-room. Whatever it skips is exempt from the auth-declaration requirement. Missing file(s):\n${privilegedRouteFilesMissed
      .map(file => `- ${file}`)
      .join('\n')}`
  )
}

if (ungatedPrivilegedHandlers.length > 0) {
  failures.push(
    `Every HTTP handler under src/app/api/admin and src/app/api/board-room must declare an authorization gate: defineApiRoute/defineStreamRoute with auth: 'admin' | 'board-member' | createSettingsAdminAuth(), or a bare handler that calls requireAdmin()/requireBoardMember() and returns its denial response. Postgres RLS is gone, so this declaration is the only thing standing between a logged-in member and the admin surface — and defineApiRoute's own required-auth type cannot cover bare handlers or reject auth: 'public' here. Offending handler(s):\n${ungatedPrivilegedHandlers
      .map(entry => `- ${entry}`)
      .join('\n')}`
  )
}

if (apiRouteFiles.length < API_ROUTE_FILES_MIN) {
  failures.push(
    `The src/app/api scan (apiRouteFiles) covered only ${apiRouteFiles.length} file(s) (expected at least ${API_ROUTE_FILES_MIN}). It feeds the raw getUser( ban and the legacy rate-limiter import bans, which pass vacuously on an empty list.`
  )
}

if (apiRouteFilesMissed.length > 0) {
  failures.push(
    `The src/app/api glob (apiRouteFiles) no longer matches every route file that an independent directory walk finds. Whatever it skips can call getUser( directly or import the legacy in-memory rate limiter without anyone noticing. Missing file(s):\n${apiRouteFilesMissed
      .map(file => `- ${file}`)
      .join('\n')}`
  )
}

if (srcAllFiles.length < SRC_SCAN_MIN_FILES) {
  failures.push(
    `The repository-wide src/ scan (shared by the Supabase-access, Supabase Auth session-call, and RPC p_user_id guards) covered only ${srcAllFiles.length} file(s) (expected at least ${SRC_SCAN_MIN_FILES}). An empty or near-empty scan passes vacuously, so treat it as a broken guard rather than a clean repository.`
  )
}

if (srcScanSubtreeShortfalls.length > 0) {
  failures.push(
    `The repository-wide src/ scan skipped whole subtrees, blinding the Supabase-access, Supabase Auth session-call, and RPC p_user_id guards there. A total-count floor alone cannot catch this: src/app on its own is larger than the old floor, so a glob that narrowed to src/app/** would still have "passed" while silently skipping every directory the deleted Supabase clients used to live in. Subtree(s) below their floor:\n${srcScanSubtreeShortfalls
      .map(line => `- ${line}`)
      .join('\n')}`
  )
}

if (srcRootFileCount < SRC_ROOT_MIN_FILES) {
  failures.push(
    `The repository-wide src/ scan covered ${srcRootFileCount} file(s) directly under src/ (expected at least ${SRC_ROOT_MIN_FILES}). src/middleware.ts lives there and decides maintenance mode and auth for every request; the per-subtree floors cannot cover it, so a glob that narrowed to src/*/** would silently drop it while every other floor still passed.`
  )
}

if (srcScanUncoveredSubtrees.length > 0) {
  failures.push(
    `SRC_SCAN_SUBTREE_MINIMUMS has no floor for src/ subtree(s) that the scan currently covers. Without a floor, those directories can drop out of the scan entirely and still pass on the total count alone (src/types + src/constants + src/i18n were exactly that hole). Add a floor of roughly two thirds of the current file count for each:\n${srcScanUncoveredSubtrees
      .map(prefix => `- ${prefix}`)
      .join('\n')}`
  )
}

if (!preservesLocaleForInternalNavigation) {
  failures.push(
    `Locale-scoped internal navigation must use '@/i18n/navigation' and preserve the active locale for Link, router, pathname, redirect, and window.open flows. Remaining next/link imports:\n${
      nonLocalizedNextLinkImports.length > 0
        ? nonLocalizedNextLinkImports.map(file => `- ${file}`).join('\n')
        : '- none'
    }\nRemaining next/navigation useRouter imports:\n${
      nonLocalizedUseRouterImports.length > 0
        ? nonLocalizedUseRouterImports.map(file => `- ${file}`).join('\n')
        : '- none'
    }`
  )
}

if (!validatesNotificationNavigationTargets) {
  failures.push(
    `Notification click routing must use validated related_post_id values instead of JSON metadata post_id values when building board routes:\n- ${relative(
      root,
      notificationNavigationPath
    )}\n- ${relative(root, notificationDropdownPath)}\n- ${relative(root, notificationsPagePath)}`
  )
}

if (!preservesSafeLoginRedirects) {
  failures.push(
    `Login must preserve safe internal redirect paths after successful member login instead of always sending users to /board: ${relative(
      root,
      loginPagePath
    )}`
  )
}

if (!loginPageCleansAuthRedirectTimers) {
  failures.push(
    `Login auth checks and delayed redirects must guard unmounts and clear redirect timers before rescheduling: ${relative(
      root,
      loginPagePath
    )}`
  )
}

if (!registerPendingGuardsSessionFetchUnmount) {
  failures.push(
    `Register pending session checks must avoid setting state or showing stale alerts after the page unmounts: ${relative(
      root,
      authRegisterPendingPagePath
    )}`
  )
}

if (!avoidsClientOperationalConsoleNoise) {
  failures.push(
    `Client-facing auth, notification, admin, and recovery UI must not emit operational console.log traces:\n- ${relative(
      root,
      loginPagePath
    )}\n- ${relative(root, notificationsPagePath)}\n- ${relative(
      root,
      adminReportsPagePath
    )}\n- ${relative(root, adminAssignArtistModalPath)}\n- ${relative(
      root,
      adminSettingsPagePath
    )}\n- ${relative(root, routeProtectionPath)}\n- ${relative(root, errorBoundaryPath)}`
  )
}

if (!adminReportsGuardsStatsFetchLifecycle) {
  failures.push(
    `Admin reports stats fetches must avoid stale or unmounted state updates across initial, manual, and auto-refresh loads: ${relative(
      root,
      adminReportsPagePath
    )}`
  )
}

if (!middlewareUsesStructuredDebugLogging) {
  failures.push(
    `Middleware auth diagnostics must use the production-safe logger debug path instead of raw console.log or [MIDDLEWARE DEBUG] traces:\n- ${relative(
      root,
      rootMiddlewarePath
    )}\n- ${relative(root, authMiddlewarePath)}`
  )
}

if (!avoidsLoadingStateProductionConsoleNoise) {
  failures.push(
    `Loading state hooks must keep enableLogging diagnostics development-only so production UI operations do not leak keys or error messages to the browser console: ${relative(
      root,
      loadingStatePath
    )}`
  )
}

if (!loadingStateAppliesOperationOptions) {
  failures.push(
    `Loading state executeAsync overrides must apply per-operation timeout, callbacks, and logging options instead of computing unused mergedOptions: ${relative(
      root,
      loadingStatePath
    )}`
  )
}

if (!singleLoadingStateClearsPreviousTimeout) {
  failures.push(
    `Single loading state must clear any previous timeout before starting a new operation, otherwise stale timers can fail the current operation: ${relative(
      root,
      loadingStatePath
    )}`
  )
}

if (!commentLikeButtonCleansAnimationTimer) {
  failures.push(
    `Comment like animation timers must be ref-tracked and cleared on unmount to avoid stale setState after navigation: ${relative(
      root,
      commentLikeButtonPath
    )}`
  )
}

if (!profilePhotoUploaderCleansUploadTimers) {
  failures.push(
    `Profile photo uploads must clear progress intervals and reset timers on failure, restart, and unmount: ${relative(
      root,
      profilePhotoUploaderPath
    )}`
  )
}

if (!adminSettingsCleansStatusTimers) {
  failures.push(
    `Admin settings status banners must use one ref-tracked timer that is cleared before rescheduling and on unmount: ${relative(
      root,
      adminSettingsPagePath
    )}`
  )
}

if (!sendsClientErrorReportsToApi) {
  failures.push(
    `Client ErrorTracker must send production critical errors to the existing /api/client-error collector instead of only logging a placeholder:\n- ${relative(
      root,
      errorTrackingPath
    )}\n- ${relative(root, errorBoundaryPath)}\n- ${relative(root, clientErrorApiPath)}`
  )
}

if (!redactsSecurityEventDetails) {
  failures.push(
    `Security event logging must redact URL query strings, secrets, and direct contact values at the logSecurityEvent boundary before console/webhook delivery: ${relative(
      root,
      securityPath
    )}`
  )
}

if (!avoidsProjectPreviewRawUrlLogs) {
  failures.push(
    `Projects page article preview failures must not log raw external URLs with query strings or fragments: ${relative(
      root,
      projectDetailPagePath
    )}`
  )
}

if (!avoidsServerOperationalConsoleLogs) {
  failures.push(
    `Server-side normal/fallback paths must use development-only logger.debug instead of unconditional console.log traces or URL dumps:\n- ${relative(
      root,
      cspReportPath
    )}\n- ${relative(root, authVerifySessionPath)}\n- ${relative(
      root,
      postOgImagePath
    )}\n- ${relative(root, postViewPath)}\n- ${relative(
      root,
      artistProfilePath
    )}\n- ${relative(root, apiPerformanceMonitorPath)}`
  )
}

if (!restrictsMediaUploadBuckets) {
  failures.push(
    `Media uploads must reject unsupported Storage buckets before service-role upload/listing: ${relative(
      root,
      mediaUploadPath
    )}`
  )
}

if (!sanitizesUploadMetadata) {
  failures.push(
    `Upload APIs must not let client-provided metadata override server-derived file truth; sanitize generic metadata and derive artist photo dimensions server-side:\n- ${relative(
      root,
      mediaUploadPath
    )}\n- ${relative(root, artistPhotoPath)}`
  )
}

if (unsafeSearchParamIntegerParsers.length > 0) {
  failures.push(
    `Search param integer parsing must use parseIntegerParam to avoid NaN pagination/range values:\n${unsafeSearchParamIntegerParsers
      .map(file => `- ${file}`)
      .join('\n')}`
  )
}

if (jsonBodyEmptyObjectFallbacks.length > 0) {
  failures.push(
    `Malformed JSON bodies must return explicit 400 responses instead of falling back to {}:\n${jsonBodyEmptyObjectFallbacks
      .map(file => `- ${file}`)
      .join('\n')}`
  )
}

if (adminMutationJsonBypasses.length > 0) {
  failures.push(
    `Admin API routes must use parseJsonObjectBody for JSON mutation payloads:\n${adminMutationJsonBypasses
      .map(file => `- ${file}`)
      .join('\n')}`
  )
}

if (unsafeBlankWindowOpeners.length > 0) {
  failures.push(
    `window.open(..., '_blank') must include noopener,noreferrer features:\n${unsafeBlankWindowOpeners
      .map(file => `- ${file}`)
      .join('\n')}`
  )
}

if (directGetUserOffenders.length > 0) {
  failures.push(
    `API routes must authenticate via requireUser()/requireActiveMember() from @/lib/server/memberAuth instead of calling getUser(...) directly (file not in directGetUserAllowlist, or missing the mustAlsoCall helper that list requires for that file):\n${directGetUserOffenders
      .map(file => `- ${file}`)
      .join('\n')}`
  )
}

if (requiredAuthHelperCallViolations.length > 0) {
  failures.push(
    `API routes importing @/lib/server/memberAuth must keep calling requireUser()/requireActiveMember() the expected number of times per requiredAuthHelperCallCounts (an auth block was deleted, downgraded to a weaker helper, or replaced with a string-literal decoy):\n${requiredAuthHelperCallViolations
      .map(entry => `- ${entry}`)
      .join('\n')}`
  )
}

// 단계 2b-5: 자체 가입 라우트(/api/member-signup)의 불변식.
// stripStringLiterals까지 거친 소스로 본다 — 문자열 리터럴("applyRateLimit" 같은
// 가짜 흔적)로 이 검사를 속이지 못하게 하기 위해서다.
const memberSignupRoutePath = join(root, 'src/app/api/member-signup/route.ts')
const memberSignupRouteRawSource = readSourceAt(memberSignupRoutePath)
const memberSignupRouteSource = stripStringLiterals(
  stripCommentsAndImports(memberSignupRouteRawSource)
)
const memberSignupRouteCallsRateLimit = /applyRateLimit\(/.test(memberSignupRouteSource)
// body.registration_status(옵셔널 체이닝 포함)·body['registration_status']·
// body["registration_status"] 어느 형태로도 클라이언트 body에서 registration_status를
// 읽으면 안 된다. stripStringLiterals가 문자열 리터럴 내용을 지우므로 대괄호 표기의
// 키 이름도 실제 코드에서 읽는 경우만 걸린다(주석·문자열 안의 언급은 이미 지워졌다).
const memberSignupRouteTrustsClientRegistrationStatus =
  /body\??\.\s*registration_status/.test(memberSignupRouteSource) ||
  /body\s*\[\s*registration_status\s*\]/.test(memberSignupRouteSource)

if (!memberSignupRouteCallsRateLimit) {
  failures.push(
    `Member signup route must call applyRateLimit — it is an unauthenticated public endpoint: ${relative(
      root,
      memberSignupRoutePath
    )}`
  )
}

if (memberSignupRouteTrustsClientRegistrationStatus) {
  failures.push(
    `Member signup route must never read registration_status from the client request body — new members are always pending/inactive: ${relative(
      root,
      memberSignupRoutePath
    )}`
  )
}

const authServerPath = join(root, 'src/lib/auth/server.ts')
const authServerSource = readSourceAt(authServerPath)
const authServerStripped = stripComments(authServerSource)
if (/disableSignUp:\s*true/.test(authServerStripped)) {
  failures.push(
    `src/lib/auth/server.ts must not keep disableSignUp: true — stage 2b-6 (Task 4) deliberately opened public sign-up, protected instead by src/app/api/auth/[...all]/route.ts's POST wrapper (outright rejection of the sign-up/email path — /api/member-signup is the only real sign-up route): ${relative(
      root,
      authServerPath
    )}`
  )
}
// disableSignUp을 지운 대신 catch-all 라우트가 sign-up/email 경로를 완전히
// 막는다(수정 라운드 1: 조율자가 레이트리밋만으로는 세 계정이 그대로
// 생기는 것을 실측해, 통과시키지 않고 아예 거부하는 쪽으로 바꿨다). 그
// 방어막 자체가 조용히 사라지거나 다시 "느슨한 허용"으로 되돌아가지
// 않도록 두 가지를 고정한다: (1) sign-up/email 분기가 여전히 존재하고
// 그 안에서 명시적으로 거부 응답을 돌려준다, (2) 그 분기가
// Better Auth 핸들러(betterAuthPOST)로 위임하는 코드를 포함하지 않는다 —
// 위임 호출이 남아 있으면 거부가 장식일 뿐 실제로는 통과시킨다는 뜻이다.
const authCatchAllPath = join(root, 'src/app/api/auth/[...all]/route.ts')
const authCatchAllSource = readSourceAt(authCatchAllPath)
const authCatchAllStripped = stripStringLiterals(stripCommentsAndImports(authCatchAllSource))
const signUpEmailBlockMatch = authCatchAllStripped.match(
  /if \(isSignUpEmailPath\(request\)\) \{([\s\S]*?)\n  \}/
)
const signUpEmailBlockBody = signUpEmailBlockMatch?.[1] ?? ''
const authCatchAllRejectsSignUpOutright =
  /isSignUpEmailPath\(/.test(authCatchAllStripped) &&
  signUpEmailBlockMatch !== null &&
  /ApiError\.forbidden\(/.test(signUpEmailBlockBody) &&
  /return/.test(signUpEmailBlockBody) &&
  !/betterAuthPOST\(/.test(signUpEmailBlockBody)
if (!authCatchAllRejectsSignUpOutright) {
  failures.push(
    `src/app/api/auth/[...all]/route.ts must reject POST requests to the sign-up/email path outright (ApiError.forbidden, no delegation to betterAuthPOST) now that disableSignUp is gone — rate-limiting alone was proven insufficient (three accounts with blank membership fields were created within the rate limit window): ${relative(
      root,
      authCatchAllPath
    )}`
  )
}

// 단계 2b-6(Task 4): Supabase Auth 세션 API(.auth.getUser 등) 호출이 src/
// 어디에도 남아 있으면 안 된다 — 인증은 Better Auth로 전부 옮겨졌다(단계
// 2b-3~2b-6).
//
// 단계 4 Task 5: 예전에는 `.auth.admin.*`을 부정 lookahead로 제외했다 —
// `src/lib/auth/server.ts`가 서비스롤 Admin API로 Supabase `auth.users`
// 그림자 행을 만들었기 때문이다. 그 호출이 사라졌으므로 예외도 걷어낸다.
// `admin`을 목록에 함께 넣어, Admin API 호출이 되살아나도 걸리게 한다.
const supabaseAuthSessionCallPattern =
  /\.auth\.(?:admin\b|(?:getUser|getSession|getClaims|signOut|signInWithPassword|signInWithOtp|signUp|onAuthStateChange|refreshSession|exchangeCodeForSession|updateUser|resetPasswordForEmail|verifyOtp)\s*\()/
// `srcAllFiles`는 Supabase 접근 가드와 **같은 목록**이다(위쪽에서 한 번만
// 만든다). 하한·서브트리 하한·미커버 서브트리 자기검사가 그 한 목록에 걸려
// 있으므로, 글롭이 좁아지면 이 가드와 아래 RPC 가드도 함께 실패한다.
const supabaseAuthSessionCallOffenders = srcAllFiles.filter(file => {
  const source = readSourceAt(join(root, file))
  return supabaseAuthSessionCallPattern.test(stripComments(source))
})
if (supabaseAuthSessionCallOffenders.length > 0) {
  failures.push(
    `Supabase Auth session API calls (.auth.getUser/.auth.getSession/etc.) must not exist anywhere in src/ — session identity must come from @/lib/server/session's readSessionUser() (or @/lib/server/memberAuth's requireUser/requireActiveMember), never from a Supabase client directly:\n${supabaseAuthSessionCallOffenders
      .map(file => `- ${file}`)
      .join('\n')}`
  )
}

// 단계 2b-6(Task 4) 함정 6: RPC에 p_user_id를 넘기는 호출부는 요청 본문이
// 아니라 세션 사용자 id(user.id)를 넘겨야 한다. createSupabaseServer()가
// 서비스롤이 된 지금 Supabase RLS는 이 쿼리들을 전혀 막지 않고, RPC 함수
// 본문 안의 auth.uid() 기반 가드도 Better Auth 세션 아래에서는 항상 NULL을
// 봐서 무력하다(단계 2b-4 기록) — "본인 것만 건드린다"는 보장이 이제 전적으로
// 호출부가 user.id를 넘기는가에 달려 있다. 아래는 "타인의 user_id를 의도적으로
// 다루는" 정당한 예외다(관리자 조회, 공개 좋아요 목록, 관리자가 만드는 알림,
// 이사회 알림 로스터) — 그 외 파일에서 p_user_id(s)가 user.id가 아닌 다른
// 토큰(특히 body.* 같은 클라이언트 입력)을 받으면 게이트가 막는다.
const arbitraryTargetUserIdAllowlist = [
  'src/app/api/admin/analytics/patterns/route.ts',
  'src/app/api/users/[id]/likes/route.ts',
  'src/app/api/notifications/route.ts',
  'src/app/api/notifications/bulk/route.ts',
  'src/lib/server/boardRoomNotify.ts',
]
const rpcUserIdScanFiles = srcAllFiles.filter(
  file => !arbitraryTargetUserIdAllowlist.includes(file)
)
const rpcUserIdViolations = []
for (const file of rpcUserIdScanFiles) {
  const raw = readSourceAt(join(root, file))
  const stripped = stripStringLiterals(stripCommentsAndImports(raw))
  for (const match of stripped.matchAll(/p_user_ids?\s*:\s*([^,}\n]+)/g)) {
    const token = match[1].trim()
    if (token !== 'user.id') {
      rpcUserIdViolations.push(
        `${file}: 세션 사용자 id(user.id)가 아닌 '${token}'을 p_user_id(s)로 넘깁니다`
      )
    }
  }
}
if (rpcUserIdViolations.length > 0) {
  failures.push(
    `RPC calls passing p_user_id/p_user_ids must use the session user's own id (user.id from requireUser()/readSessionUser()), never a client-supplied or otherwise-sourced value — files intentionally targeting another user's id belong in arbitraryTargetUserIdAllowlist instead:\n${rpcUserIdViolations
      .map(v => `- ${v}`)
      .join('\n')}`
  )
}

// ---------------------------------------------------------------------------
// 하드코딩 자격 증명 가드 (최종 리뷰 B "함께 고칠 것")
//
// 수정 A에서 `service_role` 키가 그대로 박힌 파일 3개를 저장소에서 지웠다.
// 이 저장소는 **공개**이므로 같은 일이 한 번 더 일어나면 그걸로 끝이다 —
// 그리고 그런 파일은 언제나 "임시 진단 스크립트"라는 얼굴로 들어온다.
//
// 그래서 값이 아니라 **모양**으로 잡는다. 이 가드 안에는 어떤 키 값도 없고,
// 앞으로도 넣으면 안 된다(가드 자체가 유출 경로가 된다). 자기 자신도 스캔
// 대상에 포함되므로, 여기에 실제 키를 적으면 그 순간 이 검사가 스스로 막는다.
//
// 대상은 **git이 추적하는 파일 전부**다(`git ls-files`). 소스 확장자만
// 훑으면 정확히 그 밖(설정·픽스처·캐시 파일)으로 새 나가는 것을 못 잡는다 —
// 실제로 이 가드를 처음 켰을 때 걸린 넷 중 하나는 편집기 심볼 캐시
// (`.serena/cache/*.pkl`, 28MB 바이너리)였다. 추적 대상만 보므로 gitignore된
// `.env.local` 같은 로컬 비밀 파일은 애초에 스캔하지 않는다(거짓 실패 없음).
const CREDENTIAL_SHAPES = [
  {
    label: 'JWT(Supabase anon/service_role 키와 Turso 인증 토큰이 전부 이 모양이다)',
    // header.payload.signature — 헤더가 `{"` 로 시작하는 base64url이라 항상 `eyJ`다.
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  },
  {
    label: 'Vercel Blob 읽기/쓰기 토큰',
    pattern: /\bvercel_blob_rw_[A-Za-z0-9]{16,}/g,
  },
  {
    label: 'Supabase 신형 API 키(sb_secret_/sb_publishable_)',
    pattern: /\bsb_(?:secret|publishable)_[A-Za-z0-9_-]{16,}/g,
  },
  {
    label: 'Resend API 키',
    pattern: /\bre_[A-Za-z0-9]{8,}_[A-Za-z0-9]{16,}/g,
  },
  {
    label: 'OpenAI/Anthropic 계열 비밀 키',
    // 갈래를 둘로 나눈다.
    //
    // - 접두사가 확정적인 `sk-ant-`·`sk-proj-`는 꼬리에 하이픈을 그대로
    //   허용한다(실제 모양이 `sk-ant-api03-…`처럼 하이픈을 낀다).
    // - 접두사 없는 `sk-`는 꼬리에서 **하이픈을 뺀다.** 실제 키의 꼬리는
    //   하이픈 없는 난수 문자열인데, 예전 문자 클래스는 하이픈을 허용해서
    //   `.sk-loading-placeholder-large` 같은 **정당한 CSS 클래스 이름**을
    //   비밀 키로 신고했다(최종 회차 C-4, 리뷰어 실증 — 이 저장소는
    //   Tailwind를 쓰고 OpenAI/Anthropic 키는 아예 안 쓴다).
    //
    // 오탐 0건인 지금 굳이 좁히는 이유: 정당한 문자열 하나가 걸리는 순간
    // 다음 사람에게 "가드를 느슨하게 만들 이유"가 생긴다. 이 저장소는 전환
    // 내내 정확히 그 방식으로 가드가 무력해졌다. 좁히되 **키 모양 자체는
    // 그대로 잡는다**(꼬리 24자 이상이라는 조건은 유지).
    pattern: /\b(?:sk-ant-|sk-proj-)[A-Za-z0-9_-]{24,}|\bsk-[A-Za-z0-9_]{24,}/g,
  },
]

// 스캔에서 빼는 것: git 자체 메타데이터와 잠금 파일(무결성 해시가 길어 오탐
// 여지만 늘리고, 사람이 값을 적어 넣는 파일이 아니다).
const CREDENTIAL_SCAN_SKIP = [/^\.git\//, /(^|\/)package-lock\.json$/, /(^|\/)yarn\.lock$/]

let trackedFiles = null
try {
  trackedFiles = execFileSync('git', ['ls-files', '-z'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
    .split('\0')
    .filter(Boolean)
} catch {
  trackedFiles = null
}

if (trackedFiles === null) {
  console.warn(
    'SKIPPED: `git ls-files`를 실행할 수 없어(비-git 체크아웃) 하드코딩 자격 증명 스캔을 건너뜁니다 — 다른 검사는 그대로 돌았습니다.'
  )
} else {
  // 주석을 걷어내지 않는다 — 주석 안에 박힌 키도 커밋된 키다.
  const findCredentialShape = file => {
    const credentialScanSource = readRawSourceAt(join(root, file))
    for (const shape of CREDENTIAL_SHAPES) {
      shape.pattern.lastIndex = 0
      const match = shape.pattern.exec(credentialScanSource)
      if (match) return { shape, match: match[0] }
    }
    return null
  }

  const credentialHits = []
  for (const file of trackedFiles) {
    if (CREDENTIAL_SCAN_SKIP.some(rx => rx.test(file))) continue
    let found = null
    try {
      found = findCredentialShape(file)
    } catch {
      continue // 심볼릭 링크 깨짐 등 — 읽을 수 없으면 스캔 대상이 아니다.
    }
    if (!found) continue
    // 발견한 값 자체는 절대 출력하지 않는다(로그가 새 유출 경로가 된다).
    // 어떤 모양이 어느 파일에서 나왔는지, 그리고 앞 6자만 알려 준다.
    credentialHits.push(`${file}: ${found.shape.label} (…${found.match.slice(0, 6)}… 로 시작)`)
  }

  if (credentialHits.length > 0) {
    failures.push(
      `Hardcoded credentials must never be committed — this repository is public. Move the value to an environment variable (and rotate the exposed credential):\n${credentialHits
        .map(hit => `- ${hit}`)
        .join('\n')}`
    )
  }
}

if (failures.length > 0) {
  console.error(failures.join('\n\n'))
  process.exit(1)
}

console.log('Runtime risk checks passed')
