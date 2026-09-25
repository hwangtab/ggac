/**
 * 이메일 인증 관문 — **인증하지 않은 주소로는 로그인하지 못하게 한다.**
 *
 * 조합이 결제 확인·환불 안내·배송 안내를 메일로 보내기 시작했으므로, 주소가
 * 살아 있는지가 처음으로 실제 문제가 됐다. 관리자 화면의 스위치가 이 모듈을
 * 통해 실제로 무언가를 한다.
 *
 * ## 왜 Better Auth 옵션이 아닌가
 *
 * Better Auth에는 같은 일을 하는 `emailAndPassword.requireEmailVerification`이
 * 있다. 쓰지 않는다 — 그 옵션은 `betterAuth({...})`를 만들 때 **한 번** 읽히는
 * 불리언이라, 값을 설정에서 가져오려면 모듈 로드 시점에 Turso를 읽어야 한다.
 * 그 순간 Turso가 느리거나 닿지 않으면 **사이트 전체의 로그인이 함께 죽는다.**
 * 그래서 판정을 요청 시점으로 내리고, 관문은 라우트
 * (`src/app/api/auth/[...all]/route.ts`)에 둔다.
 *
 * ## 모르면 통과시킨다(fail-open)
 *
 * 모양은 기능 스위치 넷(`@/lib/features/settings`)을 그대로 따른다. 설정 조회가
 * 실패하거나, 행이 없거나, 값이 깨져 있으면 **켜지지 않은 것으로 읽는다.**
 * 설정 한 줄을 못 읽었다는 이유로 전 조합원이 로그인하지 못하는 쪽이, 인증
 * 안 한 한 사람이 들어오는 쪽보다 훨씬 비싸다.
 *
 * ## 기본값은 꺼짐이고, **운영의 옛 값이 그것을 뒤집지 못한다**
 *
 * 운영 `system_settings`의 `security/email_verification` 행에는 아무도 읽지
 * 않는 `required: true`가 들어 있다. 그 키를 그대로 읽으면 배포하는 순간
 * 관문이 켜져 미인증 회원이 문 앞에서 막힌다. 그래서 이 관문은 **다른 칸**
 * (`enforce_on_login`)을 본다 — 운영 행에는 없는 칸이라 배포 직후 값은
 * "꺼짐"이고, 사무국이 화면에서 켜기 전까지 아무것도 달라지지 않는다.
 * 옛 `required`는 화면이 처음 저장할 때 같은 값으로 맞춰진다(라우트의 역변환
 * 참고).
 *
 * ## 관리자는 걸리지 않는다
 *
 * 기능 스위치 넷은 관리자도 함께 막지만 이 관문은 다르다. 마지막 관리자의
 * 주소가 인증되지 않은 채 스위치가 켜지면 **스위치를 끌 사람이 아무도 남지
 * 않는다** — 되돌리는 길이 DB를 손으로 고치는 것뿐인 스위치는 스위치가 아니다.
 * 관문이 지키려는 것도 "조합원에게 보낸 결제·환불·배송 안내가 닿는가"이지
 * 사무국 계정의 위생이 아니다. 대신 관리자 화면이 미인증 관리자 수를 따로
 * 세어 보여 준다.
 *
 * ## 이 관문이 드러내는 것 — 알고 고른 값이다
 *
 * 관문은 **비밀번호를 확인하기 전에** 판정한다. 그래서 스위치가 켜져 있는
 * 동안에는 "그 주소로 가입된 계정이 있고 아직 인증되지 않았다"는 사실이
 * 비밀번호 없이 드러난다. 그 대신 **세션이 아예 만들어지지 않는다** —
 * 로그인시킨 뒤 되돌리는 방식은 쿠키를 지우는 데 한 군데라도 실패하면
 * 막으려던 사람을 그대로 들여보낸다. 가입 라우트(`/api/member-signup`)가
 * 이미 "이미 가입된 이메일입니다"로 같은 존재 여부를 답하고 있어 새로
 * 열리는 것은 인증 여부 한 칸뿐이고, 들여보내지 않는 쪽이 더 값지다.
 */
import { getSystemSettings } from '@/utils/systemSettings'

/**
 * 거절 응답의 코드. 로그인 화면이 이 값으로 "인증 메일 다시 받기"를 띄운다.
 * Better Auth가 같은 상황에 쓰는 코드와 같은 이름이라 클라이언트가 두 경로를
 * 따로 다루지 않아도 된다.
 */
export const EMAIL_NOT_VERIFIED_CODE = 'EMAIL_NOT_VERIFIED'

/** 거절 문구. 무슨 일이 일어났는지와 어떻게 빠져나오는지를 함께 적는다. */
export const EMAIL_NOT_VERIFIED_MESSAGE =
  '이메일 인증을 마쳐야 로그인할 수 있습니다. 가입할 때 받은 인증 메일의 링크를 눌러 주세요. 메일을 찾을 수 없으면 아래에서 다시 받을 수 있습니다.'

/** 관문이 판정에 쓰는 두 칸. 프로필 전체를 들고 다니지 않는다. */
export interface VerificationSubject {
  email_verified?: boolean | null
  is_admin?: boolean | null
}

/**
 * 저장된 설정이 관문을 **켰는가**. `enforce_on_login === true`일 때만 켜짐이다
 * (펀딩 스위치와 같은 판정 — 켜는 쪽이 명시적이어야 하는 스위치다).
 */
export async function isEmailVerificationEnforced(): Promise<boolean> {
  try {
    const settings = await getSystemSettings()
    const value = settings?.security?.email_verification
    if (value === null || typeof value !== 'object') return false
    return (value as Record<string, unknown>).enforce_on_login === true
  } catch {
    // `getSystemSettings()`는 스스로 삼키고 기본값·null을 돌려주도록 만들어져
    // 있지만, 그 계약이 나중에 바뀌더라도 로그인이 함께 죽지는 않아야 한다.
    return false
  }
}

/**
 * 이 계정을 돌려보낼 것인가. 관문이 켜져 있다는 전제에서만 부른다.
 *
 * - 계정이 없으면 `false`다. 이 관문은 "있는 계정의 주소가 인증됐는가"만
 *   말하고, 없는 주소는 Better Auth가 평소대로 자격 증명 오류로 돌려보낸다.
 * - 관리자는 `false`다(파일 첫머리 참고).
 * - 그 밖에는 인증됐을 때만 통과한다. `strict: false`라 `!subject.email_verified`
 *   류의 축약은 `undefined`를 `false`와 함께 삼키므로 명시적으로 비교한다.
 */
export function refusesUnverifiedLogin(subject: VerificationSubject | null | undefined): boolean {
  if (!subject) return false
  if (subject.is_admin === true) return false
  return subject.email_verified !== true
}
