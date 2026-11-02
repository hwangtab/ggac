'use client'

import { Field, FieldLabel } from '@work/components/ui/field'
import { useId, useState, type FormEvent } from 'react'
import Link from '@work/lib/nav/link'
import { useRouter } from '@work/lib/nav/navigation'
import { MoreHorizontalIcon } from 'lucide-work'
import { Button } from '@work/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@work/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@work/components/ui/dropdown-menu'
import { Input } from '@work/components/ui/input'
import { moveTab, removeTab, renameTab } from '@work/lib/tabs/actions'
import { TAB_TITLE_MAX, type AppTabKind } from '@work/lib/tabs/schema'
import { localeOfPathname, toWorkHref } from '@work/lib/nav/paths'
import UploadVersionDialog from './UploadVersionDialog'

/**
 * 추가한 탭 옆 ⋯ 메뉴(docs/05 §3): 이름 바꾸기 · 새 창에서 열기 · 링크 복사 · 제거.
 * 이름 바꾸기·제거는 권한이 없으면(canManage=false) 숨긴다. 실제 차단은 DB(RLS)가 한다.
 * 제거한 탭이 지금 보고 있는 탭이면 대화 첫 화면(baseHref)으로 돌아간다.
 */
export default function TabMenu({
  tabId,
  title,
  href,
  baseHref,
  active,
  canManage,
  kind,
  channelId,
  fileAttachmentId,
  canUploadVersion = false,
  canMoveLeft = false,
  canMoveRight = false,
}: {
  tabId: string
  title: string
  href: string
  /** 제거 뒤 돌아갈 대화 기본 경로 */
  baseHref: string
  active: boolean
  canManage: boolean
  /** 탭 종류 — 파일 탭만 새 버전 올리기가 있다 */
  kind?: AppTabKind
  channelId?: string
  /** 파일 탭이 가리키는 첨부(새 버전 올리기의 계보 기준) */
  fileAttachmentId?: string
  /** 새 버전 올리기 노출 — 파일 편집 권한(채널 멤버인 내부 staff). 탭 관리 권한과 별개다(docs/09 §3-3) */
  canUploadVersion?: boolean
  /** 추가 탭들 사이에서 한 칸 옮길 수 있나(맨 앞·맨 뒤면 false) */
  canMoveLeft?: boolean
  canMoveRight?: boolean
}) {
  const router = useRouter()
  const uid = useId()
  const [versionOpen, setVersionOpen] = useState(false)
  const [renameOpen, setRenameOpen] = useState(false)
  const [removeOpen, setRemoveOpen] = useState(false)
  const [name, setName] = useState(title)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)

  async function copyLink() {
    // ggac 이식: 원본 주소(`/c/…`)를 업무툴 주소(`/board-room/c/…`)로 바꿔 복사한다(Link는 nav 래퍼가 바꿔 준다)
    const workHref = toWorkHref(href, localeOfPathname(window.location.pathname))
    const absolute = new URL(workHref, window.location.origin).toString()
    try {
      await navigator.clipboard.writeText(absolute)
      setStatus('링크를 복사했습니다.')
    } catch {
      setStatus('링크를 복사하지 못했습니다.')
    }
    setTimeout(() => setStatus(null), 2500)
  }

  async function onMove(direction: 'left' | 'right') {
    if (pending) return
    setPending(true)
    try {
      const res = await moveTab({ tabId, direction })
      setStatus(
        res.ok
          ? `‘${title}’ 탭을 ${direction === 'left' ? '왼쪽' : '오른쪽'}으로 옮겼습니다.`
          : res.error
      )
      if (res.ok) router.refresh()
    } catch {
      setStatus('네트워크 문제로 옮기지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setPending(false)
      setTimeout(() => setStatus(null), 4000)
    }
  }

  async function onRename(e: FormEvent) {
    e.preventDefault()
    if (pending) return
    setPending(true)
    setError(null)
    try {
      const res = await renameTab({ tabId, title: name })
      if (!res.ok) {
        setError(res.error)
        return
      }
      setRenameOpen(false)
      router.refresh()
    } catch {
      setError('네트워크 문제로 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setPending(false)
    }
  }

  async function onRemove() {
    if (pending) return
    setPending(true)
    setError(null)
    try {
      const res = await removeTab({ tabId })
      if (!res.ok) {
        setError(res.error)
        return
      }
      setRemoveOpen(false)
      if (active) router.push(baseHref)
      else router.refresh()
    } catch {
      setError('네트워크 문제로 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setPending(false)
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={`${title} 탭 메뉴`}
              className="text-muted-foreground"
            />
          }
        >
          <MoreHorizontalIcon aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-44">
          {canManage && (
            <DropdownMenuItem
              onClick={() => {
                setName(title)
                setError(null)
                setRenameOpen(true)
              }}
            >
              이름 바꾸기
            </DropdownMenuItem>
          )}
          {canManage && canMoveLeft && (
            <DropdownMenuItem onClick={() => void onMove('left')}>왼쪽으로 이동</DropdownMenuItem>
          )}
          {canManage && canMoveRight && (
            <DropdownMenuItem onClick={() => void onMove('right')}>
              오른쪽으로 이동
            </DropdownMenuItem>
          )}
          {canUploadVersion && kind === 'file' && channelId && fileAttachmentId && (
            <DropdownMenuItem onClick={() => setVersionOpen(true)}>새 버전 올리기</DropdownMenuItem>
          )}
          <DropdownMenuItem render={<Link href={href} target="_blank" rel="noopener noreferrer" />}>
            새 창에서 열기
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => void copyLink()}>링크 복사</DropdownMenuItem>
          {canManage && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onClick={() => {
                  setError(null)
                  setRemoveOpen(true)
                }}
              >
                제거
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <span role="status" aria-live="polite" className="sr-only">
        {status}
      </span>

      {kind === 'file' && channelId && fileAttachmentId && (
        <UploadVersionDialog
          open={versionOpen}
          onOpenChange={setVersionOpen}
          attachmentId={fileAttachmentId}
          tabTitle={title}
          channelId={channelId}
        />
      )}

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>탭 이름 바꾸기</DialogTitle>
            <DialogDescription>탭 바에 보이는 이름만 바뀝니다.</DialogDescription>
          </DialogHeader>
          <form onSubmit={onRename} className="grid gap-4">
            <Field>
              <FieldLabel htmlFor={`${uid}-name`}>탭 이름</FieldLabel>
              <Input
                id={`${uid}-name`}
                value={name}
                maxLength={TAB_TITLE_MAX}
                required
                onChange={e => setName(e.target.value)}
              />
            </Field>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setRenameOpen(false)}>
                취소
              </Button>
              <Button type="submit" disabled={pending || !name.trim()}>
                저장
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={removeOpen} onOpenChange={setRemoveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>‘{title}’ 탭을 제거할까요?</DialogTitle>
            <DialogDescription>
              {kind === 'note'
                ? '메모 내용과 저장 이력이 함께 삭제되며 되돌릴 수 없습니다.'
                : '탭만 사라지고, 가리키던 웹사이트·문서·할 일은 그대로 남습니다.'}
            </DialogDescription>
          </DialogHeader>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setRemoveOpen(false)}>
              취소
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={pending}
              onClick={() => void onRemove()}
            >
              제거
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
