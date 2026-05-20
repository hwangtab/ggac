import Image from 'next/image'

interface BrandLoaderProps {
  /** 헤더 높이만큼 상단 여백 추가가 필요한 경우 사용 */
  withHeaderOffset?: boolean
  className?: string
  ariaLabel?: string
  srText?: string
}

export default function BrandLoader({
  withHeaderOffset = true,
  className = '',
  ariaLabel = '페이지를 불러오는 중',
  srText = '불러오는 중입니다',
}: BrandLoaderProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={ariaLabel}
      className={`flex min-h-[60vh] items-center justify-center ${
        withHeaderOffset ? 'pt-20' : ''
      } ${className}`}
    >
      <div className="animate-brand-loader will-change-transform">
        <Image
          src="/images/logo/gac_og.webp"
          alt="경기아트콜렉티브 협동조합"
          width={320}
          height={168}
          priority
          sizes="(max-width: 640px) 220px, 320px"
          className="h-auto w-[220px] sm:w-[280px] md:w-[320px]"
        />
      </div>
      <span className="sr-only">{srText}</span>
    </div>
  )
}
