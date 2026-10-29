/**
 * 1:1 DM 의 상대 user_id 판정. dm_key 는 정렬된 user_id 둘을 ':' 로 이은 값이다(0001).
 * 그룹(`group:<id>`)·내가 아닌 두 사람의 키는 건너뛴다. 접속 점(0020) 표시용.
 */
/** 'a:b' 에서 내가 아닌 쪽. 그룹 키·형식 오류·내가 없는 키는 null */
export function dmPeerFromKey(dmKey: string | null, meId: string): string | null {
  if (!dmKey || dmKey.startsWith('group:')) return null
  const parts = dmKey.split(':')
  if (parts.length !== 2 || !parts.includes(meId)) return null
  const peer = parts[0] === meId ? parts[1] : parts[0]
  return peer && peer !== meId ? peer : null
}
