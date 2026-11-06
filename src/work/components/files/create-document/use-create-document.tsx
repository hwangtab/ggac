'use client'

import { useCallback, useState, type ReactNode } from 'react'
import {
  canOfferCreateDocument,
  type CreateActor,
  type CreateChannelOption,
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
 *
 * 두 가지 호출 모양이 있다.
 *  - 채널이 정해진 화면(채널 파일 탭·자료실 폴더 보기·입력창·스레드): `channelId` + `actor`.
 *  - 자료실 **첫 화면**(채널 미선택, 2026-11-06): `channels`만 준다 — 서버가 이미 "만들 수 있는 채널"로
 *    걸러 준 목록이라(`loadCreatableChannels`) 채널별 `actor` 판정을 다시 할 필요가 없고, 고르는 일은
 *    대화상자 안에서 한다.
 */
export function useCreateDocument({
  channelId,
  channels,
  folderPath,
  parentId,
  actor,
}: {
  /** 채널이 정해진 화면이면 그 id. 첫 화면처럼 나중에 고르는 화면이면 비운다 */
  channelId?: string | null
  /** 채널을 나중에 고르는 화면에서 고를 수 있는 채널(서버가 권한까지 걸러서 준다) */
  channels?: CreateChannelOption[]
  folderPath?: string | null
  parentId?: string | null
  actor?: Omit<CreateActor, 'inThread'>
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
  // 채널을 고르는 화면이면 목록이 비어 있지 않은지만 본다(목록 자체가 권한 판정을 지난 결과다).
  // 채널이 정해진 화면이면 예전 그대로 채널 단위 판정을 한다.
  const target = channels ? channels.length > 0 : Boolean(channelId)
  const permitted = channels
    ? channels.length > 0
    : actor
      ? canOfferCreateDocument({ ...actor, inThread: Boolean(parentId) })
      : false
  const available = (officeEnabled || hwpxEnabled) && target && permitted

  const open = useCallback(
    (type: CreateDocumentType | 'hwpx' | null) => setState({ open: true, type }),
    []
  )

  const dialog = available ? (
    <CreateDocumentDialog
      open={state.open}
      onOpenChange={next => setState(s => ({ ...s, open: next }))}
      channelId={channelId ?? null}
      channels={channels}
      type={state.type}
      officeEnabled={officeEnabled}
      hwpxEnabled={hwpxEnabled}
      folderPath={folderPath}
      parentId={parentId}
    />
  ) : null

  return { available, officeEnabled, hwpxEnabled, open, dialog }
}
