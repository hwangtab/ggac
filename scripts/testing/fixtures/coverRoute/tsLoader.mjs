/**
 * `.ts`를 그때그때 컴파일해서 읽어 오는 ESM 로더 훅.
 *
 * 다른 테스트들이 쓰는 `node --experimental-strip-types`는 **타입만 지우는**
 * 방식이라, 코드를 생성해야 하는 문법(`enum`, `constructor(public x)`)이 들어
 * 있으면 거부한다. API 라우트는 `@/utils/apiWrapper`(파라미터 프로퍼티)와
 * `@/utils/errorHandler`(enum)를 거치므로 그 방식으로는 아예 불러올 수 없다.
 * 그 두 파일을 테스트 편의를 위해 고치는 대신, 이 테스트만 진짜 컴파일러를
 * 쓴다.
 *
 * 함께 하는 일 둘:
 * - `@/*` 별칭과 확장자 없는 상대 경로(`./schema` → `./schema/index.ts`) 해석.
 * - `stubs`에 적힌 모듈을 대역으로 바꿔치기.
 */
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import ts from 'typescript'

let root = ''
let stubs = {}

export function initialize(data) {
  root = data.root
  stubs = data.stubs ?? {}
}

const FALLBACK_SUFFIXES = ['.ts', '.tsx', '.js', '/index.ts']

function swap(result) {
  const replacement = stubs[result.url]
  return replacement ? { url: replacement, shortCircuit: true } : result
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) {
    return swap({
      url: new URL('src/' + specifier.slice(2) + '.ts', root).href,
      shortCircuit: true,
    })
  }
  try {
    return swap(await nextResolve(specifier, context))
  } catch (err) {
    const isResolutionError =
      err && (err.code === 'ERR_MODULE_NOT_FOUND' || err.code === 'ERR_UNSUPPORTED_DIR_IMPORT')
    if (isResolutionError && !specifier.endsWith('.ts') && !specifier.endsWith('.js')) {
      for (const suffix of FALLBACK_SUFFIXES) {
        try {
          return swap(await nextResolve(specifier + suffix, context))
        } catch {
          // 다음 후보 확장자로 계속 시도한다.
        }
      }
    }
    throw err
  }
}

export async function load(url, context, nextLoad) {
  if (url.startsWith('file:') && /\.tsx?$/.test(url)) {
    const source = await readFile(fileURLToPath(url), 'utf8')
    const { outputText } = ts.transpileModule(source, {
      fileName: fileURLToPath(url),
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
        verbatimModuleSyntax: false,
      },
    })
    return { format: 'module', source: outputText, shortCircuit: true }
  }
  return nextLoad(url, context)
}
