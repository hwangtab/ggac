'use client'

import { useCallback, useState } from 'react'
import BalancePanel from './BalancePanel'
import PendingPanel from './PendingPanel'
import RecordForm from './RecordForm'
import HistoryPanel from './HistoryPanel'

/**
 * 잔액·확인 대기·기록하기·내역을 한 묶음으로 둔다. 기록·확인·거절·취소·되돌리기
 * 요청이 끝나면 `refreshKey`를 올려 네 영역이 함께 다시 읽는다.
 *
 * `canWrite`는 화면 판정(`resolveTimebankViewer`의 쓰기 판정)이다 — 단추를 숨길
 * 뿐이고, 경계는 API(`requireTimebankParticipant`)가 지킨다.
 */
export default function MyTimebank({ canWrite }: { canWrite: boolean }) {
  const [refreshKey, setRefreshKey] = useState(0)
  const bump = useCallback(() => setRefreshKey(k => k + 1), [])

  return (
    <div className="space-y-10">
      <BalancePanel refreshKey={refreshKey} />
      <PendingPanel refreshKey={refreshKey} canConfirm={canWrite} onChanged={bump} />
      {canWrite && <RecordForm onRecorded={bump} />}
      <HistoryPanel refreshKey={refreshKey} canRecord={canWrite} onChanged={bump} />
    </div>
  )
}
