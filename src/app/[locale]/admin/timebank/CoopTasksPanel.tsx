'use client'

import { useCallback, useEffect, useState } from 'react'
import { Link } from '@/i18n/navigation'
import { TIMEBANK_CATEGORIES, TIMEBANK_MEMO_MAX } from '@/constants/timebank'
import { TIMEBANK_MINUTE_OPTIONS, timebankFetch } from '@/components/timebank/timebankFormat'
import { fmtKst, fmtMinutes } from '@/components/timebank/timebankAdminFormat'

const CATEGORY_LABEL: Record<(typeof TIMEBANK_CATEGORIES)[number], string> = {
  lesson: '레슨',
  feedback: '피드백',
  production_help: '제작 도움',
  moving: '이동·운반',
  audience: '관객',
  admin_help: '행정 도움',
  daily: '생활',
  etc: '기타',
}

type Task = {
  id: string
  title: string
  status: 'open' | 'closed'
  task_date: string | null
  volunteer_count: number
  created_at: string
}

type Volunteer = { member_id: string; display_name: string; volunteered_at: string }

/**
 * 조합 업무(스펙 §6·§7.3): 글 올리기, 자원자 보기, 크레딧 지급.
 *
 * 지급 조건(자원 기록·참여 자격·지급자 ≠ 대상·같은 글 중복 없음·월 상한)은 서버
 * 원장이 한 트랜잭션에서 본다. 이 화면은 "사례비·인건비를 지급하지 않았다" 확인과
 * 사유를 받고, 거부 사유는 서버 문구 그대로 보인다. 지명·배정 기능은 없다 — 자원한
 * 사람만 고를 수 있다.
 */
