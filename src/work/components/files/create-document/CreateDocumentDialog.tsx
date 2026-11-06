'use client'

import { Field, FieldLabel, FieldSet, FieldLegend, FieldChoice } from '@work/components/ui/field'
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
import { NativeSelect } from '@work/components/ui/native-select'
import {
  CREATE_DOCUMENT_TYPES,
  CREATE_NAME_MAX,
  HWPX_CREATE_TEMPLATES,
  createDocumentHref,
  defaultDocumentName,
  hwpxTemplateInfo,
  normalizeCreateFileName,
  type CreateChannelOption,
  type CreateDocumentType,
  type HwpxTemplateId,
} from '@work/lib/files/create-rules'
import { isHwpxEditorEnabled } from '@work/lib/files/hwp-editor'

type Kind = CreateDocumentType

/**
 * 새 문서 이름 대화상자(docs/16 §2-3). `type` 이 정해져 있으면(파일 탭 메뉴) 이름만, 없으면(입력창) 형식도 고른다.
 * [만들기]가 `/edit/new` 편집 화면으로 이동한다 — 파일은 편집기에서 처음 저장할 때 생긴다.
 * 한글 문서(HWPX, docs/18)는 빈 문서로(서식이 둘 이상이면 고르고) rhwp 편집기 화면(`/edit/new?type=hwpx&template=…`)으로 간다.
 */
