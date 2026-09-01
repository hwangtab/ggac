'use client'

import { useCallback, useEffect, useState } from 'react'
import AdminLayout from '../components/AdminLayout'

type GrantItem = {
  key: string
  source: string
  source_id: string
  title: string
  genres: string[]
  regions: string[]
  category: string
  apply_start: string | null
  apply_end: string | null
  url: string
  summary: string | null
  biz_type: string | null
  target: string | null
  excluded?: boolean
  manual?: boolean
}

type DigestStatus = 'draft' | 'publishing' | 'published' | 'discarded'

type DigestSummary = {
  id: string
  week_key: string
  status: DigestStatus
  post_id: string | null
  created_at: string
  published_at: string | null
  total_count: number
  active_count: number
}

type Digest = {
  id: string
  week_key: string
  items: GrantItem[]
  status: DigestStatus
  post_id: string | null
  created_at: string
  published_at: string | null
}

function statusLabel(status: DigestStatus): string {
  switch (status) {
    case 'draft':
      return '초안'
    case 'publishing':
      return '발행 중'
    case 'published':
      return '발행됨'
    case 'discarded':
      return '폐기'
    default:
      return status
  }
}

function dDayLabel(applyEnd: string | null): string {
  if (!applyEnd) return '상시'
  const end = Date.parse(`${applyEnd}T00:00:00Z`)
  const today = Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`)
  const days = Math.round((end - today) / 86_400_000)
  if (days < 0) return '마감'
  if (days === 0) return 'D-day'
  return `D-${days}`
}

export default function AdminGrantsPage() {
  const [summaries, setSummaries] = useState<DigestSummary[]>([])
  const [selected, setSelected] = useState<Digest | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)

  const loadList = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/grants')
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error?.message ?? '목록을 불러오지 못했습니다.')
      setSummaries(json.data.digests)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadList()
  }, [loadList])

  async function openDigest(id: string) {
    setError(null)
    setResult(null)
    try {
      const res = await fetch(`/api/admin/grants/${id}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error?.message ?? '회차를 불러오지 못했습니다.')
      setSelected(json.data.digest)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  function toggleExcluded(key: string) {
    if (!selected) return
    setSelected({
      ...selected,
      items: selected.items.map(i => (i.key === key ? { ...i, excluded: !i.excluded } : i)),
    })
  }

  async function saveItems() {
    if (!selected) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/grants/${selected.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: selected.items }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error?.message ?? '저장하지 못했습니다.')
      setSelected(json.data.digest)
      setResult('저장했습니다.')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  async function publish() {
    if (!selected) return
    const active = selected.items.filter(i => !i.excluded).length
    const ok = window.confirm(
      `조합원 전원에게 게시글·알림·이메일이 나갑니다 (공고 ${active}건).\n` +
        '이미 나간 메일과 알림은 회수되지 않습니다. 발행할까요?'
    )
    if (!ok) return

    setPublishing(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/grants/${selected.id}/publish`, { method: 'POST' })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error?.message ?? '발행하지 못했습니다.')
      const d = json.data
      setResult(
        `발행했습니다. 알림 ${d.notified}명, 메일 성공 ${d.email_sent} · 실패 ${d.email_failed} · 건너뜀 ${d.email_skipped}` +
          (d.notification_failed ? ' (알림 생성 실패 — 로그 확인 필요)' : '')
      )
      setSelected(null)
      await loadList()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setPublishing(false)
    }
  }

  return (
    <AdminLayout
      title="지원사업"
      description="매주 월요일 아침에 초안이 만들어집니다. 확인하고 발행하면 게시판·알림·이메일로 나갑니다."
    >
      {error && <p className="mb-4 rounded bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {result && <p className="mb-4 rounded bg-green-50 p-3 text-sm text-green-700">{result}</p>}

      {loading ? (
        <p className="text-sm text-gray-500">불러오는 중…</p>
      ) : summaries.length === 0 ? (
        <p className="text-sm text-gray-500">아직 회차가 없습니다.</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="border-b text-left text-gray-500">
            <tr>
              <th className="py-2">회차</th>
              <th>상태</th>
              <th>공고</th>
              <th>생성</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {summaries.map(s => (
              <tr key={s.id} className="border-b">
                <td className="py-2 font-medium">{s.week_key}</td>
                <td>{statusLabel(s.status)}</td>
                <td>
                  {s.active_count}/{s.total_count}건
                </td>
                <td className="text-gray-500">{s.created_at.slice(0, 10)}</td>
                <td className="text-right">
                  <button
                    type="button"
                    onClick={() => void openDigest(s.id)}
                    className="rounded border px-3 py-1 hover:bg-gray-50"
                  >
                    열기
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {selected && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-6">
          <div className="w-full max-w-3xl rounded-lg bg-white p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-bold">
                {selected.week_key} · 공고 {selected.items.filter(i => !i.excluded).length}건
              </h2>
              <button type="button" onClick={() => setSelected(null)} className="text-gray-400">
                닫기
              </button>
            </div>

            {selected.items.length === 0 && (
              <p className="mb-4 text-sm text-gray-500">
                이번 회차에 담긴 공고가 없습니다. 발행하면 &quot;이번 주에 새로 안내할 공고가
                없습니다&quot;라는 글이 올라갑니다.
              </p>
            )}

            <ul className="mb-6 space-y-3">
              {selected.items.map(it => (
                <li
                  key={it.key}
                  className={`rounded border p-3 ${it.excluded ? 'opacity-40' : ''}`}
                >
                  <label className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={!it.excluded}
                      onChange={() => toggleExcluded(it.key)}
                      className="mt-1"
                      disabled={selected.status !== 'draft'}
                    />
                    <span className="flex-1">
                      <a
                        href={it.url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="font-medium text-blue-700 hover:underline"
                      >
                        {it.title}
                      </a>
                      <span className="mt-1 block text-xs text-gray-500">
                        {dDayLabel(it.apply_end)}
                        {it.apply_end ? ` · 마감 ${it.apply_end}` : ''} ·{' '}
                        {[...it.regions, ...it.genres].join(' · ')}
                        {it.biz_type ? ` · ${it.biz_type}` : ''}
                      </span>
                      {it.summary && (
                        <span className="mt-1 block text-xs text-gray-600">{it.summary}</span>
                      )}
                    </span>
                  </label>
                </li>
              ))}
            </ul>

            {selected.status === 'draft' ? (
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => void saveItems()}
                  disabled={saving}
                  className="rounded border px-4 py-2 disabled:opacity-50"
                >
                  {saving ? '저장 중…' : '저장'}
                </button>
                <button
                  type="button"
                  onClick={() => void publish()}
                  disabled={publishing}
                  className="rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50"
                >
                  {publishing ? '발행 중…' : '발행'}
                </button>
              </div>
            ) : (
              <p className="text-right text-sm text-gray-500">
                이미 발행된 회차입니다{selected.post_id ? ` (게시글 ${selected.post_id})` : ''}.
              </p>
            )}
          </div>
        </div>
      )}
    </AdminLayout>
  )
}
