'use client'

import {
  Field,
  FieldLabel,
  FieldDescription,
  FieldSet,
  FieldLegend,
  FieldChoice,
} from '@work/components/ui/field'
import { useId, useState, type FormEvent } from 'react'
import { useRouter } from '@work/lib/nav/navigation'
import { Button } from '@work/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@work/components/ui/dialog'
import { Input } from '@work/components/ui/input'
import { addTab } from '@work/lib/tabs/actions'
import {
  APP_TAB_KINDS,
  TAB_KIND_DEFAULT_TITLE,
  TAB_KIND_LABEL,
  TAB_TITLE_MAX,
  type AppTabKind,
} from '@work/lib/tabs/schema'
import { suggestWebsiteTitle } from '@work/lib/tabs/website'

const KIND_HINT: Record<AppTabKind, string> = {
  file: '이 대화의 파일(엑셀·한글·워드·PDF·이미지)을 탭으로 고정합니다. 새 파일은 바로 올릴 수 있습니다.',
  // ggac 이식: 탭 안 표시(iframe)는 CSP frame-src가 허용 목록을 열기 전까지 쓰지 않는다 — website.ts
  website: '주소를 탭으로 고정합니다. 탭에서 “새 창에서 열기”로 엽니다.',
  tasks: '이 대화의 할 일을 모아 봅니다.',
  note: '대화 공용 메모입니다. 멤버 누구나 고칠 수 있고, 저장할 때마다 이력이 남습니다.',
}

/**
 * ggac 이식(2b): 파일 탭은 첨부·업로드(2a)가 들어온 뒤 켠다. 원본의 "이 대화의 파일에서 고르기/새로 올리기"
 * (TabFileUploader·use-tab-file-upload·listFileOptions)는 그때 원본에서 다시 옮긴다. 서버 쪽도 2a 전에는
 * 파일 탭을 늘 거절한다(`attachmentBelongsToChannel`).
 */
const ENABLED_KINDS: readonly AppTabKind[] = APP_TAB_KINDS.filter(k => k !== 'file')

/**
 * "＋ 탭 추가" 대화상자(docs/05 §3). 종류(웹사이트·할 일·메모 — ggac 이식: 위키 없음, 파일은 2a 뒤)와 종류별 설정,
 * "게시물에 알리기"(기본 켬). 성공하면 새 탭으로 이동한다.
 */
export default function AddTabDialog({
  open,
  onOpenChange,
  channelId,
  hasGuests: _hasGuests,
  hasTasksTab,
  isGuest: _isGuest = false,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  channelId: string
  /** 게스트 멤버가 있는 대화 — 원본은 위키 탭 안내에 썼다(ggac 이식: 위키 없음, 모양만 유지) */
  hasGuests: boolean
  /** 이미 할 일 탭이 있으면 선택할 수 없다(대화당 1개) */
  hasTasksTab: boolean
  isGuest?: boolean
}) {
  const router = useRouter()
  const uid = useId()
  const kinds = ENABLED_KINDS
  // 처음 선택은 웹사이트(가장 단순한 종류)
  const firstKind: AppTabKind = 'website'
  const [kind, setKind] = useState<AppTabKind>(firstKind)
  const [title, setTitle] = useState('')
  const [titleEdited, setTitleEdited] = useState(false)
  const [url, setUrl] = useState('')
  // ggac 이식: 탭 안 표시를 켜 두고 저장한다(CSP가 허용 목록을 열면 바로 동작) — 화면 선택지는 숨겼다
  const embed = true
  const [announce, setAnnounce] = useState(true)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const effectiveTitle = titleEdited ? title : defaultTitle()
  function defaultTitle(): string {
    if (kind === 'website') return suggestWebsiteTitle(url) || TAB_KIND_DEFAULT_TITLE.website
    return TAB_KIND_DEFAULT_TITLE[kind]
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (pending) return
    setPending(true)
    setError(null)
    const config = kind === 'website' ? { url, embed } : ({} as Record<string, never>)
    try {
      const res = await addTab({
        channelId,
        kind: kind as Exclude<AppTabKind, 'file'>,
        title: effectiveTitle,
        config,
        announce,
      })
      if (!res.ok) {
        setError(res.error)
        return
      }
      closeDialog(false)
      router.push(res.data.href)
    } catch {
      setError('네트워크 문제로 추가하지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setPending(false)
    }
  }

  function closeDialog(next: boolean) {
    onOpenChange(next)
  }

  const canSubmit =
    !pending &&
    effectiveTitle.trim().length > 0 &&
    (kind === 'website' ? url.trim().length > 0 : true)

  return (
    <Dialog open={open} onOpenChange={closeDialog}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>탭 추가</DialogTitle>
          <DialogDescription>{KIND_HINT[kind]}</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid gap-4">
          <FieldSet>
            <FieldLegend>탭 종류</FieldLegend>
            <div className="flex flex-wrap gap-2">
              {kinds.map(k => {
                const disabled = k === 'tasks' && hasTasksTab
                return (
                  <label
                    key={k}
                    className={`flex cursor-pointer items-center gap-1.5 rounded-w-lg border px-3 py-1.5 text-sm has-[:checked]:border-primary has-[:checked]:bg-muted has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
                  >
                    <input
                      type="radio"
                      name={`${uid}-kind`}
                      value={k}
                      checked={kind === k}
                      disabled={disabled}
                      onChange={() => {
                        setKind(k)
                        setError(null)
                      }}
                      className="sr-only"
                    />
                    {TAB_KIND_LABEL[k]}
                    {disabled && <span className="text-xs text-muted-foreground">(이미 있음)</span>}
                  </label>
                )
              })}
            </div>
          </FieldSet>

          {kind === 'website' && (
            <>
              <Field>
                <FieldLabel htmlFor={`${uid}-url`}>주소</FieldLabel>
                <Input
                  id={`${uid}-url`}
                  type="url"
                  inputMode="url"
                  placeholder="https://"
                  value={url}
                  maxLength={2000}
                  required
                  onChange={e => setUrl(e.target.value)}
                />
                <FieldDescription>
                  https:// 주소만 쓸 수 있습니다. 같이 고쳐야 하는 표는 구글 시트 주소를 붙이세요.
                </FieldDescription>
              </Field>
            </>
          )}

          <Field>
            <FieldLabel htmlFor={`${uid}-title`}>탭 이름</FieldLabel>
            <Input
              id={`${uid}-title`}
              value={effectiveTitle}
              maxLength={TAB_TITLE_MAX}
              required
              onChange={e => {
                setTitle(e.target.value)
                setTitleEdited(true)
              }}
            />
          </Field>

          <FieldChoice>
            <input
              type="checkbox"
              checked={announce}
              onChange={e => setAnnounce(e.target.checked)}
            />
            게시물에 알리기
          </FieldChoice>

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => closeDialog(false)}>
              취소
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {pending ? '추가하는 중…' : '추가'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