export default function CreateDocumentDialog({
  open,
  onOpenChange,
  channelId,
  channels,
  type: presetType,
  folderPath,
  parentId,
  officeEnabled = true,
  hwpxEnabled = isHwpxEditorEnabled(),
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 채널이 정해진 화면이면 그 id. 비어 있으면 아래 `channels`에서 고른다 */
  channelId?: string | null
  /** 자료실 첫 화면처럼 채널을 나중에 고르는 경우의 후보(서버가 권한까지 걸러 준 목록) */
  channels?: CreateChannelOption[]
  /** 정해져 있으면 형식 선택을 숨긴다 */
  type: Kind | null
  folderPath?: string | null
  /** 스레드 안에서 만들면 그 스레드 루트 메시지 id */
  parentId?: string | null
  /** 오피스 종류(Word·Excel·PPT)를 고를 수 있나 */
  officeEnabled?: boolean
  /** 한글 문서(HWPX)를 고를 수 있나(두 플래그 + PC) */
  hwpxEnabled?: boolean
}) {
  const router = useRouter()
  const uid = useId()
  const firstKind: Kind = presetType ?? (officeEnabled ? 'docx' : 'hwpx')
  const [kind, setKind] = useState<Kind>(firstKind)
  const [templateId, setTemplateId] = useState<HwpxTemplateId>('blank')
  const [name, setName] = useState('')
  const [touched, setTouched] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // 채널을 나중에 고르는 화면이면 첫 후보를 미리 골라 둔다(대개 하나뿐이다).
  const [channel, setChannel] = useState<string>('')
  const needsChannelPick = !channelId && Boolean(channels && channels.length > 0)
  const pickedChannel = channelId || channel || channels?.[0]?.id || ''

  function defaultNameOf(k: Kind, tid: HwpxTemplateId): string {
    return k === 'hwpx' ? hwpxTemplateInfo(tid).defaultName : defaultDocumentName(k)
  }

  // 열릴 때마다 처음 상태로
  useEffect(() => {
    if (!open) return
    const k: Kind = presetType ?? (officeEnabled ? 'docx' : 'hwpx')
    setKind(k)
    setTemplateId('blank')
    setName(defaultNameOf(k, 'blank'))
    setTouched(false)
    setError(null)
    setChannel(channelId ?? '')
  }, [open, presetType, officeEnabled, channelId])

  function pickKind(next: Kind) {
    setKind(next)
    if (!touched) setName(defaultNameOf(next, templateId))
  }

  function pickTemplate(next: HwpxTemplateId) {
    setTemplateId(next)
    if (!touched) setName(defaultNameOf('hwpx', next))
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    const fileName = normalizeCreateFileName(name, kind)
    if (!fileName) {
      setError('파일 이름을 입력해 주세요.')
      return
    }
    if (!pickedChannel) {
      setError('문서를 만들 채널을 골라 주세요.')
      return
    }
    onOpenChange(false)
    router.push(
      createDocumentHref({
        channelId: pickedChannel,
        type: kind,
        template: kind === 'hwpx' ? templateId : undefined,
        name: fileName,
        folder: folderPath,
        parentId,
        messageId: crypto.randomUUID(),
      })
    )
  }

  const ext = kind
  const nameId = `${uid}-name`
  const errId = `${uid}-err`
  const kindChoices = (officeEnabled ? CREATE_DOCUMENT_TYPES.length : 0) + (hwpxEnabled ? 1 : 0)

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <form onSubmit={onSubmit} className="grid gap-4">
            <DialogHeader>
              <DialogTitle>새 문서 만들기</DialogTitle>
              <DialogDescription>
                편집 화면에서 처음 저장할 때 이 대화에 파일로 올라갑니다. 저장하지 않고 닫으면
                아무것도 남지 않습니다.
              </DialogDescription>
            </DialogHeader>

            {needsChannelPick && (
              <Field>
                <FieldLabel htmlFor={`${uid}-channel`}>채널</FieldLabel>
                <NativeSelect
                  id={`${uid}-channel`}
                  value={pickedChannel}
                  onChange={e => {
                    setChannel(e.target.value)
                    setError(null)
                  }}
                >
                  {(channels ?? []).map(c => (
                    <option key={c.id} value={c.id}>
                      # {c.name}
                    </option>
                  ))}
                </NativeSelect>
                <p className="text-xs text-muted-foreground">
                  문서는 고른 채널의 자료(파일 탭)에 올라갑니다.
                </p>
              </Field>
            )}

            {presetType === null && kindChoices > 1 && (
              <FieldSet>
                <FieldLegend>문서 종류</FieldLegend>
                {officeEnabled &&
                  CREATE_DOCUMENT_TYPES.map(t => (
                    <FieldChoice key={t.type}>
                      <input
                        type="radio"
                        name={`${uid}-type`}
                        value={t.type}
                        checked={kind === t.type}
                        onChange={() => pickKind(t.type)}
                      />
                      {t.label}
                    </FieldChoice>
                  ))}
                {hwpxEnabled && (
                  <FieldChoice>
                    <input
                      type="radio"
                      name={`${uid}-type`}
                      value="hwpx"
                      checked={kind === 'hwpx'}
                      onChange={() => pickKind('hwpx')}
                    />
                    한글 문서(HWPX)
                  </FieldChoice>
                )}
              </FieldSet>
            )}

            {kind === 'hwpx' && HWPX_CREATE_TEMPLATES.length > 1 && (
              <FieldSet>
                <FieldLegend>서식</FieldLegend>
                {HWPX_CREATE_TEMPLATES.map(t => (
                  <FieldChoice key={t.id}>
                    <input
                      type="radio"
                      name={`${uid}-template`}
                      value={t.id}
                      checked={templateId === t.id}
                      onChange={() => pickTemplate(t.id)}
                    />
                    <span>
                      {t.label}
                      <span className="block text-xs text-muted-foreground">{t.description}</span>
                    </span>
                  </FieldChoice>
                ))}
              </FieldSet>
            )}

            <Field>
              <FieldLabel htmlFor={nameId}>파일 이름</FieldLabel>
              <div className="flex items-center gap-1">
                <Input
                  id={nameId}
                  value={name}
                  maxLength={CREATE_NAME_MAX + 8}
                  onChange={e => {
                    setName(e.target.value)
                    setTouched(true)
                    setError(null)
                  }}
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? errId : undefined}
                  autoFocus
                />
                <span className="shrink-0 text-sm text-muted-foreground" aria-hidden="true">
                  .{ext}
                </span>
              </div>
              {error && (
                <p id={errId} role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
            </Field>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                취소
              </Button>
              <Button type="submit">만들기</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
