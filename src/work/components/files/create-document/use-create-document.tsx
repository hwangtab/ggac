'use client'

import { useCallback, useState, type ReactNode } from 'react'
import {
  canOfferCreateDocument,
  type CreateActor,
  type CreateDocumentType,
} from '@work/lib/files/create-rules'
import { isHwpxEditorEnabled } from '@work/lib/files/hwp-editor'
import { getOfficeEditorOrigin } from '@work/lib/files/office-edit'
import { useDesktopEditor } from '../office-edit/use-desktop-editor'
import CreateDocumentDialog from './CreateDocumentDialog'

/**
 * 새 문서 만들기 진입점이 함께 쓰는 훅(docs/16 §2). 노출 판정 = canOfferCreateDocument 그리고
 * (오피스 종류: 편집기 출처 env · PC) 또는 (한글 문서 HWPX: HWP·HWPX 편집 플래그 + 편집기 출처 env · PC — docs/18 §1).
 * 입력창은 `available` 일 때만 `open(null)` 을 onCreateDocument 슬롯에 꽂고, 파일 탭 메뉴는 형식을 정해 `open(type)` 을 부른다.
 * 대화상자는 `dialog` 를 화면 어디든 그려 두면 된다.
 */
export function useCreateDocument({
  channelId,
  folderPath,
  parentId,
  actor,
}: {
  channelId: string
  folderPath?: string | null
  parentId?: string | null
  actor: Omit<CreateActor, 'inThread'>
}): {
  available: boolean
  /** 오피스 종류(Word·Excel·PPT)를 쓸 수 있나 */
  officeEnabled: boolean
  /** 한글 문서(HWPX) 만들기를 쓸 수 있나 */
  hwpxEnabled: boolean
  open: (type: CreateDocumentType | 'hwpx' | null) => void
  dialog: ReactNode
} {
  const desktop = useDesktopEditor()
  const [state, setState] = useState<{ open: boolean; type: CreateDocumentType | 'hwpx' | null }>({
    open: false,
    type: null,
  })
  const officeEnabled = getOfficeEditorOrigin() !== null && desktop
  const hwpxEnabled = isHwpxEditorEnabled() && desktop
  const available =
    (officeEnabled || hwpxEnabled) &&
    canOfferCreateDocument({ ...actor, inThread: Boolean(parentId) })

  const open = useCallback(
    (type: CreateDocumentType | 'hwpx' | null) => setState({ open: true, type }),
    []
  )

  const dialog = available ? (
    <CreateDocumentDialog
      open={state.open}
      onOpenChange={next => setState(s => ({ ...s, open: next }))}
      channelId={channelId}
      type={state.type}
      officeEnabled={officeEnabled}
      hwpxEnabled={hwpxEnabled}
      folderPath={folderPath}
      parentId={parentId}
    />
  ) : null

  return { available, officeEnabled, hwpxEnabled, open, dialog }
}