export default function CoopTasksPanel({
  open,
  myId,
  onChanged,
}: {
  /** 전체 스위치 + `coop_tasks_enabled`. 꺼져 있으면 글·지급이 서버에서 403이다. */
  open: boolean
  myId: string | null
  onChanged: () => void
}) {
  const [tasks, setTasks] = useState<Task[] | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  // 새 글
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState<string>('admin_help')
  const [description, setDescription] = useState('')
  const [estimated, setEstimated] = useState<string>('')
  const [taskDate, setTaskDate] = useState('')
  const [creating, setCreating] = useState(false)

  // 지급
  const [selected, setSelected] = useState<string | null>(null)
  const [volunteers, setVolunteers] = useState<Volunteer[] | null>(null)
  const [member, setMember] = useState('')
  const [minutes, setMinutes] = useState(60)
  const [memo, setMemo] = useState('')
  const [notPaid, setNotPaid] = useState(false)
  const [crediting, setCrediting] = useState(false)

  const loadTasks = useCallback(async () => {
    const result = await timebankFetch<{ tasks: Task[] }>(
      '/api/admin/timebank/tasks',
      {},
      '조합 업무 글을 불러오지 못했습니다.'
    )
    if (result.ok) {
      setTasks(result.data.tasks)
      setListError(null)
    } else setListError(result.error)
  }, [])

  useEffect(() => {
    void loadTasks()
  }, [loadTasks])

  const loadVolunteers = useCallback(async (id: string) => {
    setVolunteers(null)
    const result = await timebankFetch<{ volunteers: Volunteer[] }>(
      `/api/admin/timebank/tasks/${id}/credit`,
      {},
      '자원자를 불러오지 못했습니다.'
    )
    if (result.ok) setVolunteers(result.data.volunteers)
    else setNotice({ kind: 'error', text: result.error })
  }, [])

  const create = async (event: React.FormEvent) => {
    event.preventDefault()
    setCreating(true)
    setNotice(null)
    const result = await timebankFetch<{ id: string }>(
      '/api/admin/timebank/tasks',
      {
        method: 'POST',
        json: {
          title,
          category,
          description,
          estimated_minutes: estimated ? Number(estimated) : null,
          task_date: taskDate || null,
        },
      },
      '조합 업무 글을 올리지 못했습니다.'
    )
    setCreating(false)
    if (result.ok) {
      setNotice({ kind: 'ok', text: result.message ?? '조합 업무 글을 올렸습니다.' })
      setTitle('')
      setDescription('')
      setEstimated('')
      setTaskDate('')
      void loadTasks()
    } else setNotice({ kind: 'error', text: result.error })
  }

  const credit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!selected) return
    setCrediting(true)
    setNotice(null)
    const result = await timebankFetch(
      `/api/admin/timebank/tasks/${selected}/credit`,
      {
        method: 'POST',
        json: { member_id: member, minutes, memo, not_paid_elsewhere: notPaid },
      },
      '조합 업무 크레딧을 지급하지 못했습니다.'
    )
    setCrediting(false)
    if (result.ok) {
      setNotice({ kind: 'ok', text: result.message ?? '조합 업무 크레딧을 지급했습니다.' })
      setMemo('')
      setNotPaid(false)
      setMember('')
      void loadTasks()
      onChanged()
    } else setNotice({ kind: 'error', text: result.error })
  }

  const field = 'mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm'
  const selectedTask = tasks?.find(t => t.id === selected) ?? null

  return (
    <div className="space-y-8">
      {!open && (
        <p className="rounded-lg border border-yellow-200 bg-yellow-50 p-3 text-sm text-yellow-800">
          조합 업무 크레딧이 꺼져 있습니다(타임뱅크 전체 스위치와 조합 업무 스위치가 모두 켜져야
          합니다). 지금은 글을 올리거나 지급할 수 없습니다 — 설정 탭에서 이사회 의결 근거와 함께
          켭니다.
        </p>
      )}
      {notice && (
        <p
          role={notice.kind === 'error' ? 'alert' : 'status'}
          className={`rounded-lg p-3 text-sm ${notice.kind === 'error' ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-800'}`}
        >
          {notice.text}
        </p>
      )}

      <section aria-labelledby="adm-task-new">
        <h2 id="adm-task-new" className="mb-2 text-lg font-semibold text-gray-900">
          조합 업무 글 올리기
        </h2>
        <p className="mb-3 text-sm text-gray-600">
          글 상세에는 &ldquo;참여는 자유이며 참여하지 않아도 불이익이 없습니다&rdquo; 안내가
          고정됩니다. 조합원이 스스로 &ldquo;참여할게요&rdquo;를 눌러야 지급 대상이 됩니다.
        </p>
        <form onSubmit={e => void create(e)} className="grid gap-3 md:grid-cols-2">
          <label className="text-sm font-medium text-gray-700 md:col-span-2">
            제목
            <input
              className={field}
              value={title}
              onChange={e => setTitle(e.target.value)}
              required
              maxLength={80}
            />
          </label>
          <label className="text-sm font-medium text-gray-700">
            분류
            <select className={field} value={category} onChange={e => setCategory(e.target.value)}>
              {TIMEBANK_CATEGORIES.map(c => (
                <option key={c} value={c}>
                  {CATEGORY_LABEL[c]}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm font-medium text-gray-700">
            예상 시간
            <select
              className={field}
              value={estimated}
              onChange={e => setEstimated(e.target.value)}
            >
              <option value="">미정</option>
              {TIMEBANK_MINUTE_OPTIONS.map(m => (
                <option key={m} value={m}>
                  {fmtMinutes(m)}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm font-medium text-gray-700">
            업무 날짜(선택)
            <input
              type="date"
              className={field}
              value={taskDate}
              onChange={e => setTaskDate(e.target.value)}
            />
          </label>
          <label className="text-sm font-medium text-gray-700 md:col-span-2">
            설명
            <textarea
              className={field}
              rows={4}
              value={description}
              onChange={e => setDescription(e.target.value)}
              required
            />
          </label>
          <div className="md:col-span-2 flex justify-end">
            <button
              type="submit"
              disabled={!open || creating || !title.trim() || !description.trim()}
              className="rounded bg-primary-600 px-4 py-2 text-sm text-white hover:bg-primary-700 disabled:opacity-50"
            >
              {creating ? '올리는 중…' : '글 올리기'}
            </button>
          </div>
        </form>
      </section>

      <section aria-labelledby="adm-task-list">
        <h2 id="adm-task-list" className="mb-2 text-lg font-semibold text-gray-900">
          조합 업무 글과 크레딧 지급
        </h2>
        {listError && (
          <p role="alert" className="text-sm text-red-700">
            {listError}
          </p>
        )}
        {tasks && tasks.length === 0 && <p className="text-sm text-gray-500">글이 없습니다.</p>}
        {tasks && tasks.length > 0 && (
          <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
            {tasks.map(task => (
              <li key={task.id} className="flex flex-wrap items-center gap-3 p-3 text-sm">
                <span className="min-w-0 flex-1">
                  <Link
                    href={`/board/timebank/${task.id}`}
                    className="font-medium text-gray-900 hover:underline"
                  >
                    {task.title}
                  </Link>
                  <span className="ml-2 text-xs text-gray-500">
                    {task.status === 'open' ? '진행 중' : '마감'} · 자원 {task.volunteer_count}명
                    {task.task_date ? ` · ${task.task_date}` : ''}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setSelected(task.id)
                    setMember('')
                    void loadVolunteers(task.id)
                  }}
                  className={`rounded border px-3 py-1 text-sm ${selected === task.id ? 'border-primary-600 text-primary-700' : 'border-gray-300 text-gray-700 hover:bg-gray-50'}`}
                >
                  자원자·지급
                </button>
              </li>
            ))}
          </ul>
        )}

        {selectedTask && (
          <div
            className="mt-4 rounded-lg border border-gray-200 bg-white p-4"
            data-testid="admin-timebank-credit"
          >
            <h3 className="mb-2 font-semibold text-gray-900">{selectedTask.title} — 지급</h3>
            {volunteers === null ? (
              <p className="text-sm text-gray-500">자원자를 불러오는 중…</p>
            ) : volunteers.length === 0 ? (
              <p className="text-sm text-gray-500">철회하지 않은 자원자가 없습니다.</p>
            ) : (
              <form onSubmit={e => void credit(e)} className="space-y-3">
                <fieldset>
                  <legend className="text-sm font-medium text-gray-700">
                    자원자(스스로 참여 의사를 밝힌 사람만)
                  </legend>
                  <ul className="mt-1 space-y-1 text-sm">
                    {volunteers.map(v => (
                      <li key={v.member_id}>
                        <label className="flex items-center gap-2">
                          <input
                            type="radio"
                            name="credit-member"
                            value={v.member_id}
                            checked={member === v.member_id}
                            disabled={v.member_id === myId}
                            onChange={() => setMember(v.member_id)}
                          />
                          {v.display_name}
                          <span className="text-xs text-gray-500">
                            자원 {fmtKst(v.volunteered_at)}
                            {v.member_id === myId ? ' · 본인에게는 지급할 수 없습니다' : ''}
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                </fieldset>
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="text-sm font-medium text-gray-700">
                    시간
                    <select
                      className={field}
                      value={minutes}
                      onChange={e => setMinutes(Number(e.target.value))}
                    >
                      {TIMEBANK_MINUTE_OPTIONS.map(m => (
                        <option key={m} value={m}>
                          {fmtMinutes(m)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-sm font-medium text-gray-700">
                    사유(필수)
                    <input
                      className={field}
                      value={memo}
                      onChange={e => setMemo(e.target.value)}
                      maxLength={TIMEBANK_MEMO_MAX}
                      placeholder="예: 11/20 정기공연 무대 설치"
                    />
                  </label>
                </div>
                <label className="flex items-start gap-2 text-sm text-gray-800">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={notPaid}
                    onChange={e => setNotPaid(e.target.checked)}
                  />
                  <span>
                    이 일에 사례비·인건비를 지급하지 않았습니다.{' '}
                    <span className="text-xs text-gray-500">
                      (돈을 받기로 한 일은 크레딧으로 대신하지 않습니다)
                    </span>
                  </span>
                </label>
                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={!open || crediting || !member || !notPaid || !memo.trim()}
                    className="rounded bg-primary-600 px-4 py-2 text-sm text-white hover:bg-primary-700 disabled:opacity-50"
                  >
                    {crediting ? '지급하는 중…' : '크레딧 지급'}
                  </button>
                </div>
              </form>
            )}
          </div>
        )}
      </section>
    </div>
  )
}
