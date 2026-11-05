/**
 * 메일함 새 메일 작성 입력 검증 — 순수 함수.
 *
 * 로컬 import가 하나도 없어야 한다 — `node --test`의 타입 스트리핑 제약. 그래서
 * `@test.local` 판정도 `lib/mail/send.ts`와 같은 규칙을 여기서 한 번 더 쓴다.
 *
 * 이 모듈은 **형식**만 본다. 권한·일일 상한·정화는 라우트가 한다.
 */

export const COMPOSE_LIMITS = {
  maxTo: 5,
  maxCc: 5,
  maxBcc: 5,
  /** to+cc+bcc에서 중복을 걸러낸 합계. 단체 발송 도구가 되지 않게 하는 상한이다. */
  maxTotal: 10,
  subjectMax: 200,
  bodyMax: 200_000,
  maxAttachments: 5,
  /**
   * 첨부 합계(바이트). Vercel 함수 요청 본문 한도가 4.5MB라 그 안에 본문·multipart 오버헤드까지
   * 들어와야 한다. 클라이언트가 Blob에 직접 올리는 방식은 발송이 실패하면 고아 파일을 남기므로 쓰지 않는다.
   */
  maxAttachmentTotalBytes: 4_000_000,
  /**
   * 전달하는 받은 첨부의 합계(바이트). 이 첨부는 요청 본문을 거치지 않고 서버가 비공개 저장소에서 복사하므로
   * 4.5MB 한도와 무관하다. 대신 받는 쪽 메일 서버의 흔한 한도(10~25MB)에서 넉넉히 안쪽으로 잡는다.
   */
  maxForwardTotalBytes: 10_000_000,
} as const

/** 메일로 나가면 안 되는(수신 측 필터가 막거나 실행 파일인) 확장자. */
const BLOCKED_EXTENSIONS = new Set([
  'exe',
  'bat',
  'cmd',
  'com',
  'scr',
  'msi',
  'pif',
  'vbs',
  'vbe',
  'js',
  'jse',
  'wsf',
  'wsh',
  'ps1',
  'jar',
  'lnk',
  'dll',
  'reg',
  'hta',
  'cpl',
  'app',
  'dmg',
  'apk',
  // 디스크 이미지·스크립트를 품은 문서·브라우저가 열어 실행하는 형식. 수신 측이 막거나 사람이 잘못 열기 쉽다.
  'iso',
  'img',
  'vhd',
  'vhdx',
  'html',
  'htm',
  'svg',
  'docm',
  'xlsm',
  'pptm',
  'sh',
  'command',
])

const ADDRESS_PATTERN =
  /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/

export function isTestRecipientAddress(address: string): boolean {
  const domain = address.trim().toLowerCase().split('@').pop() ?? ''
  return domain === 'test.local' || domain.endsWith('.test.local')
}

/** 순수 주소만 받는다. 표시이름(`이름 <a@b>`)·쉼표·세미콜론·공백·개행은 거부한다. */
export function normalizeAddress(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const address = raw.trim().toLowerCase()
  if (address.length === 0 || address.length > 254) return null
  if (!ADDRESS_PATTERN.test(address)) return null
  const local = address.slice(0, address.indexOf('@'))
  if (local.length > 64 || local.startsWith('.') || local.endsWith('.') || local.includes('..')) {
    return null
  }
  return address
}

export type ComposeInput = {
  to?: unknown
  cc?: unknown
  bcc?: unknown
  subject?: unknown
}

export type ComposeValue = {
  to: string[]
  cc: string[]
  bcc: string[]
  subject: string
  recipientCount: number
}

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; error: string }

/** `strict: false`에서는 `!r.ok`가 유니온을 좁히지 않는다 — 오류만 꺼내 새 결과로 감싼다. */
function failure(result: unknown): { ok: false; error: string } {
  return { ok: false, error: (result as { error: string }).error }
}

