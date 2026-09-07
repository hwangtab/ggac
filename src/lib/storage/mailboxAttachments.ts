/**
 * 메일함 첨부의 비공개 Blob 경로를 만들고, 그 경로가 우리 것인지 판정한다.
 *
 * 로컬 import가 하나도 없어야 한다 — `node --test` 타입 스트리핑 제약.
 *
 * **자기 접두어와 자기 판정을 따로 두는 이유:** 비공개 저장소에는 이사회 문서와
 * 함께 조합 DB 전체 덤프가 `backups/` 접두어로 산다. 첨부 경로가 접두어를
 * 벗어나면 관리자 인가만 통과한 요청이 DB 덤프를 내려받을 수 있게 된다.
 *
 * 파일명은 **경로에 쓰지 않는다.** 확장자만 뽑아 붙이고 나머지는 첨부 id 다 —
 * 외부에서 온 파일명이 경로를 결정하게 두면 그 자체가 이탈 통로다.
 * 사람이 읽을 원래 파일명은 DB(`inbound_email_attachments.filename`)에 있다.
 */

export const MAILBOX_ATTACHMENT_PREFIX = 'mailbox'

/** 영숫자 1~10자만 확장자로 인정한다. 그 밖은 확장자 없이 저장한다. */
function safeExtension(filename: string): string {
  const dot = filename.lastIndexOf('.')
  if (dot === -1 || dot === filename.length - 1) return ''
  const ext = filename.slice(dot + 1)
  return /^[A-Za-z0-9]{1,10}$/.test(ext) ? `.${ext.toLowerCase()}` : ''
}

export function blobPathForAttachment(
  emailId: string,
  attachmentId: string,
  filename: string
): string {
  return `${MAILBOX_ATTACHMENT_PREFIX}/${emailId}/${attachmentId}${safeExtension(filename)}`
}

/**
 * `mailbox/<emailId>/<attachmentId>[.ext]` 세 조각만 통과시킨다.
 * 제어문자·역슬래시·절대경로·스킴·질의·프래그먼트·퍼센트인코딩을 전부 거부한다.
 */
export function isSafeMailboxAttachmentPath(path: string): boolean {
  if (typeof path !== 'string' || path.length === 0 || path.length > 300) return false
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(path)) return false
  if (/[\\?#%]/.test(path)) return false
  if (path.startsWith('/') || path.includes('//') || path.includes(':')) return false

  const segments = path.split('/')
  if (segments.length !== 3) return false
  if (segments[0] !== MAILBOX_ATTACHMENT_PREFIX) return false
  return segments
    .slice(1)
    .every(
      segment =>
        /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(segment) && segment !== '.' && segment !== '..'
    )
}

/**
 * 브라우저가 파일로 저장하게 만드는 헤더. 파일명에 개행·따옴표가 섞이면
 * 헤더가 쪼개지므로 ASCII 대체본과 UTF-8 인코딩본을 함께 낸다.
 */
export function contentDispositionAttachment(filename: string): string {
  const fallback = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`
}
