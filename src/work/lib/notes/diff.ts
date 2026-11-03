/**
 * 줄 단위 차이(순수). 메모 충돌 화면("차이 보기")과 이력 비교가 쓴다.
 * LCS 동적계획법 — 두 본문의 줄 수 곱이 상한을 넘으면(아주 긴 메모끼리) 공통 머리·꼬리만 맞추고 가운데는 통째로 교체로 본다.
 */

export type DiffOp = { type: 'same' | 'add' | 'del'; text: string }

const MAX_CELLS = 4_000_000

function splitLines(text: string): string[] {
  return text === '' ? [] : text.replace(/\r\n/g, '\n').split('\n')
}

/** a(이전) → b(이후): 지워진 줄 del, 새 줄 add */
export function diffLines(a: string, b: string): DiffOp[] {
  const x = splitLines(a)
  const y = splitLines(b)

  // 공통 머리·꼬리를 먼저 떼어 표 크기를 줄인다
  let head = 0
  while (head < x.length && head < y.length && x[head] === y[head]) head++
  let tail = 0
  while (
    tail < x.length - head &&
    tail < y.length - head &&
    x[x.length - 1 - tail] === y[y.length - 1 - tail]
  ) {
    tail++
  }
  const xm = x.slice(head, x.length - tail)
  const ym = y.slice(head, y.length - tail)

  const ops: DiffOp[] = x.slice(0, head).map(text => ({ type: 'same', text }))
  ops.push(...middleDiff(xm, ym))
  ops.push(...x.slice(x.length - tail).map((text): DiffOp => ({ type: 'same', text })))
  return ops
}

function middleDiff(x: string[], y: string[]): DiffOp[] {
  if (x.length === 0) return y.map(text => ({ type: 'add', text }))
  if (y.length === 0) return x.map(text => ({ type: 'del', text }))
  if ((x.length + 1) * (y.length + 1) > MAX_CELLS) {
    return [
      ...x.map((text): DiffOp => ({ type: 'del', text })),
      ...y.map((text): DiffOp => ({ type: 'add', text })),
    ]
  }
  const w = y.length + 1
  const t = new Uint32Array((x.length + 1) * w)
  for (let i = x.length - 1; i >= 0; i--) {
    for (let j = y.length - 1; j >= 0; j--) {
      t[i * w + j] =
        x[i] === y[j] ? t[(i + 1) * w + j + 1] + 1 : Math.max(t[(i + 1) * w + j], t[i * w + j + 1])
    }
  }
  const ops: DiffOp[] = []
  let i = 0
  let j = 0
  while (i < x.length && j < y.length) {
    if (x[i] === y[j]) {
      ops.push({ type: 'same', text: x[i] })
      i++
      j++
    } else if (t[(i + 1) * w + j] >= t[i * w + j + 1]) {
      ops.push({ type: 'del', text: x[i++] })
    } else {
      ops.push({ type: 'add', text: y[j++] })
    }
  }
  while (i < x.length) ops.push({ type: 'del', text: x[i++] })
  while (j < y.length) ops.push({ type: 'add', text: y[j++] })
  return ops
}

/** 바뀐 줄이 있나 */
export function hasChanges(ops: readonly DiffOp[]): boolean {
  return ops.some(o => o.type !== 'same')
}
