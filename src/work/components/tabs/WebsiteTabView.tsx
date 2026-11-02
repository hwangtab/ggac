import { ExternalLinkIcon, GlobeIcon } from 'lucide-work'
import { buttonVariants } from '@work/components/ui/button'
import { EmptyState, NoticeBanner } from '@work/components/layout/page'
import { cn } from '@work/lib/utils'
import { parseTabConfig } from '@work/lib/tabs/schema'
import { websiteDisplay, type WebsiteDisplay } from '@work/lib/tabs/website'

const CARD_REASON: Record<Extract<WebsiteDisplay, { mode: 'card' }>['reason'], string> = {
  disabled: '이 탭은 링크 카드로만 표시하도록 설정되어 있습니다.',
  'same-site': '조합 사이트는 보안을 위해 탭 안에 표시하지 않습니다. 새 창에서 여세요.',
  'not-allowed':
    '탭 안 표시는 구글 문서·시트·슬라이드·설문·캘린더·드라이브 파일만 지원합니다. 새 창에서 여세요.',
  // ggac 이식: 사이트 CSP(frame-src)가 외부 문서 출처를 열기 전까지는 링크 카드로만 보인다(website.ts)
  'not-embeddable': '이 업무툴은 아직 탭 안에 외부 페이지를 표시하지 않습니다. 새 창에서 여세요.',
  invalid: '주소를 표시할 수 없습니다.',
}

/**
 * 웹사이트 탭 본문(docs/05 §4-2). 항상 위에 "새 창에서 열기" 줄을 둔다 — 상대 사이트가 삽입을 막으면 iframe 이 비기 때문.
 * 삽입은 허용 목록(구글 문서류·캘린더·드라이브)만, sandbox + referrerpolicy=no-referrer. 그 밖의 주소는 카드로만(docs/07 S-4).
 */
export default function WebsiteTabView({ title, config }: { title: string; config: unknown }) {
  const parsed = parseTabConfig('website', config)
  if (!parsed) {
    return (
      <div className="p-4">
        <NoticeBanner tone="destructive" role="alert">
          이 탭의 설정을 읽을 수 없습니다. 탭을 제거하고 다시 추가해 주세요.
        </NoticeBanner>
      </div>
    )
  }
  // ggac 이식: strict 꺼짐이라 zod 추론 키가 선택적으로 보인다 — parse를 통과했으면 url은 있다
  const display = websiteDisplay(parsed as { url: string; embed: boolean })
  const host = new URL(parsed.url).hostname

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-10 shrink-0 items-center gap-2 border-b px-4 pointer-coarse:min-h-11">
        <GlobeIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        <h2 className="min-w-0 flex-1 truncate text-sm font-medium" title={parsed.url}>
          {host}
        </h2>
        <a
          href={parsed.url}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
        >
          <ExternalLinkIcon aria-hidden="true" />새 창에서 열기
        </a>
      </div>
      {display.mode === 'embed' ? (
        // sandbox 점검(0026): 외부 오리진이라 allow-same-origin 이 있어도 우리 쿠키·DOM 에는 닿지 못한다(그 사이트 자신의
        // 오리진일 뿐). 스크립트·폼·팝업만 허용하고, 상위 화면 이동(allow-top-navigation)·모달·다운로드·
        // 팝업의 sandbox 탈출(allow-popups-to-escape-sandbox)은 주지 않는다. 카메라·위치 등은 allow 속성이 없어 차단.
        // CSP frame-src 도 같은 허용 목록(EMBED_FRAME_ORIGINS — security-headers.ts).
        <iframe
          title={`${title} (외부 사이트)`}
          src={display.src}
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          referrerPolicy="no-referrer"
          loading="lazy"
          className="min-h-0 w-full flex-1 border-0 bg-background"
        />
      ) : (
        <EmptyState
          icon={GlobeIcon}
          as="p"
          title={title}
          description={
            <>
              <span className="block break-all">{parsed.url}</span>
              <span className="mt-1 block">{CARD_REASON[display.reason]}</span>
            </>
          }
        />
      )}
    </div>
  )
}