function normalizeList(raw: unknown, label: string, max: number): ValidationResult<string[]> {
  if (raw === undefined || raw === null) return { ok: true, value: [] }
  if (!Array.isArray(raw)) return { ok: false, error: `${label} 형식이 올바르지 않습니다.` }
  if (raw.length > max) return { ok: false, error: `${label}는 ${max}명까지 입력할 수 있습니다.` }
  const out: string[] = []
  for (const item of raw) {
    const address = normalizeAddress(item)
    if (!address) {
      return { ok: false, error: `${label}에 올바르지 않은 이메일 주소가 있습니다.` }
    }
    if (!out.includes(address)) out.push(address)
  }
  return { ok: true, value: out }
}

export function validateCompose(input: ComposeInput): ValidationResult<ComposeValue> {
  const to = normalizeList(input.to, '받는 사람', COMPOSE_LIMITS.maxTo)
  if (!to.ok) return failure(to)
  const cc = normalizeList(input.cc, '참조', COMPOSE_LIMITS.maxCc)
  if (!cc.ok) return failure(cc)
  const bcc = normalizeList(input.bcc, '숨은참조', COMPOSE_LIMITS.maxBcc)
  if (!bcc.ok) return failure(bcc)

  if (to.value.length === 0) return { ok: false, error: '받는 사람을 1명 이상 입력해 주세요.' }

  // 같은 주소가 여러 칸에 있으면 앞 칸이 이긴다(to > cc > bcc).
  const seen = new Set(to.value)
  const ccUnique = cc.value.filter(a => !seen.has(a))
  ccUnique.forEach(a => seen.add(a))
  const bccUnique = bcc.value.filter(a => !seen.has(a))
  bccUnique.forEach(a => seen.add(a))

  const recipientCount = to.value.length + ccUnique.length + bccUnique.length
  if (recipientCount > COMPOSE_LIMITS.maxTotal) {
    return {
      ok: false,
      error: `한 번에 보낼 수 있는 수신자는 모두 합쳐 ${COMPOSE_LIMITS.maxTotal}명까지입니다.`,
    }
  }

  // E2E 픽스처 주소와 실주소가 섞이면 픽스처가 실주소로 새는 사고의 길이 된다.
  const all = [...to.value, ...ccUnique, ...bccUnique]
  const testCount = all.filter(isTestRecipientAddress).length
  if (testCount > 0 && testCount < all.length) {
    return { ok: false, error: '테스트 주소와 실제 주소를 함께 보낼 수 없습니다.' }
  }

  const subject = typeof input.subject === 'string' ? input.subject : ''
  // 헤더 주입을 막기 위해 개행은 공백으로 바꾼 뒤 다듬는다.
  // eslint-disable-next-line no-control-regex
  const cleanSubject = subject.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim()
  if (!cleanSubject) return { ok: false, error: '제목을 입력해 주세요.' }
  if (cleanSubject.length > COMPOSE_LIMITS.subjectMax) {
    return { ok: false, error: `제목은 ${COMPOSE_LIMITS.subjectMax}자까지 입력할 수 있습니다.` }
  }

  return {
    ok: true,
    value: {
      to: to.value,
      cc: ccUnique,
      bcc: bccUnique,
      subject: cleanSubject,
      recipientCount,
    },
  }
}

export type AttachmentMeta = { name: string; size: number }

/** 사람이 읽을 파일명. 경로 구분자·제어문자를 제거하고 길이를 자른다(저장 경로에는 쓰지 않는다). */
export function sanitizeAttachmentName(raw: string): string {
  // eslint-disable-next-line no-control-regex
  const cleaned = raw
    .replace(/[\u0000-\u001f\u007f]/g, '')
    // 방향 제어·보이지 않는 문자. `invoice\u202Efdp.exe`처럼 확장자를 위장하는 데 쓰인다.
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g, '')
    .replace(/[\\/]/g, '_')
    // 끝의 점·공백 — Windows는 `a.exe.`를 `a.exe`로 읽는다.
    .replace(/[.\s]+$/g, '')
    .trim()
  const name = cleaned.length > 120 ? cleaned.slice(-120) : cleaned
  return name || 'attachment'
}

