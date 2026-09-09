'use client'

import { useMemo, useState } from 'react'
import { Link } from '@/i18n/navigation'
import { ASSEMBLY_DOC_TYPES, type AssemblyDocType } from '@/constants/boardRoom'
import { isSafeInternalPath } from '@/utils/safeUrl'

interface BoardDocument {
  id: string
  title: string
  category: string
  file_name: string
  file_size: number | null
  mime_type: string | null
  uploaded_by: string
  created_at: string
  download_url: string | null
  has_body: boolean
  visibility: string
}

interface Props {
  documents: BoardDocument[]
  currentUserId: string
  isAdmin: boolean
  onChanged: () => void
}

/** 제목에서 자료 종류를 되짚는다. 앞쪽에 있는 키워드를 우선한다. */
export function inferDocType(title: string): AssemblyDocType {
  const keywords: Array<[AssemblyDocType, RegExp]> = [
    ['자료집', /자료집|안건집|총회\s*자료/],
    ['회의록', /회의록|의사록/],
    ['감사보고서', /감사/],
    ['결산서', /결산|재무제표|손익/],
    ['사업보고서', /사업\s*(보고|계획)/],
    ['거래내역서', /거래\s*내역|통장|입출금/],
  ]
  let best: { type: AssemblyDocType; idx: number } | null = null
  for (const [type, re] of keywords) {
    const m = title.match(re)
    if (m && m.index != null && (best == null || m.index < best.idx)) {
      best = { type, idx: m.index }
    }
  }
  return best?.type ?? '기타'
}

/** 제목의 연도(2000~2099)를 뽑고, 없으면 업로드 연도로 폴백한다. */
export function inferYear(title: string, createdAt: string): number {
  const m = title.match(/(20\d{2})\s*년?/)
  if (m) return Number(m[1])
  const d = new Date(createdAt)
  return isNaN(d.getTime()) ? new Date().getFullYear() : d.getFullYear()
}

/** 제목에 "제N차"가 있으면 차수를 뽑는다. 없으면 null. */
function inferOrdinal(titles: string[]): number | null {
  for (const t of titles) {
    const m = t.match(/제\s*(\d+)\s*차/)
    if (m) return Number(m[1])
  }
  return null
}

