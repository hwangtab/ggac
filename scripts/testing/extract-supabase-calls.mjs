// 소스에서 supabase .from()/.rpc() 호출을 정적으로 추출한다.
// 동적 인자(변수·템플릿 보간)는 검사 대상에서 빼되 skips로 보고한다.

// openIndex의 '('에 대응하는 ')' 위치를 반환한다. 문자열 리터럴 내부는 무시.
export function findMatchingParen(source, openIndex) {
  let depth = 0
  let quote = null
  for (let i = openIndex; i < source.length; i++) {
    const ch = source[i]
    if (quote) {
      if (ch === '\\') i++
      else if (ch === quote) quote = null
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') quote = ch
    else if (ch === '(') depth++
    else if (ch === ')') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

// dotIndex(체인 시작 '.'의 위치)부터 .method(args) 연쇄를 추출한다.
export function scanChain(source, dotIndex) {
  const calls = []
  let pos = dotIndex
  for (;;) {
    const rest = source.slice(pos)
    const m = rest.match(/^\s*\.\s*(\w+)\s*\(/)
    if (!m) break
    const openIndex = pos + m[0].length - 1
    const closeIndex = findMatchingParen(source, openIndex)
    if (closeIndex === -1) break
    calls.push({ method: m[1], args: source.slice(openIndex + 1, closeIndex).trim() })
    pos = closeIndex + 1
    // 다음 체인까지의 공백·개행을 허용한다
    const gap = source.slice(pos).match(/^\s*/)
    if (source[pos + gap[0].length] !== '.') break
    pos += gap[0].length
  }
  return { calls, endIndex: pos }
}

// 인자 텍스트가 단순 문자열 리터럴이면 값을, 아니면 null을 반환한다.
function literalString(argText) {
  const m = argText.match(/^(['"`])([^'"`$]*)\1$/)
  return m ? m[2] : null
}

// PostgREST select 문자열을 컬럼·관계로 분해한다.
export function parseSelectColumns(argText) {
  const raw = literalString(argText)
  if (raw === null) return { columns: [], relations: [], dynamic: true }
  const columns = []
  const relations = []
  // 최상위 콤마 기준으로 분리 (괄호 안 콤마는 유지)
  const tokens = []
  let depth = 0
  let cur = ''
  for (const ch of raw) {
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === ',' && depth === 0) {
      tokens.push(cur)
      cur = ''
    } else cur += ch
  }
  tokens.push(cur)
  for (let token of tokens.map(t => t.trim()).filter(Boolean)) {
    if (token === '*') continue
    const parenIdx = token.indexOf('(')
    if (parenIdx !== -1) {
      // 관계 임베딩: alias:rel!hint(cols)
      let name = token.slice(0, parenIdx)
      name = name.includes(':') ? name.slice(name.indexOf(':') + 1) : name
      name = name.split('!')[0].trim()
      const inner = token.slice(parenIdx + 1, token.lastIndexOf(')'))
      const innerParsed = parseSelectColumns(`'${inner}'`)
      relations.push({ name, columns: innerParsed.columns })
      relations.push(...innerParsed.relations)
      continue
    }
    // alias:col → col, col::cast → col, col->>json → col
    if (token.includes(':') && !token.includes('::')) token = token.slice(token.indexOf(':') + 1)
    token = token.split('::')[0].split('->')[0].trim()
    if (token) columns.push(token)
  }
  return { columns, relations, dynamic: false }
}

// 컬럼명을 첫 인자로 받는 필터·정렬 메서드
const COLUMN_ARG_METHODS = new Set([
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
  'like',
  'ilike',
  'is',
  'in',
  'contains',
  'containedBy',
  'order',
  'textSearch',
])
const WRITE_METHODS = new Set(['insert', 'update', 'upsert'])

// .from()을 갖는 JS 내장 생성자 — 이 수신 객체의 from은 supabase가 아니다.
// denylist인 이유: supabase 클라이언트 변수명은 다양해 allowlist는 누락을
// 만들지만, 내장 생성자는 확실히 supabase가 아니다.
const BUILTIN_FROM_RECEIVERS = new Set([
  'Array',
  'Buffer',
  'Object',
  'Promise',
  'Set',
  'Map',
  'String',
  'Uint8Array',
  'Int8Array',
  'Uint16Array',
  'Int16Array',
  'Uint32Array',
  'Int32Array',
  'Float32Array',
  'Float64Array',
  'BigInt64Array',
  'BigUint64Array',
])

// 최상위(depth 0) 콤마 기준으로 첫 번째 인자 텍스트만 잘라낸다.
// 중첩 객체·배열·괄호·문자열 안의 콤마는 유지한다.
function firstTopLevelArg(argText) {
  let depth = 0
  let quote = null
  for (let i = 0; i < argText.length; i++) {
    const ch = argText[i]
    if (quote) {
      if (ch === '\\') i++
      else if (ch === quote) quote = null
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') quote = ch
    else if (ch === '{' || ch === '[' || ch === '(') depth++
    else if (ch === '}' || ch === ']' || ch === ')') depth--
    else if (ch === ',' && depth === 0) return argText.slice(0, i)
  }
  return argText
}

// 객체 리터럴 최상위 키를 수집한다. 리터럴이 아니면 null,
// 아니면 { keys, hasSpread } — 최상위 ...spread가 있으면 키를 다 알 수
// 없으므로 hasSpread로 알려 호출부가 skip을 기록하게 한다.
function extractObjectKeys(argText) {
  const trimmed = argText.trim()
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null
  const keys = []
  let hasSpread = false
  // 여는 괄호를 대칭으로 스택에 쌓는다 — 배열 값이 닫힐 때 depth가
  // 언더플로우해 이후 최상위 키가 무음 탈락하던 회귀를 막는다
  const stack = []
  // 페이로드 최상위 객체 안인가: 직접 감싸는 오프너가 객체이고, 그 객체가
  // 페이로드 자체(스택 ['{'])이거나 최상위 배열 바로 안의 요소(['[', '{'])
  const inTopLevelObject = () =>
    stack[stack.length - 1] === '{' &&
    (stack.length === 1 || (stack.length === 2 && stack[0] === '['))
  let quote = null
  let expectKey = false
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i]
    if (quote) {
      if (ch === '\\') i++
      else if (ch === quote) quote = null
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch
      continue
    }
    if (ch === '{' || ch === '[' || ch === '(') {
      stack.push(ch)
      if (ch === '{') expectKey = true
      continue
    }
    if (ch === '}' || ch === ']' || ch === ')') {
      stack.pop()
      continue
    }
    if (ch === ',') {
      expectKey = true
      continue
    }
    if (expectKey && ch === '.' && trimmed.startsWith('...', i)) {
      // 최상위 ...spread — 어떤 키가 들어오는지 정적으로 알 수 없다
      if (inTopLevelObject()) hasSpread = true
      expectKey = false
      i += 2
      continue
    }
    if (expectKey && /[A-Za-z_]/.test(ch)) {
      // key: value의 키(뒤가 ':') 또는 shorthand(뒤가 ','/'}' — 식별자
      // 자체가 컬럼명)만 인정한다. 값 위치 식별자는 expectKey가 아니므로 제외.
      const m = trimmed.slice(i).match(/^([A-Za-z_]\w*)\s*([:,}])/)
      if (m && inTopLevelObject()) keys.push(m[1])
      expectKey = false
    }
  }
  return { keys, hasSpread }
}

function lineOf(source, index) {
  return source.slice(0, index).split('\n').length
}

// 주석·문자열 리터럴을 같은 길이의 공백(개행은 개행 유지)으로 치환한다.
// 목적: 주석 `// supabase.from('x')`·문자열 `"from('x')"` 안의 호출 패턴이
// .from()/.rpc() 매칭을 유발하지 못하게 프리패스한다. 문자 오프셋과 줄 수를
// 보존하므로, 이 결과로 찾은 match.index는 원본 source에서 그대로 유효하다
// (실제 인자 추출은 원본 source를 슬라이스한다 — 진짜 호출의 리터럴 인자 보존).
export function stripCommentsAndStrings(source) {
  let out = ''
  let i = 0
  const n = source.length
  while (i < n) {
    const ch = source[i]
    const next = source[i + 1]
    // 라인 주석
    if (ch === '/' && next === '/') {
      while (i < n && source[i] !== '\n') {
        out += ' '
        i++
      }
      continue
    }
    // 블록 주석
    if (ch === '/' && next === '*') {
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) {
        out += source[i] === '\n' ? '\n' : ' '
        i++
      }
      if (i < n) {
        out += ' '
        i++
      } // '*'
      if (i < n) {
        out += ' '
        i++
      } // '/'
      continue
    }
    // 문자열/템플릿 리터럴
    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch
      out += ' ' // 여는 따옴표
      i++
      while (i < n) {
        const c = source[i]
        if (c === '\\') {
          out += ' '
          i++
          if (i < n) {
            out += source[i] === '\n' ? '\n' : ' '
            i++
          }
          continue
        }
        if (c === quote) {
          out += ' '
          i++
          break
        }
        out += c === '\n' ? '\n' : ' '
        i++
      }
      continue
    }
    out += ch
    i++
  }
  return out
}

export function extractCallsFromSource(source, filePath) {
  const usages = []
  const skips = []
  // 주석·문자열을 공백으로 지운 프리패스 소스에서 호출 위치만 찾는다.
  // 오프셋이 보존되므로 인자·수신 객체·라인 계산은 원본 source로 수행한다.
  const scan = stripCommentsAndStrings(source)
  // .from(...) 체인
  for (const match of scan.matchAll(/\.\s*from\s*\(/g)) {
    // 수신 객체가 JS 내장 생성자면 supabase 호출이 아니므로 무시한다
    // (Array.from → skip 노이즈, Buffer.from('hello') → 유령 테이블 방지)
    const receiver = source.slice(0, match.index).match(/([A-Za-z_$][\w$]*)\s*$/)
    if (receiver && BUILTIN_FROM_RECEIVERS.has(receiver[1])) continue
    // Supabase Storage 버킷 접근(.storage.from(...))은 DB 스키마 계약 대상이 아님
    // — usage도 skip도 남기지 않는다 (리터럴 버킷명이 만들던 유령 테이블 오탐과
    //   동적 버킷명이 만들던 '동적 테이블명' skip 노이즈를 동시에 제거)
    if (receiver && receiver[1] === 'storage') continue
    const line = lineOf(source, match.index)
    const { calls } = scanChain(source, match.index)
    const fromCall = calls[0]
    if (!fromCall) continue
    const table = literalString(fromCall.args)
    if (table === null) {
      skips.push({
        file: filePath,
        line,
        reason: `동적 테이블명: from(${fromCall.args.slice(0, 40)})`,
      })
      continue
    }
    const columns = new Set()
    const relations = []
    for (const call of calls.slice(1)) {
      if (call.method === 'select') {
        const parsed = parseSelectColumns(call.args.split(/,(?=\s*\{)/)[0].trim())
        if (parsed.dynamic && call.args) {
          skips.push({ file: filePath, line, reason: `동적 select: ${table}` })
        }
        parsed.columns.forEach(c => columns.add(c))
        relations.push(...parsed.relations)
      } else if (COLUMN_ARG_METHODS.has(call.method)) {
        const col = literalString(call.args.split(',')[0].trim())
        if (col !== null && !col.includes('.')) columns.add(col.split('->')[0])
      } else if (WRITE_METHODS.has(call.method)) {
        // 옵션 인자({ onConflict: ... } 등)의 키가 컬럼으로 새지 않도록
        // 최상위 콤마에서 잘라 첫 번째 인자(페이로드)만 검사한다
        const extracted = extractObjectKeys(firstTopLevelArg(call.args))
        if (extracted === null) {
          skips.push({ file: filePath, line, reason: `동적 ${call.method} 페이로드: ${table}` })
        } else {
          extracted.keys.forEach(k => columns.add(k))
          if (extracted.hasSpread) {
            // spread 뒤에 숨은 키는 알 수 없다 — 수집한 키는 살리되 skip으로 보고
            skips.push({
              file: filePath,
              line,
              reason: `동적 ${call.method} 페이로드(spread 포함): ${table}`,
            })
          }
        }
      }
    }
    usages.push({ file: filePath, line, table, columns: [...columns].sort(), relations })
  }
  // .rpc(...) 호출
  for (const match of scan.matchAll(/\.\s*rpc\s*\(/g)) {
    const line = lineOf(source, match.index)
    const openIndex = match.index + match[0].length - 1
    const closeIndex = findMatchingParen(source, openIndex)
    if (closeIndex === -1) continue
    const fnName = literalString(
      source
        .slice(openIndex + 1, closeIndex)
        .split(',')[0]
        .trim()
    )
    if (fnName === null) {
      skips.push({ file: filePath, line, reason: '동적 RPC 이름' })
      continue
    }
    usages.push({ file: filePath, line, rpc: fnName })
  }
  return { usages, skips }
}
