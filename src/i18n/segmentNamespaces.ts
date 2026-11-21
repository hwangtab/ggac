// 클라이언트 컴포넌트(`useTranslations`)가 쓰는 메시지 네임스페이스 정본.
// 루트 레이아웃은 ROOT만 내려 모든 페이지의 HTML/RSC 페이로드를 줄이고, 더 필요한 구간은
// 자기 layout.tsx에서 <SegmentIntl>로 보탠다. 새 클라이언트 컴포넌트가 다른 네임스페이스를
// 쓰면 여기와 layout을 함께 고쳐야 하며, 빠뜨리면 scripts/testing/clientNamespaces.test.mjs가 잡는다.

/** 모든 페이지에 내려가는 네임스페이스 (Navigation·Footer·LocaleSwitcher·Hero·공용 위젯). */
export const ROOT_NAMESPACES = ['common', 'nav', 'footer', 'locale', 'home'] as const

/** `src/app/[locale]` 기준 구간 디렉터리 -> 추가 네임스페이스. */
export const SEGMENT_NAMESPACES: Record<string, readonly string[]> = {
  connect: ['connect'],
  artists: ['artists'],
  projects: ['projects', 'application'],
  tickets: ['tickets'],
  funding: ['funding'],
  login: ['auth'],
  signup: ['auth'],
  'forgot-password': ['auth'],
  'reset-password': ['auth'],
  register: ['auth'],
  mypage: ['mypage', 'funding', 'timebank'],
  board: ['board', 'market', 'timebank'],
  'board-room': ['boardRoom'],
}

type Tree = Record<string, unknown>

/** 최상위(또는 점 표기) 키만 골라 새 트리로 만든다. 없는 키는 건너뛴다. */
export function pickMessages(messages: Tree, keys: readonly string[]): Tree {
  const out: Tree = {}
  for (const key of keys) {
    const path = key.split('.')
    let src: unknown = messages
    for (const p of path) {
      src = src && typeof src === 'object' ? (src as Tree)[p] : undefined
    }
    if (src === undefined) continue
    let dst = out
    path.slice(0, -1).forEach(p => {
      dst = (dst[p] ??= {}) as Tree
    })
    dst[path[path.length - 1]] = src
  }
  return out
}