/** 메일로 내보낼 수 없는 확장자인가. 전달 창이 처음부터 고를 수 없게 그리는 데 쓴다(검증은 아래 함수들이 한다). */
export function isBlockedAttachmentName(raw: string): boolean {
  const name = sanitizeAttachmentName(raw)
  const dot = name.lastIndexOf('.')
  return dot !== -1 && BLOCKED_EXTENSIONS.has(name.slice(dot + 1).toLowerCase())
}

export function validateAttachments(files: AttachmentMeta[]): ValidationResult<AttachmentMeta[]> {
  if (files.length > COMPOSE_LIMITS.maxAttachments) {
    return { ok: false, error: `첨부는 ${COMPOSE_LIMITS.maxAttachments}개까지 가능합니다.` }
  }
  let total = 0
  const out: AttachmentMeta[] = []
  for (const file of files) {
    const name = sanitizeAttachmentName(file.name)
    if (!Number.isFinite(file.size) || file.size <= 0) {
      return { ok: false, error: `비어 있는 파일은 첨부할 수 없습니다: ${name}` }
    }
    const dot = name.lastIndexOf('.')
    const ext = dot === -1 ? '' : name.slice(dot + 1).toLowerCase()
    if (BLOCKED_EXTENSIONS.has(ext)) {
      return { ok: false, error: `보낼 수 없는 파일 형식입니다: ${name}` }
    }
    total += file.size
    out.push({ name, size: file.size })
  }
  if (total > COMPOSE_LIMITS.maxAttachmentTotalBytes) {
    return {
      ok: false,
      error: `첨부 용량은 합쳐서 ${Math.floor(COMPOSE_LIMITS.maxAttachmentTotalBytes / 1_000_000)}MB까지입니다.`,
    }
  }
  return { ok: true, value: out }
}

export type ForwardAttachmentMeta = { id: string; name: string; size: number | null }

/**
 * 전달할 받은 첨부 검증 — 개수는 올린 첨부와 **합쳐** `maxAttachments`, 용량은 전달분만 `maxForwardTotalBytes`.
 * 실행 파일 확장자는 올린 첨부와 같이 막는다(받은 메일에 들어 있었다고 우리 이름으로 내보내지 않는다).
 * 크기를 모르는 첨부(`size` null)는 여기서 통과시키고 라우트가 실제로 읽은 뒤 다시 잰다.
 */
export function validateForwardAttachments(
  files: ForwardAttachmentMeta[],
  uploadedCount: number
): ValidationResult<ForwardAttachmentMeta[]> {
  if (files.length + uploadedCount > COMPOSE_LIMITS.maxAttachments) {
    return {
      ok: false,
      error: `첨부는 전달하는 것까지 합쳐 ${COMPOSE_LIMITS.maxAttachments}개까지 가능합니다.`,
    }
  }
  let total = 0
  const out: ForwardAttachmentMeta[] = []
  for (const file of files) {
    const name = sanitizeAttachmentName(file.name)
    const dot = name.lastIndexOf('.')
    const ext = dot === -1 ? '' : name.slice(dot + 1).toLowerCase()
    if (BLOCKED_EXTENSIONS.has(ext)) {
      return { ok: false, error: `전달할 수 없는 파일 형식입니다: ${name}` }
    }
    total += file.size ?? 0
    out.push({ id: file.id, name, size: file.size })
  }
  if (total > COMPOSE_LIMITS.maxForwardTotalBytes) {
    return { ok: false, error: forwardTooLargeMessage() }
  }
  return { ok: true, value: out }
}

export function forwardTooLargeMessage(): string {
  return `전달하는 첨부는 합쳐서 ${Math.floor(COMPOSE_LIMITS.maxForwardTotalBytes / 1_000_000)}MB까지입니다. 큰 파일은 내려받아 따로 공유해 주세요.`
}
