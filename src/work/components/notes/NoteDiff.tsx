import { useDeferredValue, useMemo } from 'react'
import { diffLines, hasChanges } from '@work/lib/notes/diff'
import { cn } from '@work/lib/utils'

/**
 * 두 본문의 줄 단위 차이. 색만으로 구분하지 않도록 줄 머리에 +/− 기호와 스크린리더용 문구를 둔다.
 * from → to: 지워진 줄(−), 새 줄(+).
 */
export default function NoteDiff({
  from,
  to,
  fromLabel,
  toLabel,
}: {
  from: string
  to: string
  fromLabel: string
  toLabel: string
}) {
  // 충돌 화면은 입력 중인 초안(to)이 키 입력마다 바뀐다 — 차이 계산(LCS)은 입력을 막지 않게 미루고 같은 입력이면 재사용한다
  const deferredFrom = useDeferredValue(from)
  const deferredTo = useDeferredValue(to)
  const ops = useMemo(() => diffLines(deferredFrom, deferredTo), [deferredFrom, deferredTo])
  if (!hasChanges(ops)) {
    return <p className="p-3 text-sm text-muted-foreground">두 내용이 같습니다.</p>
  }
  return (
    // 스크롤되는 영역이라 키보드로 초점을 받아 스크롤할 수 있어야 한다(원본 그대로)
    // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
    <div role="region" aria-label={`차이: ${fromLabel} → ${toLabel}`} tabIndex={0}>
      <p className="mb-1 text-xs text-muted-foreground">
        <span aria-hidden="true">− </span>
        {fromLabel} · <span aria-hidden="true">+ </span>
        {toLabel}
      </p>
      <pre className="max-h-80 overflow-auto rounded-w-lg border bg-muted/50 px-4 py-3 font-mono text-xs leading-6">
        {ops.map((op, i) => (
          <div
            key={i}
            className={cn(
              'whitespace-pre-wrap break-words',
              op.type === 'add' && 'bg-online/15',
              op.type === 'del' && 'bg-destructive/10 line-through decoration-destructive/50'
            )}
          >
            <span aria-hidden="true" className="mr-2 select-none text-muted-foreground">
              {op.type === 'add' ? '+' : op.type === 'del' ? '−' : ' '}
            </span>
            {op.type !== 'same' && (
              <span className="sr-only">{op.type === 'add' ? '추가: ' : '삭제: '}</span>
            )}
            {op.text || ' '}
          </div>
        ))}
      </pre>
    </div>
  )
}