function formatFileSize(bytes: number | null): string {
  if (bytes == null || isNaN(bytes) || bytes < 0) return ''
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb.toFixed(0)} KB`
  return `${(kb / 1024).toFixed(1)} MB`
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return `${d.getMonth() + 1}.${d.getDate()}`
}

function fileExt(name: string, mime: string | null): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  if (ext && ext.length <= 5 && ext !== name.toLowerCase()) return ext
  if (mime?.includes('pdf')) return 'pdf'
  return 'file'
}

const EXT_STYLE: Record<string, string> = {
  pdf: 'bg-red-50 text-red-700 border-red-200',
  hwp: 'bg-sky-50 text-sky-700 border-sky-200',
  hwpx: 'bg-sky-50 text-sky-700 border-sky-200',
  doc: 'bg-blue-50 text-blue-700 border-blue-200',
  docx: 'bg-blue-50 text-blue-700 border-blue-200',
  xls: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  xlsx: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  ppt: 'bg-orange-50 text-orange-700 border-orange-200',
  pptx: 'bg-orange-50 text-orange-700 border-orange-200',
  zip: 'bg-gray-100 text-gray-700 border-gray-300',
}

const TYPE_STYLE: Record<AssemblyDocType, string> = {
  자료집: 'bg-indigo-50 text-indigo-700',
  회의록: 'bg-violet-50 text-violet-700',
  감사보고서: 'bg-amber-50 text-amber-800',
  결산서: 'bg-emerald-50 text-emerald-700',
  사업보고서: 'bg-teal-50 text-teal-700',
  거래내역서: 'bg-lime-50 text-lime-800',
  기타: 'bg-gray-100 text-gray-600',
}

export default function AssemblyDocumentList({
  documents,
  currentUserId,
  isAdmin,
  onChanged,
}: Props) {
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState<Record<number, boolean>>({})

  const groups = useMemo(() => {
    const byYear = new Map<number, BoardDocument[]>()
    for (const doc of documents) {
      const y = inferYear(doc.title, doc.created_at)
      const arr = byYear.get(y) ?? []
      arr.push(doc)
      byYear.set(y, arr)
    }
    const typeOrder = (d: BoardDocument) => ASSEMBLY_DOC_TYPES.indexOf(inferDocType(d.title))
    return [...byYear.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([year, docs]) => ({
        year,
        ordinal: inferOrdinal(docs.map(d => d.title)),
        docs: [...docs].sort(
          (a, b) => typeOrder(a) - typeOrder(b) || a.created_at.localeCompare(b.created_at)
        ),
      }))
  }, [documents])

  const handleDelete = async (id: string) => {
    if (!confirm('이 자료를 삭제하시겠습니까?')) return
    setDeletingId(id)
    try {
      const res = await fetch(`/api/board-room/documents/${id}`, { method: 'DELETE' })
      const json = await res.json()
      if (json.success) onChanged()
    } catch {
      // 사용자가 다시 시도할 수 있다
    } finally {
      setDeletingId(null)
    }
  }

  if (documents.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-gray-300 bg-white py-12 text-center">
        <p className="text-sm text-gray-500">아직 등록된 총회 자료가 없습니다.</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {groups.map((g, gi) => {
        // 최신 연도만 펼치고, 지난 연도는 접어 둔다.
        const isCollapsed = collapsed[g.year] ?? gi !== 0
        const headingId = `assembly-${g.year}`
        return (
          <section key={g.year} aria-labelledby={headingId}>
            <button
              type="button"
              onClick={() => setCollapsed(c => ({ ...c, [g.year]: !isCollapsed }))}
              aria-expanded={!isCollapsed}
              className="flex w-full items-center justify-between rounded-xl bg-white px-4 py-3 text-left shadow-sm ring-1 ring-gray-200 hover:bg-gray-50"
            >
              <div className="flex items-baseline gap-3">
                <h2 id={headingId} className="text-lg font-bold text-gray-900">
                  {g.year}년 정기총회
                </h2>
                <span className="text-sm text-gray-500">
                  {g.ordinal != null && `제${g.ordinal}차 · `}자료 {g.docs.length}건
                </span>
              </div>
              <svg
                aria-hidden="true"
                className={`h-5 w-5 text-gray-400 transition-transform ${isCollapsed ? '' : 'rotate-180'}`}
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path
                  fillRule="evenodd"
                  d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
                  clipRule="evenodd"
                />
              </svg>
            </button>

            {!isCollapsed && (
              <ul className="mt-2 divide-y divide-gray-100 overflow-hidden rounded-xl bg-white ring-1 ring-gray-200">
                {g.docs.map(doc => {
                  const type = inferDocType(doc.title)
                  const ext = fileExt(doc.file_name, doc.mime_type)
                  const canDelete = doc.uploaded_by === currentUserId || isAdmin
                  const href =
                    doc.download_url && isSafeInternalPath(doc.download_url)
                      ? doc.download_url
                      : null
                  const body = (
                    <>
                      <span
                        className={`hidden w-12 shrink-0 rounded-md border px-1 py-1 text-center text-[11px] font-bold uppercase sm:inline-block ${EXT_STYLE[ext] ?? 'bg-gray-50 text-gray-600 border-gray-200'}`}
                      >
                        {ext}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs font-medium ${TYPE_STYLE[type]}`}
                          >
                            {type}
                          </span>
                          <span className="truncate text-sm font-semibold text-gray-900">
                            {doc.title}
                          </span>
                        </div>
                        <p className="mt-0.5 truncate text-xs text-gray-400">{doc.file_name}</p>
                      </div>
                      <div className="hidden shrink-0 text-right text-xs text-gray-400 sm:block">
                        <div>{formatFileSize(doc.file_size)}</div>
                        <div>{formatDate(doc.created_at)}</div>
                      </div>
                    </>
                  )
                  return (
                    <li key={doc.id} className="flex items-center gap-3 px-4 py-3">
                      {doc.has_body ? (
                        <Link
                          href={`/board-room/assembly/${doc.id}`}
                          className="flex min-w-0 flex-1 items-center gap-3 rounded-lg hover:text-primary-700"
                          title="웹에서 읽기"
                        >
                          {body}
                        </Link>
                      ) : href ? (
                        <a
                          href={href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex min-w-0 flex-1 items-center gap-3 rounded-lg hover:text-primary-700"
                          title="내려받기"
                        >
                          {body}
                        </a>
                      ) : (
                        <div className="flex min-w-0 flex-1 items-center gap-3 opacity-60">
                          {body}
                        </div>
                      )}
                      {canDelete && (
                        <button
                          type="button"
                          onClick={() => handleDelete(doc.id)}
                          disabled={deletingId === doc.id}
                          aria-label={`${doc.title} 삭제`}
                          className="shrink-0 rounded-lg px-2 py-1 text-xs text-gray-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                        >
                          삭제
                        </button>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        )
      })}
    </div>
  )
}
