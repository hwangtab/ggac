/**
 * 인증 메일의 제목과 본문을 만든다.
 *
 * 로컬 import가 하나도 없어야 한다 — `node --test`가 `.ts`를 읽을 때 쓰는 타입
 * 스트리핑 모드는 확장자 없는 로컬 import를 해석하지 못한다.
 *
 * 템플릿을 `supabase/templates/*.html`에서 런타임에 읽지 않고 여기에 문자열로
 * 둔 이유: 그 경로는 Vercel 번들에 포함되지 않아 배포에서 ENOENT로 죽는다.
 * 원본과 문구·스타일을 같게 유지하되, 원본이 바뀌면 여기도 함께 고쳐야 한다.
 */

export type AuthEmailKind = 'recovery' | 'confirmation'

const SUBJECTS: Record<AuthEmailKind, string> = {
  recovery: '[경기아트콜렉티브] 비밀번호 재설정 안내',
  confirmation: '[경기아트콜렉티브] 회원가입 이메일 인증',
}

/** href 속성에 URL을 넣기 전에 HTML 특수문자를 막는다. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function bodyFor(kind: AuthEmailKind, safeUrl: string): string {
  const heading = kind === 'recovery' ? '비밀번호 재설정' : '회원가입 이메일 인증'
  const lead =
    kind === 'recovery'
      ? '경기아트콜렉티브 계정의 비밀번호 재설정 요청을 받았습니다.<br />아래 버튼을 눌러 새 비밀번호를 설정해 주세요. 본인이 요청하지 않았다면 이 메일을 무시하셔도 됩니다.'
      : '경기아트콜렉티브 회원가입을 신청해 주셔서 감사합니다.<br />아래 버튼을 눌러 이메일 인증을 완료해 주세요.'
  const cta = kind === 'recovery' ? '비밀번호 재설정하기' : '이메일 인증하기'

  return `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px; color: #1f2937;">
  <h1 style="font-size: 20px; font-weight: 700; margin-bottom: 16px">${heading}</h1>
  <p style="font-size: 14px; line-height: 1.6; color: #4b5563; margin-bottom: 24px">${lead}</p>
  <a href="${safeUrl}" style="display: inline-block; background-color: #2563eb; color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-size: 14px; font-weight: 600">${cta}</a>
  <p style="font-size: 12px; line-height: 1.6; color: #9ca3af; margin-top: 24px">버튼이 동작하지 않으면 아래 주소를 복사해 브라우저에 붙여넣으세요.<br />${safeUrl}</p>
</div>`
}

export function renderAuthEmail(
  kind: AuthEmailKind,
  url: string
): { subject: string; html: string } {
  const subject = SUBJECTS[kind]
  if (!subject) {
    throw new Error(`알 수 없는 인증 메일 종류입니다: ${String(kind)}`)
  }
  return { subject, html: bodyFor(kind, escapeHtml(url)) }
}

const RESEND_ENDPOINT = 'https://api.resend.com/emails'
const FROM = '경기아트콜렉티브 <noreply@ggac.kr>'

/**
 * Resend HTTP API로 인증 메일을 보낸다.
 *
 * SMTP(465)가 아니라 HTTP를 쓰는 이유: 서버리스 함수는 연결을 유지하지 못해
 * 콜드 스타트마다 TLS 핸드셰이크를 새로 한다. 발신 도메인·발신자는 지금
 * Supabase가 쓰는 것과 같다(noreply@ggac.kr).
 *
 * 실패하면 던진다. 호출부(Better Auth 훅)가 그걸 어떻게 다룰지 정한다 —
 * 조용히 삼키면 "메일이 안 왔다"는 문의를 원인 없이 받게 된다.
 */
export async function sendAuthEmail(kind: AuthEmailKind, to: string, url: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    throw new Error('RESEND_API_KEY가 설정되지 않았습니다.')
  }

  const { subject, html } = renderAuthEmail(kind, url)

  const response = await fetch(RESEND_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: FROM, to: [to], subject, html }),
    signal: AbortSignal.timeout(10_000),
  })

  if (!response.ok) {
    // 본문에 API 키가 들어가지 않는다 — 상태 코드와 Resend의 오류 메시지만 남긴다.
    const detail = await response.text().catch(() => '')
    throw new Error(`Resend 발송 실패 (${response.status}): ${detail.slice(0, 200)}`)
  }
}
