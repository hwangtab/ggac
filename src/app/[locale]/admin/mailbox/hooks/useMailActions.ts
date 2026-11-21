import { useState, useEffect, useCallback, type Dispatch, type SetStateAction } from 'react'

import type { MailLabel } from '../LabelManager'
import type { ReplyTemplate } from '../TemplateManager'
import type { AssigneeOption, InboundEmail, InboundEmailDetail } from '../mailboxTypes'

/**
 * 메일 하나·여럿에 대한 변경(상태·라벨·다시 알림·담당자·일괄 처리)과 그에 필요한 보조 목록(라벨·템플릿·담당자 후보).
 * 화면의 행·상세를 낙관적으로 맞추므로 목록·상세의 setter를 받는다.
 */
export function useMailActions({
  emails,
  setEmails,
  setDetail,
  fetchEmails,
  fetchDetail,
  canManage,
  mineOnly,
  statusFilter,
  labelFilter,
  setLabelFilter,
  checkedIds,
  setCheckedIds,
}: {
  emails: InboundEmail[]
  setEmails: Dispatch<SetStateAction<InboundEmail[]>>
  setDetail: Dispatch<SetStateAction<InboundEmailDetail | null>>
  fetchEmails: () => Promise<void>
  fetchDetail: (id: string) => Promise<void>
  canManage: boolean
  mineOnly: boolean
  statusFilter: string
  labelFilter: string | null
  setLabelFilter: Dispatch<SetStateAction<string | null>>
  checkedIds: string[]
  setCheckedIds: Dispatch<SetStateAction<string[]>>
}) {
  const [updating, setUpdating] = useState<string | null>(null)
  const [snoozing, setSnoozing] = useState(false)
  const [customSnoozeOpen, setCustomSnoozeOpen] = useState(false)
  const [customSnooze, setCustomSnooze] = useState('')
  // 담당자 후보(관리자만 받는다 — 지정은 관리자만 한다).
  const [assigneeOptions, setAssigneeOptions] = useState<AssigneeOption[]>([])
  const [assigning, setAssigning] = useState(false)
  // 라벨 — 목록은 이사·감사·관리자 모두 받아 거르기에 쓰고, 붙이기·관리는 관리자만 한다.
  const [labels, setLabels] = useState<MailLabel[]>([])
  // 답장 템플릿(관리자만 — 답장·새 메일 작성이 관리자만이다).
  const [templates, setTemplates] = useState<ReplyTemplate[]>([])
  const [labelBusy, setLabelBusy] = useState(false)
  const [bulkUpdating, setBulkUpdating] = useState(false)

  const fetchLabels = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/mailbox/labels')
      if (!res.ok) return
      const json = await res.json()
      setLabels(json?.data?.labels ?? [])
    } catch {
      // 라벨이 안 와도 메일함은 그대로 쓴다.
    }
  }, [])

  useEffect(() => {
    fetchLabels()
  }, [fetchLabels])

  // 거르고 있던 라벨이 지워졌으면 거르기를 푼다 — 남겨 두면 빈 목록만 보인다.
  useEffect(() => {
    if (labelFilter && !labels.some(l => l.id === labelFilter)) setLabelFilter(null)
  }, [labels, labelFilter, setLabelFilter])

  const updateStatus = async (
    email: Pick<InboundEmail, 'id' | 'status'>,
    status: InboundEmail['status'],
    options: { silent?: boolean } = {}
  ) => {
    const expectedStatus = email.status
    setUpdating(email.id)
    try {
      const res = await fetch(`/api/admin/mailbox/${email.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, expected_status: expectedStatus }),
      })
      if (res.status === 409) {
        if (!options.silent) {
          alert('다른 관리자가 먼저 처리했습니다. 목록을 새로고침합니다.')
        }
        await fetchEmails()
        return
      }
      if (!res.ok) throw new Error('업데이트 실패')
      setEmails(prev => prev.map(e => (e.id === email.id ? { ...e, status } : e)))
      setDetail(prev => (prev && prev.id === email.id ? { ...prev, status } : prev))
    } catch {
      if (!options.silent) {
        alert('상태 업데이트에 실패했습니다.')
      }
    } finally {
      setUpdating(null)
    }
  }

  const fetchTemplates = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/mailbox/templates')
      if (res.ok) setTemplates((await res.json())?.data?.templates ?? [])
    } catch {
      // 템플릿이 안 와도 답장은 쓸 수 있다.
    }
  }, [])

  useEffect(() => {
    if (canManage) fetchTemplates()
  }, [canManage, fetchTemplates])

  useEffect(() => {
    if (!canManage) return
    let cancelled = false
    fetch('/api/admin/mailbox/assignees')
      .then(res => (res.ok ? res.json() : null))
      .then(json => {
        if (!cancelled) setAssigneeOptions(json?.data?.assignees ?? [])
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [canManage])

  /** 메일들에 라벨을 붙이거나 뗀다(관리자만). 화면의 행·상세와 라벨별 개수를 함께 맞춘다. */
  const applyLabel = async (emailIds: string[], labelId: string, action: 'add' | 'remove') => {
    if (emailIds.length === 0 || labelBusy) return false
    const label = labels.find(l => l.id === labelId)
    if (!label) return false
    setLabelBusy(true)
    try {
      const res = await fetch(`/api/admin/mailbox/labels/${labelId}/emails`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email_ids: emailIds, action }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error || '라벨을 바꾸지 못했습니다.')
      const targets = new Set(emailIds)
      const chip = { id: label.id, name: label.name, color: label.color }
      const patch = <T extends { id: string; labels?: InboundEmail['labels'] }>(email: T): T => {
        if (!targets.has(email.id)) return email
        const others = (email.labels ?? []).filter(l => l.id !== labelId)
        const next =
          action === 'add'
            ? [...others, chip].sort((a, b) => a.name.localeCompare(b.name, 'ko'))
            : others
        return { ...email, labels: next }
      }
      setEmails(prev => prev.map(patch))
      setDetail(prev => (prev ? patch(prev) : prev))
      await fetchLabels()
      if (labelFilter === labelId && action === 'remove') await fetchEmails()
      return true
    } catch (err) {
      alert(err instanceof Error ? err.message : '라벨을 바꾸지 못했습니다.')
      return false
    } finally {
      setLabelBusy(false)
    }
  }

  /** 다시 알림 걸기(`until`)·풀기(null) — 관리자만. 걸면 기본 목록에서 빠지므로 목록을 다시 읽는다. */
  const changeSnooze = async (email: InboundEmail, until: Date | null) => {
    if (snoozing) return
    setSnoozing(true)
    try {
      const res = await fetch(`/api/admin/mailbox/${email.id}/snooze`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ until: until ? until.toISOString() : null }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error || '다시 알림을 바꾸지 못했습니다.')
      const snoozed_until = (json?.data?.snoozed_until as string | null) ?? null
      setEmails(prev => prev.map(e => (e.id === email.id ? { ...e, snoozed_until } : e)))
      setDetail(prev => (prev && prev.id === email.id ? { ...prev, snoozed_until } : prev))
      setCustomSnooze('')
      setCustomSnoozeOpen(false)
      await fetchEmails()
    } catch (err) {
      alert(err instanceof Error ? err.message : '다시 알림을 바꾸지 못했습니다.')
    } finally {
      setSnoozing(false)
    }
  }

  const changeAssignee = async (email: InboundEmail, next: string | null) => {
    if (assigning) return
    setAssigning(true)
    try {
      const res = await fetch(`/api/admin/mailbox/${email.id}/assignee`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assignee_id: next,
          expected_assignee_id: email.assigned_to ?? null,
        }),
      })
      const json = await res.json().catch(() => null)
      if (res.status === 409) {
        alert('다른 관리자가 먼저 담당자를 바꿨습니다. 다시 불러옵니다.')
        await Promise.all([fetchEmails(), fetchDetail(email.id)])
        return
      }
      if (!res.ok) throw new Error(json?.error || '담당자를 바꾸지 못했습니다.')
      const patch = {
        assigned_to: json?.data?.assigned_to ?? null,
        assignee_name: json?.data?.assignee_name ?? null,
      }
      setEmails(prev => prev.map(e => (e.id === email.id ? { ...e, ...patch } : e)))
      setDetail(prev => (prev && prev.id === email.id ? { ...prev, ...patch } : prev))
      if (mineOnly) await fetchEmails()
    } catch (err) {
      alert(err instanceof Error ? err.message : '담당자를 바꾸지 못했습니다.')
    } finally {
      setAssigning(false)
    }
  }

  const bulkUpdate = async (status: InboundEmail['status']) => {
    const targets = emails.filter(e => checkedIds.includes(e.id))
    if (targets.length === 0 || bulkUpdating) return
    setBulkUpdating(true)
    try {
      const res = await fetch('/api/admin/mailbox', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status,
          items: targets.map(e => ({ id: e.id, expected_status: e.status })),
        }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error || '일괄 변경에 실패했습니다.')
      const updated = new Set<string>(json?.data?.updated ?? [])
      const skipped = (json?.data?.conflict?.length ?? 0) + (json?.data?.missing?.length ?? 0)
      setEmails(prev => prev.map(e => (updated.has(e.id) ? { ...e, status } : e)))
      setDetail(prev => (prev && updated.has(prev.id) ? { ...prev, status } : prev))
      setCheckedIds([])
      if (skipped > 0) {
        alert(`${skipped}건은 다른 관리자가 먼저 처리해 바꾸지 않았습니다. 목록을 새로고침합니다.`)
        await fetchEmails()
      } else if (statusFilter !== 'all') {
        // 상태로 거른 목록이면 옮긴 메일은 더 이상 이 목록에 속하지 않는다.
        await fetchEmails()
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : '일괄 변경에 실패했습니다.')
    } finally {
      setBulkUpdating(false)
    }
  }

  /**
   * 선택한 메일을 **완전히** 지운다(관리자 전용, 2026-11-09). 되돌릴 수 없으므로 확인을 받는다.
   * 첨부 파일도 함께 지워지고, 지운 사실은 활동 기록에 남는다.
   */
  const bulkDelete = async () => {
    const targets = emails.filter(e => checkedIds.includes(e.id))
    if (targets.length === 0 || bulkUpdating) return
    if (
      !window.confirm(
        `선택한 메일 ${targets.length}건을 완전히 지웁니다. 첨부 파일도 함께 지워지며 되돌릴 수 없습니다. 계속할까요?`
      )
    ) {
      return
    }
    setBulkUpdating(true)
    const deleted = new Set<string>()
    const failed: string[] = []
    try {
      for (const target of targets) {
        const res = await fetch(`/api/admin/mailbox/${target.id}`, { method: 'DELETE' })
        if (res.ok) deleted.add(target.id)
        else failed.push(target.id)
      }
      setEmails(prev => prev.filter(e => !deleted.has(e.id)))
      setDetail(prev => (prev && deleted.has(prev.id) ? null : prev))
      setCheckedIds(prev => prev.filter(id => !deleted.has(id)))
      if (failed.length > 0) {
        alert(`${failed.length}건은 지우지 못했습니다(권한 또는 상태를 확인해 주세요).`)
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : '메일 삭제에 실패했습니다.')
    } finally {
      setBulkUpdating(false)
    }
  }

  return {
    updating,
    updateStatus,
    snoozing,
    customSnoozeOpen,
    setCustomSnoozeOpen,
    customSnooze,
    setCustomSnooze,
    changeSnooze,
    assigneeOptions,
    assigning,
    changeAssignee,
    labels,
    fetchLabels,
    labelBusy,
    applyLabel,
    templates,
    fetchTemplates,
    bulkUpdating,
    bulkUpdate,
    bulkDelete,
  }
}

export type MailActions = ReturnType<typeof useMailActions>
