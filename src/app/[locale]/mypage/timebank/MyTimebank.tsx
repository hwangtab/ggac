'use client'

import { useCallback, useEffect, useState } from 'react'
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
export default function MyTimebank({
  canWrite,
  coopTasksEnabled,
}: {
  canWrite: boolean
  /** 조합 업무 스위치(`coopTasksOpen`). 꺼져 있으면 내역 필터에서 조합 업무를 뺀다. */
  coopTasksEnabled: boolean
}) {
  const [refreshKey, setRefreshKey] = useState(0)
  const bump = useCallback(() => setRefreshKey(k => k + 1), [])

  // 알림·메일 링크(`#pending`)와 게시판 글의 기록하기(`#record`)로 들어오면 그 칸으로
  // 내려간다. 위쪽 패널이 데이터를 받은 뒤에야 높이가 정해지므로 브라우저 기본 앵커
  // 이동은 엉뚱한 곳에 멈춘다 — 레이아웃이 바뀔 때마다(최대 6초) 다시 맞추고, 사용자가
  // 직접 움직이면 그만둔다.
  useEffect(() => {
    const id = window.location.hash.slice(1)
    if (id !== 'pending' && id !== 'record') return
    const align = () => document.getElementById(id)?.scrollIntoView({ block: 'start' })
    const observer = new ResizeObserver(align)
    observer.observe(document.body)
    const stop = () => observer.disconnect()
    const timer = window.setTimeout(stop, 6000)
    window.addEventListener('wheel', stop, { once: true, passive: true })
    window.addEventListener('touchstart', stop, { once: true, passive: true })
    window.addEventListener('keydown', stop, { once: true })
    align()
    return () => {
      stop()
      window.clearTimeout(timer)
      window.removeEventListener('wheel', stop)
      window.removeEventListener('touchstart', stop)
      window.removeEventListener('keydown', stop)
    }
  }, [])

  return (
    <div className="space-y-10">
      <BalancePanel refreshKey={refreshKey} />
      <PendingPanel refreshKey={refreshKey} canConfirm={canWrite} onChanged={bump} />
      {canWrite && <RecordForm onRecorded={bump} />}
      <HistoryPanel
        refreshKey={refreshKey}
        canRecord={canWrite}
        coopTasksEnabled={coopTasksEnabled}
        onChanged={bump}
      />
    </div>
  )
}
