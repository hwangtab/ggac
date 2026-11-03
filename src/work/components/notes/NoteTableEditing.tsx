'use client'

import { Field, FieldGroup, FieldLabel } from '@work/components/ui/field'
import { useId, useMemo, useState, type FormEvent } from 'react'
import type { Components } from 'react-markdown'
import { PencilIcon, PlusIcon, Trash2Icon } from 'lucide-work'
import MessageMarkdown from '@work/components/markdown/MessageMarkdown'
import { Button } from '@work/components/ui/button'
import ConfirmDialog from '@work/components/ui/confirm-dialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@work/components/ui/dialog'
import { Input } from '@work/components/ui/input'
import {
  appendRow,
  cellToPlain,
  deleteRow,
  findRowAt,
  findTableAt,
  parseTables,
  replaceRow,
} from '@work/lib/notes/tables'

export type TableSaveResult =
  | { status: 'saved' }
  | { status: 'conflict' }
  | { status: 'error'; message: string }

type Target =
  | { kind: 'add'; headerLine: number }
  | { kind: 'edit'; rowLine: number }
  | { kind: 'delete'; rowLine: number }

const STALE_MESSAGE = '표가 바뀌어 이 행을 찾지 못했습니다. 화면을 새로 고친 뒤 다시 시도해 주세요.'

function headerLabel(raw: string, index: number): string {
  const t = cellToPlain(raw)
  return t === '' ? `${index + 1}번째 열` : t
}

/**
 * 메모 보기 화면의 마크다운 + 표 행 편집(항목 추가·수정·삭제).
 * 렌더된 표/행을 원문 줄 번호(react-markdown position)로 `tables.ts` 에 잇는다.
 * 저장은 호출 쪽(`onSave`)이 기존 saveNote(낙관적 잠금)로 한다.
 */
export default function EditableNoteMarkdown({
  body,
  className,
  onSave,
}: {
  body: string
  className?: string
  onSave: (nextBody: string) => Promise<TableSaveResult>
}) {
  const [target, setTarget] = useState<Target | null>(null)

  const components = useMemo<Components>(() => {
    const tables = parseTables(body)
    const headerLines = new Set(tables.map(t => t.headerLine))
    const rowTitles = new Map<number, string>()
    for (const t of tables) {
      for (const r of t.rows) rowTitles.set(r.line, cellToPlain(r.cells[0] ?? '').slice(0, 20))
    }
    return {
      table({ node, children }) {
        const line = node?.position?.start.line
        return (
          <>
            <div className="overflow-x-auto">
              <table>{children}</table>
            </div>
            {line !== undefined && headerLines.has(line) && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="mb-2 text-muted-foreground"
                onClick={() => setTarget({ kind: 'add', headerLine: line })}
              >
                <PlusIcon aria-hidden="true" />
                항목 추가
              </Button>
            )}
          </>
        )
      },
      tr({ node, children }) {
        const line = node?.position?.start.line
        if (line === undefined) return <tr>{children}</tr>
        if (headerLines.has(line)) {
          return (
            <tr>
              {children}
              <th className="w-0 p-0">
                <span className="sr-only">행 작업</span>
              </th>
            </tr>
          )
        }
        const title = rowTitles.get(line)
        if (title === undefined) return <tr>{children}</tr>
        const name = title === '' ? '행' : title
        const actionClass =
          'opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100'
        return (
          <tr className="group/row">
            {children}
            <td className="w-0 p-0 whitespace-nowrap">
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className={actionClass}
                aria-label={`${name} 행 수정`}
                onClick={() => setTarget({ kind: 'edit', rowLine: line })}
              >
                <PencilIcon aria-hidden="true" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className={actionClass}
                aria-label={`${name} 행 삭제`}
                onClick={() => setTarget({ kind: 'delete', rowLine: line })}
              >
                <Trash2Icon aria-hidden="true" />
              </Button>
            </td>
          </tr>
        )
      },
    }
  }, [body])

  return (
    <>
      <MessageMarkdown content={body} className={className} components={components} />
      {target && target.kind !== 'delete' && (
        <RowFormDialog
          key={`${target.kind}:${target.kind === 'add' ? target.headerLine : target.rowLine}`}
          body={body}
          target={target}
          onClose={() => setTarget(null)}
          onSave={onSave}
        />
      )}
      {target?.kind === 'delete' && (
        <DeleteRowDialog
          body={body}
          rowLine={target.rowLine}
          onClose={() => setTarget(null)}
          onSave={onSave}
        />
      )}
    </>
  )
}

