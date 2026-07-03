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
  'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'is', 'in',
  'contains', 'containedBy', 'order', 'textSearch',
])
const WRITE_METHODS = new Set(['insert', 'update', 'upsert'])

// 객체 리터럴 최상위 키를 수집한다. 리터럴이 아니면 null.
function extractObjectKeys(argText) {
  const trimmed = argText.trim()
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null
  const keys = []
  let depth = 0
  let quote = null
  let expectKey = false
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i]
    if (quote) {
      if (ch === '\\') i++
      else if (ch === quote) quote = null
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue }
    if (ch === '{') { depth++; expectKey = true; continue }
    if (ch === '}' || ch === ']' || ch === '(') { if (ch !== '(') depth--; continue }
    if (ch === ',') { expectKey = true; continue }
    if (expectKey && /[A-Za-z_]/.test(ch)) {
      const m = trimmed.slice(i).match(/^([A-Za-z_]\w*)\s*:/)
      if (m) keys.push(m[1])
      expectKey = false
    }
  }
  return keys
}

function lineOf(source, index) {
  return source.slice(0, index).split('\n').length
}

export function extractCallsFromSource(source, filePath) {
  const usages = []
  const skips = []
  // .from(...) 체인
  for (const match of source.matchAll(/\.\s*from\s*\(/g)) {
    const line = lineOf(source, match.index)
    const { calls } = scanChain(source, match.index)
    const fromCall = calls[0]
    if (!fromCall) continue
    const table = literalString(fromCall.args)
    if (table === null) {
      skips.push({ file: filePath, line, reason: `동적 테이블명: from(${fromCall.args.slice(0, 40)})` })
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
        const keys = extractObjectKeys(call.args)
        if (keys === null) {
          skips.push({ file: filePath, line, reason: `동적 ${call.method} 페이로드: ${table}` })
        } else keys.forEach(k => columns.add(k))
      }
    }
    usages.push({ file: filePath, line, table, columns: [...columns].sort(), relations })
  }
  // .rpc(...) 호출
  for (const match of source.matchAll(/\.\s*rpc\s*\(/g)) {
    const line = lineOf(source, match.index)
    const openIndex = match.index + match[0].length - 1
    const closeIndex = findMatchingParen(source, openIndex)
    if (closeIndex === -1) continue
    const fnName = literalString(source.slice(openIndex + 1, closeIndex).split(',')[0].trim())
    if (fnName === null) {
      skips.push({ file: filePath, line, reason: '동적 RPC 이름' })
      continue
    }
    usages.push({ file: filePath, line, rpc: fnName })
  }
  return { usages, skips }
}
