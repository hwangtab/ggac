import { FiClock, FiLock } from 'react-icons/fi'
import { Link } from '@/i18n/navigation'

/**
 * 내 문서함을 쓸 수 없을 때의 안내(docs/board-work/04-조합원-문서함.md §4·§7) — 승인·활성 조합원이 아니거나 기능
 * 스위치가 꺼졌을 때. 데이터는 아무것도 읽지 않는다.
 */
export default function DocumentsGate({ state }: { state: 'not-member' | 'off' }) {
  const off = state === 'off'
  const Icon = off ? FiClock : FiLock
  return (
    <div
      className="rounded-lg border border-gray-200 bg-gray-50 px-6 py-10 text-center"
      data-testid={off ? 'member-documents-off' : 'member-documents-not-member'}
    >
      <Icon aria-hidden="true" className="mx-auto mb-3 h-8 w-8 text-gray-400" />
      <h2 className="text-lg font-semibold text-gray-900">
        {off ? '내 문서함은 준비 중입니다' : '승인된 조합원만 쓸 수 있습니다'}
      </h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-gray-600">
        {off
          ? '조합원이 자기 문서를 보관하고 앱에서 바로 고칠 수 있는 공간을 준비하고 있습니다. 문의는 사무국(contact@ggac.kr)으로 해 주세요.'
          : '내 문서함은 가입 승인을 마친 활동 중인 조합원에게 열립니다. 승인 상태는 마이페이지 대시보드에서 확인할 수 있습니다.'}
      </p>
      <Link href="/mypage" className="tw-btn-secondary mt-5 inline-flex">
        마이페이지로
      </Link>
    </div>
  )
}
