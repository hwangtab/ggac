/**
 * 기능 설정 넷 — 게시판·아티스트 등록·댓글·파일 업로드.
 *
 * 관리자 화면 "기능 설정" 탭의 스위치가 실제로 무언가를 끄게 하는 자리다.
 * 모양은 펀딩 스위치(`@/lib/funding/settings`)를 그대로 따른다 — 설정 옆에
 * 작은 헬퍼를 두고, 막을 라우트 맨 위에서 한 번 부르고, 거절은 무슨 일이
 * 일어났고 누구에게 물어야 하는지 적은 한국어 한 문장이다.
 *
 * ## 끈다는 것이 무엇인가 — **새로 쓰이는 것만 막는다**
 *
 * 게시판을 껐다고 이미 있는 글이 사라지거나 링크가 404가 되면, 조합원이
 * 주고받은 주소와 검색 결과가 통째로 깨진다. 그건 "기능을 껐다"가 아니라
 * "자료를 잃었다"다. 그래서 넷 모두 **읽기는 그대로 두고 새 쓰기만** 막는다.
 *
 * - 게시판: 새 글이 올라오지 않는다. 읽기·수정·삭제·관리자 정리는 그대로다.
 * - 댓글: 새 댓글이 달리지 않는다. 달려 있던 댓글은 그대로 보이고 지울 수 있다.
 * - 아티스트 등록: 조합원이 아티스트 페이지를 새로 채우거나 고치지 못한다.
 *   공개된 아티스트 페이지는 그대로 보인다.
 * - 파일 업로드: 조합원이 올리는 새 파일이 막힌다. 올라가 있던 파일은
 *   그대로 내려받힌다.
 *
 * 수정과 삭제를 함께 막지 않는 이유는 하나 더 있다. 스위치를 내린 순간
 * 오타가 난 글도, 지우고 싶은 글도 영영 그대로 굳는다 — 끄는 쪽이 원한
 * 것은 새 글이 더 쌓이지 않는 것이지 남의 글을 붙들어 두는 것이 아니다.
 *
 * ## 관리자도 걸린다
 *
 * 펀딩 스위치가 관리자 라우트(`/api/admin/funding/...`)까지 막는 것과 같다.
 * 게시판을 껐는데 사무국만 글을 쓸 수 있으면 그건 껐다고 할 수 없다. 대신
 * 관리자 화면의 **정리**(글 삭제·아티스트 배정·이사회 서류·메일함)는 걸리지
 * 않는다 — 그쪽은 새 글·새 댓글·새 아티스트 페이지를 만드는 행위가 아니라서
 * 애초에 이 스위치가 말하는 동작이 아니다.
 *
 * ## 모르면 켜진 것으로 본다(fail-open)
 *
 * Turso가 한 번 삐끗했다고 조합의 게시판이 조용히 닫히면 안 된다.
 * `getSystemSettings()`는 조회에 실패하면 기본값(넷 다 켜짐)을 돌려주고 바깥
 * catch에서는 `null`을 돌려주는데, 아래 판정은 **저장된 값이 명시적으로
 * `false`일 때만** 꺼짐으로 읽는다. 행이 없어도, 값이 깨져도, 조회가
 * 실패해도 켜진 쪽이다.
 *
 * 펀딩만 반대다(`enabled === true`만 켜짐). 켜면 돈이 움직이기 때문이고,
 * 그 차이는 `src/lib/server/systemSettingsMapping.ts`에도 같은 말로 적혀 있다.
 */
import { getSystemSettings } from '@/utils/systemSettings'

/** 거절 문구. 무슨 일이 일어났는지와 누구에게 물어야 하는지를 함께 적는다. */
export const FEATURE_DISABLED_MESSAGES = {
  board:
    '게시판에 새 글을 올리는 기능이 지금 꺼져 있습니다. 사무국(contact@ggac.kr)으로 문의해 주세요.',
  comments: '댓글 기능이 지금 꺼져 있습니다. 사무국(contact@ggac.kr)으로 문의해 주세요.',
  artistRegistration:
    '아티스트 페이지 등록·수정 기능이 지금 꺼져 있습니다. 사무국(contact@ggac.kr)으로 문의해 주세요.',
  fileUpload: '파일 업로드 기능이 지금 꺼져 있습니다. 사무국(contact@ggac.kr)으로 문의해 주세요.',
} as const

/**
 * 저장된 설정값의 불리언 한 칸을 읽는다. **`false`일 때만 꺼짐**이다.
 *
 * `strict: false`라 `if (!value)`류의 축약은 `undefined`와 `false`를 같이
 * 삼킨다 — 그러면 행이 없을 때 기능이 꺼져 버린다. 명시적으로 비교한다.
 */
function readSwitch(value: unknown, key: string): boolean {
  if (value === null || typeof value !== 'object') return true
  return (value as Record<string, unknown>)[key] !== false
}

export async function isBoardEnabled(): Promise<boolean> {
  const settings = await getSystemSettings()
  return readSwitch(settings?.features?.board_features, 'enabled')
}

export async function isCommentsEnabled(): Promise<boolean> {
  const settings = await getSystemSettings()
  return readSwitch(settings?.features?.comment_features, 'enabled')
}

export async function isArtistRegistrationEnabled(): Promise<boolean> {
  const settings = await getSystemSettings()
  return readSwitch(settings?.features?.artist_features, 'registration_enabled')
}

export async function isFileUploadEnabled(): Promise<boolean> {
  const settings = await getSystemSettings()
  return readSwitch(settings?.features?.file_upload, 'enabled')
}
