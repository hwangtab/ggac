'use client'

import { FilePlusIcon } from 'lucide-work'
import { Button } from '@work/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@work/components/ui/dropdown-menu'
import { CREATE_DOCUMENT_TYPES, type CreateActor } from '@work/lib/files/create-rules'
import { useCreateDocument } from './use-create-document'

/**
 * 채널 파일 탭·자료실 폴더 머리글의 "새로 만들기"(docs/16 §2-2). 노출 조건은 입력창과 같다(useCreateDocument).
 * 폴더 보기에서는 현재 폴더(`folderPath`)에 파일이 올라간다.
 */
export default function NewDocumentMenu({
  channelId,
  folderPath,
  actor,
}: {
  channelId: string
  folderPath?: string | null
  actor: Omit<CreateActor, 'inThread'>
}) {
  const create = useCreateDocument({ channelId, folderPath, actor })
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
