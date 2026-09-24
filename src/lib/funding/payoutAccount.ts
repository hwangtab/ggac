/**
 * 정산금을 **어디로 보내는가**. DB도 네트워크도 모르는 순수 자리다.
 *
 * 조합은 정산금을 손으로 이체한다. 그 한 번의 이체에 필요한 것은 세 가지뿐이다
 * — 은행, 계좌번호, 예금주. 그 셋은 개설자가 가입할 때나 마이페이지에서
 * 직접 적어 둔 `member_profiles`의 값이고, **셋 다 비어 있을 수 있다.**
 *
 * ## 무엇을 "등록됐다"고 보는가
 *
 * 은행과 계좌번호가 **둘 다** 있어야 등록된 것이다. 하나만으로는 이체를
 * 시작할 수 없고, 프로필 저장 경로도 이미 둘을 짝으로 요구한다
 * (`src/app/api/mypage/profile/route.ts`). 공백만 적힌 칸은 비어 있는 것으로
 * 센다 — 화면에서는 값이 있는 것처럼 보이지만 이체할 수는 없다.
 *
 * **예금주는 요구하지 않는다.** 프로필 저장 경로가 요구한 적이 없어서 은행·
 * 계좌번호만 채운 회원이 이미 있다. 여기서 필수로 올리면 그 사람들의 지급이
 * 이유 없이 막힌다. 없으면 화면이 "예금주가 비어 있다"고 말하고, 사무국이
 * 이체 화면에서 확인하면 된다.
 *
 * ## 이 값은 사무국만 본다
 *
 * 계좌번호는 개설자 화면에도, 알림에도, 활동 기록에도, 로그에도 싣지 않는다.
 * 나가는 자리는 **사무국 전용 정산 패널 하나**이며, 그 판정은 화면이 아니라
 * 라우트(`requireAdmin`)가 한다. 개설자 쪽으로는 값이 아니라 **등록됐는가의
 * 참·거짓**만 간다 — 자기 계좌를 못 볼 이유는 없지만, 그것을 보여 주는 자리는
 * 마이페이지 내 정보이지 정산 화면이 아니다.
 */

/** 이체 한 번에 필요한 전부. `member_profiles`의 세 칸과 키가 같다. */
export interface PayoutAccount {
  bank_name: string | null
  account_number: string | null
  account_holder: string | null
}

/** 공백만 있는 칸은 없는 칸이다. */
function filled(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0
}

/**
 * 이 계좌로 지금 이체할 수 있는가.
 *
 * 은행과 계좌번호가 둘 다 있어야 한다(예금주는 요구하지 않는다 — 머리말 참고).
 * 프로필이 아예 없는 경우(`null`)도 당연히 거짓이다.
 */
export function isPayoutAccountRegistered(account: PayoutAccount | null | undefined): boolean {
  if (!account) return false
  return filled(account.bank_name) && filled(account.account_number)
}

/** 예금주만 비어 있는가. 등록은 됐지만 화면이 한 줄 덧붙여야 하는 상태다. */
export function isPayoutAccountHolderMissing(account: PayoutAccount | null | undefined): boolean {
  return isPayoutAccountRegistered(account) && !filled(account?.account_holder)
}

/**
 * 개설자가 계좌를 고치러 가는 자리. 알림과 대시보드가 같은 곳을 가리키도록
 * 한 군데에 적어 둔다.
 */
export const PAYOUT_ACCOUNT_SETTINGS_PATH = '/mypage/profile'

/**
 * 계좌가 없는데 지급을 기록하려 할 때 사무국이 읽는 문장.
 *
 * 거절이 아니라 **확인**이다 — 이체는 버튼을 누르기 전에 이미 끝난 일이라
 * 여기서 막아도 돈은 돌아오지 않는다. 다만 무엇을 기록하는 것인지 한 번은
 * 읽게 한다.
 */
export const PAYOUT_ACCOUNT_MISSING_NOTICE =
  '개설자가 등록해 둔 계좌가 없습니다. 사무국이 따로 확인한 계좌로 보냈다면 그대로 기록할 수 있고, 등록된 계좌가 없었다는 사실이 활동 기록에 함께 남습니다.'
