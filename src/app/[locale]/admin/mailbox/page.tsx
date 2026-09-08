'use client'

import AdminLayout from '../components/AdminLayout'
import MailboxView from './MailboxView'

export default function MailboxPage() {
  return (
    <AdminLayout title="메일함" description="ggac.kr 수신 메일 조회 및 답장">
      {/* AdminLayout 크롬 실측: 헤더 ≈113px + 푸터 ≈77px + main 패딩(py-6×2)
          ≈48px → 15rem(240px)이 근사치다. */}
      <MailboxView className="h-[calc(100vh-15rem)] min-h-[420px]" />
    </AdminLayout>
  )
}
