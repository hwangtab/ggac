import {
  ArchiveIcon,
  FileIcon as GenericFileIcon,
  FileImageIcon,
  FileMusicIcon,
  FileSpreadsheetIcon,
  FileTextIcon,
  FileVideoIcon,
  PresentationIcon,
  type LucideIcon,
} from 'lucide-work'
import { fileKindOf, type FileKind } from '@work/lib/files/mime'
import { cn } from '@work/lib/utils'

const ICONS: Record<FileKind, LucideIcon> = {
  image: FileImageIcon,
  pdf: FileTextIcon,
  word: FileTextIcon,
  hwp: FileTextIcon,
  text: FileTextIcon,
  spreadsheet: FileSpreadsheetIcon,
  presentation: PresentationIcon,
  archive: ArchiveIcon,
  video: FileVideoIcon,
  audio: FileMusicIcon,
  other: GenericFileIcon,
}

/** mime·확장자에 맞는 아이콘(장식용 — 항상 aria-hidden). */
export default function FileIcon({
  mime,
  name,
  size,
  className,
}: {
  mime: string
  name: string
  /** 바이트 — 있으면 큰 `.ts`(MPEG-TS 동영상)를 동영상 아이콘으로 */
  size?: number
  className?: string
}) {
  const Icon = ICONS[fileKindOf(mime, name, size)]
  return (
    <Icon aria-hidden="true" className={cn('size-5 shrink-0 text-muted-foreground', className)} />
  )
}
