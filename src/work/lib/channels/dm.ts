/**
 * DM 키 규약(0001): 정렬된 user_id 두 개를 ':'로 이은 문자열. channels.dm_key unique.
 * 자기 자신과의 DM(메모)은 `<me>:<me>`.
 */
export function dmKey(a: string, b: string): string {
  const [x, y] = [a.toLowerCase(), b.toLowerCase()].sort()
  return `${x}:${y}`
}

/** dm_key 에서 상대 user_id. 자기 자신과의 DM이면 자기 id. 형식이 틀리면 null. */
export function otherDmUserId(key: string | null | undefined, me: string): string | null {
  if (!key) return null
  const parts = key.split(':')
  if (parts.length !== 2) return null
  const meLower = me.toLowerCase()
  if (parts[0] === meLower && parts[1] === meLower) return meLower
  if (parts[0] === meLower) return parts[1]
  if (parts[1] === meLower) return parts[0]
  return null
}
