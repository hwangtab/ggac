'use client'

import { Field, FieldLabel } from '@work/components/ui/field'
import { useMemo, useState } from 'react'
import { PlusIcon, Trash2Icon } from 'lucide-work'
import { Button } from '@work/components/ui/button'
import { Input } from '@work/components/ui/input'
import { NoticeBanner } from '@work/components/layout/page'
import { Textarea } from '@work/components/ui/textarea'
import { cn } from '@work/lib/utils'
import {
  countMatches,
  isBlockChanged,
  newKey,
  replaceAllIn,
  summarizeChanges,
  type EditorBlock,
  isEndMarkBlock,
} from './doc-edit-ui'

const KIND_LABEL = { heading: '제목', paragraph: '문단', list: '목록' } as const

/** 문구 고치기 입력 — 블록 목록 + 찾기·바꾸기 (docs/10 §2-3) */
export default function TextEditPane({
  blocks,
  originalCount,
  canRestructure,
  onChange,
  disabled = false,
}: {
  blocks: EditorBlock[]
  /** 원본 블록 수(지운 개수 계산) */
  originalCount: number
  /** HWPX 만 문단 추가·삭제 */
  canRestructure: boolean
  onChange: (next: EditorBlock[]) => void
  disabled?: boolean
}) {
  const [onlyChanged, setOnlyChanged] = useState(false)
  const [find, setFind] = useState('')
  const [replacement, setReplacement] = useState('')
  const [replaced, setReplaced] = useState<number | null>(null)

  const matches = useMemo(() => countMatches(blocks, find), [blocks, find])
  const summary = useMemo(() => summarizeChanges(blocks, originalCount), [blocks, originalCount])

  function setText(key: string, text: string) {
    onChange(
      blocks.map(b =>
        b.key === key && b.kind !== 'readonly' && b.kind !== 'table' ? { ...b, text } : b
      )
    )
  }
  function setCell(key: string, r: number, c: number, text: string) {
    onChange(
      blocks.map(b =>
        b.key === key && b.kind === 'table'
          ? {
              ...b,
              cells: b.cells.map((row, ri) =>
                row.map((cell, ci) => (ri === r && ci === c ? { ...cell, text } : cell))
              ),
            }
          : b
      )
    )
  }
  function addAfter(key: string) {
    const i = blocks.findIndex(b => b.key === key)
    if (i < 0) return
    const fresh: EditorBlock = {
      key: newKey(),
      src: null,
      kind: 'paragraph',
      text: '',
      original: null,
    }
    onChange([...blocks.slice(0, i + 1), fresh, ...blocks.slice(i + 1)])
  }
  function remove(key: string) {
    onChange(blocks.filter(b => b.key !== key))
  }
  function doReplace() {
    const res = replaceAllIn(blocks, find, replacement)
    setReplaced(res.count)
    if (res.count > 0) onChange(res.blocks)
  }

  const visible = onlyChanged ? blocks.filter(b => isBlockChanged(b)) : blocks

  return (
    <div className="grid gap-4">
      {!canRestructure && (
        <NoticeBanner>문단 추가·삭제는 안 됩니다 — 글자만 고칠 수 있어요.</NoticeBanner>
      )}

      <fieldset className="grid gap-2 rounded-w-lg border p-3">
        <legend className="px-1 text-sm font-medium">찾아 바꾸기</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="doc-edit-find">찾을 글자</FieldLabel>
            <Input
              id="doc-edit-find"
              value={find}
              disabled={disabled}
              onChange={e => {
                setFind(e.target.value)
                setReplaced(null)
              }}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="doc-edit-replace">바꿀 글자</FieldLabel>
            <Input
              id="doc-edit-replace"
              value={replacement}
              disabled={disabled}
              onChange={e => {
                setReplacement(e.target.value)
                setReplaced(null)
              }}
            />
          </Field>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={disabled || !find || matches === 0}
            onClick={doReplace}
          >
            모두 바꾸기
          </Button>
          <span role="status" aria-live="polite" className="text-xs text-muted-foreground">
            {replaced !== null
              ? `${replaced}군데를 바꿨습니다.`
              : find
                ? `${matches}군데에서 찾았습니다.`
                : ''}
          </span>
        </div>
      </fieldset>

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span role="status" aria-live="polite" className="text-muted-foreground">
          고친 곳 {summary.edited}
          {canRestructure && ` · 추가 ${summary.added} · 삭제 ${summary.removed}`}
        </span>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={onlyChanged}
            onChange={e => setOnlyChanged(e.target.checked)}
          />
          고친 것만 보기
        </label>
      </div>

      <ol className="grid gap-3" aria-label="문서 내용">
        {visible.length === 0 && (
          <li className="text-sm text-muted-foreground">고친 곳이 없습니다.</li>
        )}
        {visible.map(b => {
          const changed = isBlockChanged(b)
          const tone = changed ? 'border-primary bg-subtle' : 'border-border'
          if (b.kind === 'readonly') {
            return (
              <li
                key={b.key}
                className="rounded-w-lg border border-dashed p-2 text-xs text-muted-foreground"
              >
                [{b.label}] — 앱에서는 고칠 수 없습니다
              </li>
            )
          }
          if (b.kind === 'table') {
            return (
              <li key={b.key} className={cn('grid gap-1 rounded-w-lg border p-2', tone)}>
                <span className="text-xs text-muted-foreground">표</span>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-sm">
                    <tbody>
                      {b.cells.map((row, ri) => (
                        <tr key={ri}>
                          {row.map((cell, ci) => {
                            const cellChanged = cell.editable && cell.text !== b.originals[ri][ci]
                            return (
                              <td
                                key={ci}
                                className="min-w-24 border p-0.5 align-top"
                                colSpan={cell.colSpan}
                                rowSpan={cell.rowSpan}
                              >
                                {cell.editable ? (
                                  <Textarea
                                    aria-label={`표 ${ri + 1}행 ${ci + 1}열`}
                                    className={cn(
                                      'min-h-8 resize-y',
                                      cellChanged && 'border-primary bg-subtle'
                                    )}
                                    rows={1}
                                    value={cell.text}
                                    disabled={disabled}
                                    onChange={e => setCell(b.key, ri, ci, e.target.value)}
                                  />
                                ) : (
                                  <span
                                    className="block p-1 text-muted-foreground"
                                    data-tooltip="고칠 수 없는 칸"
                                  >
                                    {cell.text}
                                  </span>
                                )}
                              </td>
                            )
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </li>
            )
          }
          return (
            <li key={b.key} className={cn('grid gap-1 rounded-w-lg border p-2', tone)}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground">
                  {b.src === null ? '새 문단' : KIND_LABEL[b.kind]}
                </span>
                {canRestructure && isEndMarkBlock(b) && (
                  <span className="text-xs text-muted-foreground">
                    공문 끝 표시 — 문단은 이 위에서 추가하세요
                  </span>
                )}
                {canRestructure && !isEndMarkBlock(b) && (
                  <span className="flex gap-1">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={disabled}
                      onClick={() => addAfter(b.key)}
                    >
                      <PlusIcon aria-hidden="true" />
                      문단 추가
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={disabled}
                      aria-label={`${KIND_LABEL[b.kind]} 삭제`}
                      onClick={() => remove(b.key)}
                    >
                      <Trash2Icon aria-hidden="true" />
                      삭제
                    </Button>
                  </span>
                )}
              </div>
              <Textarea
                aria-label={`${KIND_LABEL[b.kind]} 내용`}
                className={cn(
                  'min-h-9 resize-y',
                  b.kind === 'heading' && 'font-medium',
                  changed && 'border-primary'
                )}
                rows={Math.min(8, Math.max(1, Math.ceil(b.text.length / 50)))}
                value={b.text}
                disabled={disabled}
                onChange={e => setText(b.key, e.target.value)}
              />
            </li>
          )
        })}
      </ol>
    </div>
  )
}
