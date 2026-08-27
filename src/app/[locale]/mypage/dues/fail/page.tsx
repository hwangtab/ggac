'use client'

/**
 * 결제 실패 화면.
 *
 * **여기서는 승인 API를 부르지 않는다.** 토스가 실패 주소로 보냈다는 건
 * 결제가 성립하지 않았다는 뜻이고, 그 상태에서 승인을 시도하면 의미 없는
 * 오류만 쌓인다.
 *
 * 토스가 주는 오류 코드는 영문이라 그대로 보여주면 아무도 못 읽는다. 자주
 * 나오는 것만 한국어로 풀고, 나머지는 토스가 준 한국어 메시지를 쓴다.
 */

import { useSearchParams } from 'next/navigation'
import { FiAlertCircle } from 'react-icons/fi'

import { Link } from '@/i18n/navigation'
import MypageLayout from '../../components/MypageLayout'
import PermissionCheck from '../../components/PermissionCheck'

/** 사용자가 뭘 하면 되는지까지 알려 주는 안내로 바꾼다. */
const GUIDE: Record<string, string> = {
  PAY_PROCESS_CANCELED: '결제를 취소하셨습니다. 다시 시도하시려면 조합비 화면으로 돌아가 주세요.',
  PAY_PROCESS_ABORTED: '결제가 중단되었습니다. 잠시 후 다시 시도해 주세요.',
  REJECT_CARD_COMPANY:
    '카드사에서 결제를 거절했습니다. 다른 카드로 시도하거나 카드사에 문의해 주세요.',
  REJECT_CARD_PAYMENT:
    '한도 초과 또는 잔액 부족으로 결제되지 않았습니다. 다른 카드로 시도해 주세요.',
  INVALID_CARD_EXPIRATION: '카드 유효기간이 올바르지 않습니다. 카드 정보를 다시 확인해 주세요.',
  EXCEED_MAX_DAILY_PAYMENT_COUNT: '하루 결제 가능 횟수를 넘었습니다. 내일 다시 시도해 주세요.',
}

export default function DuesFailPage() {
  const params = useSearchParams()
  const code = params.get('code') ?? ''
  const tossMessage = params.get('message') ?? ''

  const guide =
    GUIDE[code] || tossMessage || '결제가 완료되지 않았습니다. 잠시 후 다시 시도해 주세요.'

  return (
    <PermissionCheck requiredPermission="member">
      <MypageLayout title="조합비 결제" description="결제가 완료되지 않았습니다.">
        <div className="py-10 text-center">
          <FiAlertCircle className="mx-auto h-12 w-12 text-amber-600" aria-hidden />
          <h2 className="mt-4 text-xl font-semibold text-gray-900">결제가 완료되지 않았습니다</h2>
          <p className="mx-auto mt-2 max-w-md text-gray-600">{guide}</p>
          <p className="mt-4 text-sm text-gray-500">
            결제되지 않았으므로 조합비는 청구되지 않습니다.
          </p>

          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Link
              href="/mypage/dues"
              className="rounded-lg bg-primary-600 px-5 py-2.5 font-medium text-white transition hover:bg-primary-700"
            >
              다시 시도하기
            </Link>
            <a
              href="mailto:contact@ggac.kr"
              className="rounded-lg border border-gray-300 px-5 py-2.5 font-medium text-gray-700 transition hover:bg-gray-50"
            >
              사무국에 문의
            </a>
          </div>
        </div>
      </MypageLayout>
    </PermissionCheck>
  )
}
