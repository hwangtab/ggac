'use client'

import { FilePlusIcon } from 'lucide-work'
import { Button } from '@work/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@work/components/ui/dropdown-menu'
import {
  CREATE_DOCUMENT_TYPES,
  type CreateActor,
  type CreateChannelOption,
} from '@work/lib/files/create-rules'
import { useCreateDocument } from './use-create-document'

/**
 * 채널 파일 탭·자료실 폴더 머리글·자료실 첫 화면의 "새로 만들기"(docs/16 §2-2). 노출 조건은 입력창과 같다
 * (useCreateDocument).
 *
 * 두 가지 모양:
 *  - 채널 파일 탭·자료실 폴더 보기: `channelId` + `actor` (그 폴더에 파일이 올라간다)
 *  - **자료실 첫 화면**(2026-11-06): `channels`만 준다. 채널을 먼저 고르지 않아도 만들 수 있게,
 *    고르는 일은 대화상자 안에서 한다 — 이전에는 채널을 골라야만 버튼이 보여서 "#전체"·"기타"만
 *    보이는 사이드바에서 만들기 진입점을 찾지 못했다.
 */
export default function NewDocumentMenu({
  channelId,
  channels,
  folderPath,
  actor,
}: {
  channelId?: string | null
  /** 채널을 나중에 고르는 화면의 후보(서버가 권한까지 걸러서 준다) */
  channels?: CreateChannelOption[]
  folderPath?: string | null
  actor?: Omit<CreateActor, 'inThread'>
}) {
  const create = useCreateDocument({ channelId, channels, folderPath, actor })
  if (!create.available) return null

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button type="button" variant="outline" size="sm" />}>
          <FilePlusIcon aria-hidden="true" />
          새로 만들기
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-48">
          {create.officeEnabled &&
            CREATE_DOCUMENT_TYPES.map(t => (
              <DropdownMenuItem key={t.type} onClick={() => create.open(t.type)}>
                {t.label}
              </DropdownMenuItem>
            ))}
          {create.hwpxEnabled && (
            <DropdownMenuItem onClick={() => create.open('hwpx')}>한글 문서(HWPX)</DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {create.dialog}
    </>
  )
}
