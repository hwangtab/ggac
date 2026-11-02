import { SubNav, SubNavLink } from '@work/components/layout/sub-nav'
import { channelFilesHref } from '@work/lib/files/channel-files'

/** 채널 "파일" 탭 안의 하위 보기 "링크" 주소(`<기본 경로>/files?view=links`) */
export function channelLinksHref(base: string): string {
  return `${base}/files?view=links`
}

/** 채널 "파일" 탭 안의 하위 보기 전환: 파일(폴더·검색) / 링크(메시지에 붙은 주소 모음) */
export default function ChannelFilesSubNav({
  base,
  active,
}: {
  base: string
  active: 'files' | 'links'
}) {
  const items = [
    { key: 'files' as const, label: '파일 목록', href: channelFilesHref(base) },
    { key: 'links' as const, label: '링크 목록', href: channelLinksHref(base) },
  ]
  return (
    <SubNav label="파일 보기">
      {items.map(it => (
        <SubNavLink key={it.key} href={it.href} active={active === it.key}>
          {it.label}
        </SubNavLink>
      ))}
    </SubNav>
  )
}
