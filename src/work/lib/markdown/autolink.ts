/**
 * 자동 링크(remark-gfm 의 literal autolink) 끝 다듬기.
 * gfm 은 `https://kosmart.org/notice에서` 처럼 한글 조사까지 한 주소로 잡는다. 화면에서는
 *  - 첫 비ASCII 글자 앞에서 끊고,
 *  - 끝의 `.,;:!?'"*~_>` 와 짝이 안 맞는 `)` 를 뗀다.
 * 뗀 부분은 링크 밖 글자로 돌려준다. (DB 쪽 URL 추출 규칙과 같은 규칙 — 0039)
 * 사용자가 직접 쓴 `[글](주소)`·`<주소>` 는 건드리지 않는다.
 */

const TRAILING_PUNCT = /[.,;:!?'"*~_>]$/

function count(s: string, ch: string): number {
  let n = 0
  for (const c of s) if (c === ch) n++
  return n
}

/** 주소 글자열 → 링크로 남길 부분과 링크 밖으로 뗀 꼬리. 다듬으면 주소가 남지 않으면 그대로 둔다 */
export function trimAutolinkText(text: string): { link: string; rest: string } {
  let end = text.length
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) > 127) {
      end = i
      break
    }
  }
  let link = text.slice(0, end)
  for (;;) {
    if (TRAILING_PUNCT.test(link)) {
      link = link.slice(0, -1)
    } else if (link.endsWith(')') && count(link, ')') > count(link, '(')) {
      link = link.slice(0, -1)
    } else {
      break
    }
  }
  // 스킴·호스트가 남지 않으면(예: 한글 도메인) 다듬지 않는다
  if (!/^(?:https?:\/\/|www\.)[^\s/?#]+/i.test(link)) return { link: text, rest: '' }
  return { link, rest: text.slice(link.length) }
}

type MdNode = {
  type: string
  value?: string
  url?: string
  children?: MdNode[]
  position?: { start?: { offset?: number } }
}

function walk(node: MdNode, source: string) {
  const kids = node.children
  if (!kids) return
  for (let i = 0; i < kids.length; i++) {
    const kid = kids[i]
    if (kid.type === 'link' && kid.children?.length === 1 && kid.children[0].type === 'text') {
      const text = kid.children[0]
      const value = text.value ?? ''
      const url = kid.url ?? ''
      // 자동 링크 글자는 주소 그대로(www. 는 http:// 가 앞에 붙는다). 이메일(mailto:)은 제외
      const literal = /^https?:\/\//i.test(url) && (value === url || `http://${value}` === url)
      const open = source.charAt(kid.position?.start?.offset ?? -1)
      if (literal && open !== '<' && open !== '[') {
        const { link, rest } = trimAutolinkText(value)
        if (rest) {
          text.value = link
          kid.url = value === url ? link : `http://${link}`
          kids.splice(i + 1, 0, { type: 'text', value: rest })
          i++
        }
      }
      continue
    }
    walk(kid, source)
  }
}

/** react-markdown remarkPlugins 에 remarkGfm 뒤로 넣는다 */
export function remarkTrimAutolinks() {
  return (tree: MdNode, file: { value?: unknown }) => {
    walk(tree, typeof file.value === 'string' ? file.value : '')
  }
}
