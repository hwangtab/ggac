'use client'

import {
  Field,
  FieldLabel,
  FieldDescription,
  FieldSet,
  FieldLegend,
  FieldChoice,
} from '@work/components/ui/field'
import { useEffect, useId, useState, type FormEvent } from 'react'
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
import { addTab, listFileOptions } from '@work/lib/tabs/actions'
import { formatBytes } from '@work/lib/files/mime'
import type { FileOption } from '@work/lib/tabs/queries'
import TabFileUploader from './TabFileUploader'
import { useTabFileUpload } from './use-tab-file-upload'
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

/** ggac 이식: 위키·연혁 탭 종류는 가져오지 않았다(APP_TAB_KINDS 에 없다). 파일 탭은 3단계(버전)와 함께 켰다 */
const ENABLED_KINDS: readonly AppTabKind[] = APP_TAB_KINDS

/**
 * "＋ 탭 추가" 대화상자(docs/05 §3). 종류(파일·웹사이트·할 일·메모 — ggac 이식: 위키 없음)와 종류별 설정,
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
  const [fileMode, setFileMode] = useState<'pick' | 'upload'>('pick')
  const [fileFilter, setFileFilter] = useState('')
  const [fileOptions, setFileOptions] = useState<FileOption[] | null>(null)
  const [fileId, setFileId] = useState('')
  const tabUpload = useTabFileUpload(channelId)
  const [announce, setAnnounce] = useState(true)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 파일 종류: 이 대화의 파일 목록(이름 검색은 입력이 멈춘 뒤 서버에서)
  useEffect(() => {
    if (!open || kind !== 'file' || fileMode !== 'pick') return
    let cancelled = false
    const timer = setTimeout(
      () => {
        void listFileOptions({ channelId, q: fileFilter })
          .then(res => {
            if (cancelled) return
            if (res.ok) {
              setFileOptions(res.data)
              setError(null)
            } else setError(res.error)
          })
          .catch(() => {
            if (!cancelled) setError('파일 목록을 불러오지 못했습니다.')
          })
      },
      fileOptions ? 250 : 0
    )
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
    // fileOptions 는 첫 로드 지연 판단에만 쓴다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, kind, fileMode, channelId, fileFilter])

  const effectiveTitle = titleEdited ? title : defaultTitle()
  function defaultTitle(): string {
    if (kind === 'file') {
      const name =
        fileMode === 'upload'
          ? tabUpload.uploads.items[0]?.name
          : fileOptions?.find(f => f.id === fileId)?.name
      return (name ?? TAB_KIND_DEFAULT_TITLE.file).slice(0, TAB_TITLE_MAX)
    }
    if (kind === 'website') return suggestWebsiteTitle(url) || TAB_KIND_DEFAULT_TITLE.website
    return TAB_KIND_DEFAULT_TITLE[kind]
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (pending) return
    setPending(true)
    setError(null)
    let attachmentId = fileId
    if (kind === 'file' && fileMode === 'upload') {
      try {
        const up = await tabUpload.commit('tab')
        if (!up.ok) {
          setError(up.error)
          setPending(false)
          return
        }
        attachmentId = up.attachmentId
      } catch {
        setError('네트워크 문제로 파일을 올리지 못했습니다. 잠시 후 다시 시도해 주세요.')
        setPending(false)
        return
      }
    }
    const config =
      kind === 'file'
        ? { attachmentId }
        : kind === 'website'
          ? { url, embed }
          : ({} as Record<string, never>)
    try {
      const res = await addTab({
        channelId,
        kind,
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
    if (!next) tabUpload.uploads.clear()
    onOpenChange(next)
  }

  const canSubmit =
    !pending &&
    effectiveTitle.trim().length > 0 &&
    (kind === 'file'
      ? fileMode === 'upload'
        ? tabUpload.ready
        : fileId.length > 0
      : kind === 'website'
        ? url.trim().length > 0
        : true)

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
                    className={`flex cursor-pointer items-center gap-1.5 rounded-w-lg border px-3 py-1.5 text-sm has-[:checked]:border-primary has-[:checked]:bg-accent/60 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
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

          {kind === 'file' && (
            <div className="grid gap-2">
              <div role="group" aria-label="파일 가져오는 방법" className="flex gap-2">
                {(['pick', 'upload'] as const).map(m => (
                  <Button
                    key={m}
                    type="button"
                    size="sm"
                    variant={fileMode === m ? 'default' : 'outline'}
                    aria-pressed={fileMode === m}
                    onClick={() => {
                      setFileMode(m)
                      setError(null)
                    }}
                  >
                    {m === 'pick' ? '이 대화의 파일에서 고르기' : '새로 올리기'}
                  </Button>
                ))}
              </div>
              {fileMode === 'pick' ? (
                <Field>
                  <FieldLabel htmlFor={`${uid}-filef`}>파일 이름 검색</FieldLabel>
                  <Input
                    id={`${uid}-filef`}
                    type="search"
                    value={fileFilter}
                    placeholder="파일 이름으로 찾기"
                    onChange={e => setFileFilter(e.target.value)}
                  />
                  <fieldset className="max-h-48 overflow-y-auto rounded-w-lg border">
                    <legend className="sr-only">파일 선택</legend>
                    {fileOptions === null ? (
                      <p role="status" className="p-3 text-sm text-muted-foreground">
                        불러오는 중…
                      </p>
                    ) : fileOptions.length === 0 ? (
                      <p className="p-3 text-sm text-muted-foreground">
                        이 대화에 올라온 파일이 없습니다. “새로 올리기”를 이용하세요.
                      </p>
                    ) : (
                      <ul>
                        {fileOptions.map(f => (
                          <li key={f.id}>
                            <label className="flex cursor-pointer items-center gap-2 px-4 py-2 text-sm hover:bg-accent has-[:checked]:bg-accent/60">
                              <input
                                type="radio"
                                name={`${uid}-file`}
                                value={f.id}
                                checked={fileId === f.id}
                                onChange={() => setFileId(f.id)}
                                className="size-4 accent-[var(--primary)]"
                              />
                              <span className="min-w-0 flex-1 truncate">{f.name}</span>
                              <span className="shrink-0 text-xs text-muted-foreground">
                                {formatBytes(f.size)}
                              </span>
                            </label>
                          </li>
                        ))}
                      </ul>
                    )}
                  </fieldset>
                </Field>
              ) : (
                <TabFileUploader uploads={tabUpload.uploads} disabled={pending} />
              )}
              <p role="note" className="text-xs text-muted-foreground">
                같이 고쳐야 하는 표는 파일 대신 “웹사이트” 탭에 구글 시트 주소를 붙이세요. 파일 탭은
                읽기용이며, 고친 파일은 탭 메뉴의 “새 버전 올리기”로 바꿉니다.
              </p>
            </div>
          )}

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
