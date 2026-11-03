'use client'

import { ShareIcon, SquarePlusIcon } from 'lucide-work'
import { Button } from '@work/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@work/components/ui/dialog'

/**
 * iOS 는 홈 화면에 추가한 앱에서만 푸시를 받는다 — 구독 전에 설치 방법을 안내한다(원본 kosmart-work 그대로).
 * ggac 이식: 홈 화면 아이콘 이름은 사이트 매니페스트(`src/app/manifest.ts`)의 short_name "GAC"다.
 */
export default function IosInstallGuide({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>홈 화면에 추가해야 알림을 받을 수 있습니다</DialogTitle>
          <DialogDescription>
            iPhone·iPad 는 Safari 에서 바로 알림을 켤 수 없고, 앱처럼 설치한 뒤에만 알림이 옵니다
            (iOS 16.4 이상).
          </DialogDescription>
        </DialogHeader>
        <ol className="space-y-3 text-sm">
          <li className="flex items-start gap-2">
            <ShareIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />
            <span>Safari 에서 이 페이지를 열고 아래(또는 위)의 공유 버튼을 누릅니다.</span>
          </li>
          <li className="flex items-start gap-2">
            <SquarePlusIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />
            <span>
              <strong>홈 화면에 추가</strong>를 고르고 추가합니다.
            </span>
          </li>
          <li className="flex items-start gap-2">
            <span
              aria-hidden="true"
              className="mt-0.5 flex size-4 shrink-0 items-center justify-center text-xs font-bold text-primary"
            >
              3
            </span>
            <span>
              홈 화면의 &ldquo;GAC&rdquo; 아이콘으로 열어 이사회 업무툴의 설정 &gt; 알림에서 켭니다.
            </span>
          </li>
        </ol>
        <DialogFooter>
          <Button type="button" onClick={() => onOpenChange(false)}>
            확인
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
