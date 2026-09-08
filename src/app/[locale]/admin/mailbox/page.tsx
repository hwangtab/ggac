'use client'

import AdminLayout from '../components/AdminLayout'
import MailboxView from './MailboxView'

export default function MailboxPage() {
  return (
    <AdminLayout title="메일함" description="ggac.kr 수신 메일 조회 및 답장">
      <MailboxView />
    </AdminLayout>
  )
}
