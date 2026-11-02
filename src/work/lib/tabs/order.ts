/**
 * 탭 순서 바꾸기(순수). 추가 탭 id 목록(현재 순서)에서 한 칸 옮긴 새 순서를 돌려준다.
 * 더 갈 곳이 없거나(맨 앞에서 왼쪽 / 맨 뒤에서 오른쪽) 목록에 없는 id 면 null.
 */
export type MoveDirection = 'left' | 'right'

export function moveInOrder(
  ids: readonly string[],
  id: string,
  direction: MoveDirection
): string[] | null {
  const from = ids.indexOf(id)
  if (from < 0) return null
  const to = direction === 'left' ? from - 1 : from + 1
  if (to < 0 || to >= ids.length) return null
  const next = [...ids]
  ;[next[from], next[to]] = [next[to], next[from]]
  return next
}

/** 새 순서 → 바뀐 위치만 (id, position 0..n-1). 간격·중복이 있던 position 도 이때 0부터 다시 매긴다 */
export function changedPositions(
  next: readonly string[],
  current: ReadonlyMap<string, number>
): { id: string; position: number }[] {
  return next
    .map((id, position) => ({ id, position }))
    .filter(({ id, position }) => current.get(id) !== position)
}
