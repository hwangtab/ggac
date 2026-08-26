import ts from 'typescript'

/**
 * 주석을 걷어낸 소스. "이 패턴이 없어야 한다" 류의 부정 검사에 쓴다.
 *
 * 이 파일의 검사는 소스를 정규식으로 훑기 때문에, 금지 패턴을 설명하는 주석이
 * 그 자체로 검사에 걸린다("`failures.length === 2`로 세지 말 것" 같은 주석).
 * 반대로 이관된 옛 함수 이름을 남긴 주석이 긍정 검사를 거짓 통과시키기도 한다.
 * 부정 검사는 실제 코드만 봐야 한다.
 *
 * **정규식으로 하면 안 된다.** 예전 구현은
 * `source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')`
 * 였는데, 문자열·정규식 리터럴 안의 `/*`와 `//`를 주석 시작으로 오인해
 * **실제 코드를 지웠다.** Task 5 리뷰 1회차에서 실측된 피해는 410개 중 16개
 * 파일이고, `src/lib/server/commentNotify.ts`(`'src/db/queries/*.ts'` 문자열)와
 * `src/middleware/session.ts`는 **import 블록이 통째로** 사라졌다. 그 결과
 * 저장소 전수 가드 3종(Supabase 접근·Supabase Auth 세션 API·RPC p_user_id)이
 * 그 파일들에서 눈이 멀었다 — `src/middleware/session.ts` 상단에 Supabase
 * 세션 클라이언트를 되살려도 셋 다 초록불이었다.
 *
 * 그래서 TypeScript 파서로 **토큰 범위**를 뽑고, 토큰이 덮지 않은 구간(=트리비아)
 * 중 주석만 지운다. 문자열·템플릿·정규식 리터럴은 전부 토큰이므로 보호된다.
 *
 * 두 가지 성질을 지킨다.
 *
 * 1. **길이·위치 보존.** 주석 자리는 같은 길이의 공백으로 치환하고 줄바꿈은
 *    남긴다. 원본과 출력의 인덱스가 1:1이라 "실제 코드를 하나도 지우지
 *    않았다"를 문자 단위로 증명할 수 있다(아래 자기검사, 그리고
 *    `scripts/testing/strip-comments.test.mjs`의 저장소 전수 대조).
 * 2. **fail-closed.** 토큰이 덮지 않은 구간에 공백도 주석도 아닌 문자가 있으면
 *    (=파싱이 어긋났다는 뜻) 조용히 넘어가지 않고 throw한다. 주석을 놓친 채
 *    "통과"하는 쪽이 이 파일에서 가장 비싼 실패이기 때문이다.
 */
const strippedCommentCache = new Map()

export function stripComments(source) {
  const cached = strippedCommentCache.get(source)
  if (cached !== undefined) return cached
  // .ts 파일에도 TSX로 먼저 붙는다(JSX를 타입 단언으로 오해하지 않게). TSX에서
  // 금지되는 옛 `<T>expr` 단언이 있는 파일만 TS로 되짚는다.
  let firstFailure = null
  for (const scriptKind of [ts.ScriptKind.TSX, ts.ScriptKind.TS]) {
    const attempt = stripCommentsWithScriptKind(source, scriptKind)
    if (attempt.ok) {
      strippedCommentCache.set(source, attempt.text)
      return attempt.text
    }
    firstFailure ??= attempt.reason
  }
  throw new Error(
    `stripComments(): 토큰이 덮지 않은 구간에 주석이 아닌 문자가 남았다 — 파서가 소스를 온전히 읽지 못했다는 뜻이므로, 주석을 놓친 결과를 돌려주는 대신 실패한다. ${firstFailure}`
  )
}

/**
 * 파서가 인정한 토큰(=실제 코드) 범위. JSDoc 노드는 토큰이 아니라 주석이므로
 * 제외한다 — 제외하지 않으면 `/** ... *\/`가 코드로 취급돼 그대로 남는다.
 */
function collectCodeRanges(sourceFile, node, ranges) {
  if (node.kind >= ts.SyntaxKind.FirstJSDocNode && node.kind <= ts.SyntaxKind.LastJSDocNode) return
  const children = node.getChildren(sourceFile)
  if (children.length === 0) {
    const start = node.getStart(sourceFile, false)
    if (node.end > start) ranges.push([start, node.end])
    return
  }
  for (const child of children) collectCodeRanges(sourceFile, child, ranges)
}

function stripCommentsWithScriptKind(source, scriptKind) {
  const sourceFile = ts.createSourceFile(
    scriptKind === ts.ScriptKind.TSX ? 'input.tsx' : 'input.ts',
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind
  )
  const ranges = []
  collectCodeRanges(sourceFile, sourceFile, ranges)
  ranges.sort((a, b) => a[0] - b[0])

  const gaps = []
  let covered = 0
  for (const [start, end] of ranges) {
    if (start > covered) gaps.push([covered, start])
    covered = Math.max(covered, end)
  }
  if (covered < source.length) gaps.push([covered, source.length])

  const out = source.split('')
  const blank = (start, end) => {
    for (let i = start; i < end; i += 1) {
      if (source[i] !== '\n' && source[i] !== '\r') out[i] = ' '
    }
  }

  for (const [gapStart, gapEnd] of gaps) {
    let i = gapStart
    while (i < gapEnd) {
      const ch = source[i]
      if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || /\s/.test(ch)) {
        i += 1
        continue
      }
      if (source.startsWith('//', i)) {
        let end = i
        while (end < gapEnd && source[end] !== '\n') end += 1
        blank(i, end)
        i = end
        continue
      }
      if (source.startsWith('/*', i)) {
        const close = source.indexOf('*/', i + 2)
        const end = close === -1 ? gapEnd : close + 2
        if (end > gapEnd) {
          return {
            ok: false,
            reason: `블록 주석이 토큰 경계를 넘어선다 (offset ${i}): ${JSON.stringify(source.slice(i, i + 60))}`,
          }
        }
        blank(i, end)
        i = end
        continue
      }
      if (i === 0 && source.startsWith('#!', i)) {
        let end = i
        while (end < gapEnd && source[end] !== '\n') end += 1
        blank(i, end)
        i = end
        continue
      }
      return {
        ok: false,
        reason: `offset ${i} 부근: ${JSON.stringify(source.slice(i, i + 60))}`,
      }
    }
  }

  return { ok: true, text: out.join('') }
}

/**
 * 파서가 인정한 토큰 범위(주석·공백 제외)를 그대로 돌려준다. 검증 전용 —
 * `strip-comments.test.mjs`가 "strip이 실제 코드를 하나도 지우지 않았다"를
 * 저장소 전체에 대해 대조할 때 쓴다.
 */
export function codeRangesOf(source, scriptKind = ts.ScriptKind.TSX) {
  const sourceFile = ts.createSourceFile(
    scriptKind === ts.ScriptKind.TSX ? 'input.tsx' : 'input.ts',
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind
  )
  const ranges = []
  collectCodeRanges(sourceFile, sourceFile, ranges)
  ranges.sort((a, b) => a[0] - b[0])
  return ranges
}
