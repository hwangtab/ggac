/**
 * 공통 자동 툴팁 판정(순수 DOM 함수) — `AutoTooltip`이 쓴다.
 * 글자 없이 아이콘(또는 숫자 배지)만 보이는 버튼·링크에 마우스를 올리거나 키보드로 포커스하면
 * 그 요소의 접근성 이름(aria-label)을 툴팁으로 보여 준다. 화면 판독기는 이미 aria-label 을 읽으므로 툴팁은 aria-hidden.
 *
 * - 대상: button · a[href] · [role=button] · [role=tab] · `data-tooltip` 을 준 요소(말줄임 아닌 보조 설명 — `title` 대용, docs/13 §9 l)
 * - 문구: `data-tooltip` > `aria-label` > `aria-labelledby` 가 가리키는 글
 * - 화면에 보이는 글자(.sr-only 제외. 숫자·기호만 있으면 글자로 치지 않는다)가 있으면 띄우지 않는다
 *   (단 `data-tooltip` 을 직접 준 요소는 글자가 있어도 띄운다)
 * - 끄기: `data-no-tooltip`. 브라우저 기본 툴팁(`title`)이 있는 요소도 건너뛴다.
 */

export const AUTO_TOOLTIP_TARGET = 'button, a[href], [role="button"], [role="tab"], [data-tooltip]'

/** 사람이 읽는 글자(한글·영문 등 문자)가 있는가 — 숫자·기호·이모지만 있으면 false */
function hasLetters(text: string): boolean {
  return /\p{L}/u.test(text)
}

/** 화면에 보이는 글. 화면 판독기 전용(.sr-only)은 뺀다 */
export function visibleText(el: Element): string {
  const clone = el.cloneNode(true) as Element
  clone.querySelectorAll('.sr-only').forEach(n => n.remove())
  return (clone.textContent ?? '').trim()
}

function labelOf(el: Element): string | null {
  const aria = el.getAttribute('aria-label')?.trim()
  if (aria) return aria
  const ids = el.getAttribute('aria-labelledby')?.trim()
  if (ids && el.ownerDocument) {
    const text = ids
      .split(/\s+/)
      .map(id => el.ownerDocument.getElementById(id)?.textContent?.trim() ?? '')
      .filter(Boolean)
      .join(' ')
    if (text) return text
  }
  return null
}

/** 이 요소에 띄울 툴팁 문구. 띄우지 않으면 null */
export function autoTooltipText(el: Element): string | null {
  if (el.hasAttribute('data-no-tooltip')) return null
  const explicit = el.getAttribute('data-tooltip')?.trim()
  if (explicit) return explicit
  if (el.hasAttribute('title')) return null
  const label = labelOf(el)
  if (!label) return null
  if (hasLetters(visibleText(el))) return null
  return label
}

/** 이벤트 대상에서 가장 가까운 툴팁 대상 요소(없으면 null) */
export function findTooltipTarget(node: EventTarget | null): Element | null {
  if (!node || !(node instanceof Element)) return null
  const el = node.closest(AUTO_TOOLTIP_TARGET)
  return el && autoTooltipText(el) ? el : null
}

export type TooltipPlacement = 'top' | 'bottom'

/**
 * 툴팁 위치(fixed 좌표). 기본은 요소 아래 가운데, 아래 공간이 모자라면 위.
 * 가로는 화면 가장자리에서 margin 만큼 안쪽으로 가둔다.
 */
export function placeTooltip(
  anchor: { top: number; bottom: number; left: number; width: number },
  tip: { width: number; height: number },
  viewport: { width: number; height: number },
  gap = 6,
  margin = 8
): { x: number; y: number; placement: TooltipPlacement } {
  const below = anchor.bottom + gap
  const placement: TooltipPlacement =
    below + tip.height + margin > viewport.height && anchor.top - gap - tip.height >= margin
      ? 'top'
      : 'bottom'
  const y = placement === 'bottom' ? below : anchor.top - gap - tip.height
  const center = anchor.left + anchor.width / 2 - tip.width / 2
  const x = Math.min(
    Math.max(center, margin),
    Math.max(margin, viewport.width - tip.width - margin)
  )
  return { x, y, placement }
}