function RowFormDialog({
  body,
  target,
  onClose,
  onSave,
}: {
  body: string
  target: Extract<Target, { kind: 'add' | 'edit' }>
  onClose: () => void
  onSave: (nextBody: string) => Promise<TableSaveResult>
}) {
  const uid = useId()
  const found =
    target.kind === 'edit'
      ? findRowAt(body, target.rowLine)
      : (() => {
          const table = findTableAt(body, target.headerLine)
          return table ? { table, row: null } : null
        })()
  const table = found?.table ?? null
  const [values, setValues] = useState<string[]>(() =>
    table ? table.headers.map((_, i) => cellToPlain(found?.row?.cells[i] ?? '')) : []
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(table ? null : STALE_MESSAGE)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (saving || !table) return
    const next =
      target.kind === 'add'
        ? appendRow(body, table, values)
        : replaceRow(body, target.rowLine, values)
    if (next === null) {
      setError(STALE_MESSAGE)
      return
    }
    setSaving(true)
    setError(null)
    try {
      const res = await onSave(next)
      if (res.status === 'error') setError(res.message)
      else onClose()
    } catch {
      setError('네트워크 문제로 저장하지 못했습니다.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={open => !open && !saving && onClose()}>
      <DialogContent>
        <form onSubmit={e => void submit(e)} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{target.kind === 'add' ? '항목 추가' : '항목 수정'}</DialogTitle>
            <DialogDescription>
              글자 그대로 입력하세요. 줄바꿈은 띄어쓰기로 바뀝니다.
            </DialogDescription>
          </DialogHeader>
          {table && (
            <FieldGroup>
              {table.headers.map((h, i) => (
                <Field key={i}>
                  <FieldLabel htmlFor={`${uid}-${i}`}>{headerLabel(h, i)}</FieldLabel>
                  <Input
                    id={`${uid}-${i}`}
                    value={values[i] ?? ''}
                    disabled={saving}
                    autoComplete="off"
                    onChange={e =>
                      setValues(prev => prev.map((v, j) => (j === i ? e.target.value : v)))
                    }
                  />
                </Field>
              ))}
            </FieldGroup>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={saving} onClick={onClose}>
              취소
            </Button>
            <Button type="submit" disabled={saving || !table}>
              {saving ? '저장하는 중…' : '저장'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function DeleteRowDialog({
  body,
  rowLine,
  onClose,
  onSave,
}: {
  body: string
  rowLine: number
  onClose: () => void
  onSave: (nextBody: string) => Promise<TableSaveResult>
}) {
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function confirm() {
    if (saving) return
    const next = deleteRow(body, rowLine)
    if (next === null) {
      setError(STALE_MESSAGE)
      return
    }
    setSaving(true)
    setError(null)
    try {
      const res = await onSave(next)
      if (res.status === 'error') setError(res.message)
      else onClose()
    } catch {
      setError('네트워크 문제로 삭제하지 못했습니다.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <ConfirmDialog
      open
      title="이 항목을 삭제할까요?"
      description={
        <>
          표에서 이 행이 지워집니다. 이전 버전은 이력에서 되돌릴 수 있습니다.
          {error && (
            <span role="alert" className="mt-2 block text-destructive">
              {error}
            </span>
          )}
        </>
      }
      confirmLabel={saving ? '삭제하는 중…' : '삭제'}
      onCancel={() => !saving && onClose()}
      onConfirm={() => void confirm()}
    />
  )
}
