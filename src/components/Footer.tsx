'use client'

import Image from 'next/image'
import { FaInstagram, FaYoutube } from 'react-icons/fa'
import { useTranslations, useLocale } from 'next-intl'
import { Link } from '@/i18n/navigation'
import {
  toSafeEmailHref,
  toSafeHttpUrl,
  toSafeNaverMapSearchHref,
  toSafePhoneHref,
} from '@/utils/safeUrl'

interface FooterProps {
  globalData?: {
    siteName: string
    siteDescription: string
    contact: {
      email: string
      phone: string
      address: string
    }
    social: {
      instagram: string
      youtube: string
    }
    businessInfo: {
      establishedDate: string
      registrationDate: string
      registrationNumber: string
    }
  }
}

const Footer = ({ globalData }: FooterProps) => {
  const t = useTranslations('footer')
  const tc = useTranslations('common')
  const locale = useLocale()
  const dateLocale = locale === 'en' ? 'en-US' : 'ko-KR'

  // 기본값 설정
  const defaultData = {
    siteName: tc('brandShort'),
    siteDescription: t('siteDescription'),
    contact: {
      email: 'contact@ggac.kr',
      phone: '0507-1384-3144',
      address: '경기도 고양시 덕양구 성사동 719',
    },
    social: {
      instagram: 'https://www.instagram.com/ggartcollective',
      youtube: 'https://www.youtube.com/@%EA%B2%BD%EC%95%84%EC%BD%9C',
    },
    businessInfo: {
      establishedDate: '2025-05-01',
      registrationDate: '2025-05-14',
      registrationNumber: '513-86-03832',
    },
  }

  const data = globalData || defaultData
  const safeInstagramUrl = toSafeHttpUrl(data.social.instagram)
  const safeYoutubeUrl = toSafeHttpUrl(data.social.youtube)
  const safeEmailHref = toSafeEmailHref(data.contact.email)
  const safePhoneHref = toSafePhoneHref(data.contact.phone)
  const safeAddressHref = toSafeNaverMapSearchHref(data.contact.address)
  return (
    <footer className="bg-gray-900 text-white py-12">
      <div className="tw-container-custom">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-8">
          {/* Logo & Description */}
          <div>
            <div className="flex items-center space-x-3 mb-4">
              <div className="relative w-8 h-8 brightness-0 invert pointer-events-none">
                <Image
                  src="/images/logo/gac_logo.webp"
                  alt={tc('brandShort')}
                  fill
                  sizes="32px"
                  className="object-contain"
                />
              </div>
              <span className="font-serif font-bold text-xl">{tc('brandShort')}</span>
            </div>
            <p className="text-gray-400 text-sm leading-relaxed">
              {data.siteDescription}
              <br />
              {t('tagline')}
            </p>
          </div>

          {/* Quick Links */}
          <div>
            <h3 className="font-semibold mb-4">{t('quickLinks')}</h3>
            <ul className="space-y-2">
              <li>
                <Link
                  href="/about"
                  className="text-gray-400 hover:text-white transition-colors duration-200"
                >
                  {t('about')}
                </Link>
              </li>
              <li>
                <Link
                  href="/archive"
                  className="text-gray-400 hover:text-white transition-colors duration-200"
                >
                  {t('archive')}
                </Link>
              </li>
              <li>
                <Link
                  href="/artists"
                  className="text-gray-400 hover:text-white transition-colors duration-200"
                >
                  {t('artists')}
                </Link>
              </li>
              <li>
                <Link
                  href="/board"
                  className="text-gray-400 hover:text-white transition-colors duration-200"
                >
                  {t('board')}
                </Link>
              </li>
              <li>
                <Link
                  href="/connect"
                  className="text-gray-400 hover:text-white transition-colors duration-200"
                >
                  {t('connect')}
                </Link>
              </li>
              <li>
                <Link
                  href="/faq"
                  className="text-gray-400 hover:text-white transition-colors duration-200"
                >
                  {t('faq')}
                </Link>
              </li>
            </ul>
          </div>

          {/* Contact */}
          <div>
            <h3 className="font-semibold mb-4">{t('contact')}</h3>
            <div className="text-gray-400 text-sm space-y-2">
              <p>
                {t('email')}:
                {safeEmailHref ? (
                  <a
                    href={safeEmailHref}
                    className="hover:text-white transition-colors duration-200 underline underline-offset-4 hover:underline-offset-6 ml-1"
                  >
                    {data.contact.email}
                  </a>
                ) : (
                  <span className="ml-1">{data.contact.email}</span>
                )}
              </p>
              <p>
                {t('phone')}:
                {safePhoneHref ? (
                  <a
                    href={safePhoneHref}
                    className="hover:text-white transition-colors duration-200 underline underline-offset-4 hover:underline-offset-6 ml-1"
                  >
                    {data.contact.phone}
                  </a>
                ) : (
                  <span className="ml-1">{data.contact.phone}</span>
                )}
              </p>
              <p>
                {t('address')}:
                {safeAddressHref ? (
                  <a
                    href={safeAddressHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-white transition-colors duration-200 underline underline-offset-4 hover:underline-offset-6 ml-1"
                  >
                    {data.contact.address}
                  </a>
                ) : (
                  <span className="ml-1">{data.contact.address}</span>
                )}
              </p>
            </div>

            <div className="flex space-x-6 mt-4">
              {safeInstagramUrl && (
                <a
                  href={safeInstagramUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center space-x-2 text-gray-400 hover:text-pink-400 transition-colors duration-200"
                >
                  <FaInstagram className="w-5 h-5" />
                  <span className="text-sm">Instagram</span>
                </a>
              )}
              {safeYoutubeUrl && (
                <a
                  href={safeYoutubeUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center space-x-2 text-gray-400 hover:text-red-400 transition-colors duration-200"
                >
                  <FaYoutube className="w-5 h-5" />
                  <span className="text-sm">YouTube</span>
                </a>
              )}
            </div>
          </div>
        </div>

        {/* Bottom */}
        <div className="border-t border-gray-800 pt-8 flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="text-gray-400 text-sm mb-4 md:mb-0">
            <p>
              {t('established')}:{' '}
              {new Date(data.businessInfo.establishedDate).toLocaleDateString(dateLocale)} |
              {t('incorporated')}:{' '}
              {new Date(data.businessInfo.registrationDate).toLocaleDateString(dateLocale)}
            </p>
            <p>
              {t('businessNumber')}: {data.businessInfo.registrationNumber}
            </p>
          </div>
          <div className="flex flex-col items-center md:items-end gap-2">
            <div className="flex space-x-4 text-gray-500 text-xs">
              <Link href="/privacy" className="hover:text-gray-300 transition-colors duration-200">
                {t('privacy')}
              </Link>
              <Link href="/terms" className="hover:text-gray-300 transition-colors duration-200">
                {t('terms')}
              </Link>
            </div>
            <p className="text-gray-400 text-sm">
              © 2025 {tc('brandShort')}. {t('rights')}
            </p>
          </div>
        </div>
      </div>
    </footer>
  )
}

export default Footer
