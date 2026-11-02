'use client'

import { UploadCloudIcon } from 'lucide-work'
import AttachmentPicker from '@work/components/files/AttachmentPicker'
import PendingAttachments from '@work/components/files/PendingAttachments'
import type { AttachmentUploads } from '@work/components/files/useAttachmentUploads'
import { Button } from '@work/components/ui/button'
import { MAX_UPLOAD_MB } from '@work/lib/files/schema'

/**
 * 파일 탭용 업로드 영역 — 드롭·붙여넣기·"파일 고르기" 단추(숨은 file input)와 진행 목록.
 * 업로드 상태는 호출부의 useTabFileUpload 가 가진다.
 */
export default function TabFileUploader({
  uploads,
  disabled = false,
}: {
  uploads: AttachmentUploads
  disabled?: boolean
}) {
  return (
    <AttachmentPicker uploads={uploads} disabled={disabled}>
      <div className="grid gap-2 rounded-w-lg border border-dashed p-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled || uploads.items.length >= 1}
            onClick={uploads.openFileDialog}
          >
            <UploadCloudIcon aria-hidden="true" />
            파일 고르기
          </Button>
          <span className="text-xs text-muted-foreground">
            여기에 끌어다 놓아도 됩니다 (파일당 {MAX_UPLOAD_MB}MB까지)
          </span>
        </div>
        <PendingAttachments uploads={uploads} className="px-0 pt-0" />
      </div>
    </AttachmentPicker>
  )
}
