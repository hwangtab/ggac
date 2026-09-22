import { register } from 'node:module'

/**
 * 플레인 `node --test`가 이 프로젝트의 `@/*` tsconfig 경로 별칭과, 확장자를
 * 생략한 상대 경로 import(`./schema`가 가리키는 `./schema/index.ts` 같은
 * 것)를 풀 수 있게 해 주는 ESM 리졸브 훅.
 *
 * `@/*`는 번들러(Next.js 웹팩) 전용 별칭이라 Node의 네이티브 ESM 리졸버는
 * 원래 모른다. 확장자 생략·디렉터리 import도 웹팩은 자동 보정하지만 Node는
 * `ERR_MODULE_NOT_FOUND`/`ERR_UNSUPPORTED_DIR_IMPORT`로 죽는다. 이 훅은
 * `@/foo` → `src/foo.ts`로 직접 매핑하고, 그 외의 실패는 `.ts` → `.js` →
 * `/index.ts` 순으로 재시도한다(전부 실패하면 원래 에러를 그대로 던진다 —
 * 진짜 존재하지 않는 모듈은 여전히 실패해야 한다).
 *
 * `memberAuth.test.mjs`가 이 훅을 처음 도입했고, 이후 여러 테스트 파일이
 * 각자 같은 코드를 그대로 복사해 넣었다(`authzTursoConversion.test.mjs`,
 * `documentVisibility.test.mjs`, `withdrawalIsApprovedActive.test.mjs`,
 * `seed-authz-fixtures.mjs`). 이번 변경은 그 다섯 개를 이 파일로 옮기지
 * **않는다** — 이미 동작하는 파일을 건드릴 이유가 없는 채로 옮기면 리뷰
 * 범위만 커진다. 새로 만드는 테스트부터 이 헬퍼를 쓰고, 기존 다섯 개는
 * 필요할 때(예: 그 파일을 다른 이유로 손대는 김에) 옮기면 된다.
 *
 * `node --test`는 파일마다 별도 프로세스로 격리해 실행하므로(기본 동작) 이
 * 훅은 그것을 호출한 테스트 파일에만 영향을 준다.
 */
export function registerAliasResolveHook(importMetaUrl) {
  const projectRootUrl = new URL('../../', importMetaUrl).href
  const resolveHookSource = `
const ROOT = ${JSON.stringify(projectRootUrl)}
const FALLBACK_SUFFIXES = ['.ts', '.js', '/index.ts']

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) {
    return { url: new URL('src/' + specifier.slice(2) + '.ts', ROOT).href, shortCircuit: true }
  }
  try {
    return await nextResolve(specifier, context)
  } catch (err) {
    const isResolutionError =
      err && (err.code === 'ERR_MODULE_NOT_FOUND' || err.code === 'ERR_UNSUPPORTED_DIR_IMPORT')
    if (isResolutionError && !specifier.endsWith('.ts') && !specifier.endsWith('.js')) {
      for (const suffix of FALLBACK_SUFFIXES) {
        try {
          return await nextResolve(specifier + suffix, context)
        } catch {
          // 다음 후보 확장자로 계속 시도한다.
        }
      }
    }
    throw err
  }
}
`
  register('data:text/javascript,' + encodeURIComponent(resolveHookSource), importMetaUrl)
}
