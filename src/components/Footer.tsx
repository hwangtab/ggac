import Link from 'next/link'
import Image from 'next/image'
import { FaInstagram, FaYoutube } from 'react-icons/fa'

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
  // 기본값 설정
  const defaultData = {
    siteName: "경기아트콜렉티브 협동조합",
    siteDescription: "경계 없는 상상, 함께 만드는 울림",
    contact: {
      email: "contact@gac.coop",
      phone: "0507-1384-3144",
      address: "경기도 고양시 덕양구 성사동 719"
    },
    social: {
      instagram: "https://www.instagram.com/ggartcollective",
      youtube: "https://youtube.com/@gac_cooperative"
    },
    businessInfo: {
      establishedDate: "2025-05-01",
      registrationDate: "2025-05-14",
      registrationNumber: "285051-0001472"
    }
  }

  const data = globalData || defaultData
  return (
    <footer className="bg-gray-900 text-white py-12">
      <div className="container-custom">
        <div className="grid md:grid-cols-3 gap-8 mb-8">
          {/* Logo & Description */}
          <div>
            <div className="flex items-center space-x-3 mb-4">
              <div className="relative w-8 h-8 brightness-0 invert">
                <Image
                  src="/images/logo/gac_logo.webp"
                  alt="경기아트콜렉티브 협동조합"
                  fill
                  className="object-contain"
                />
              </div>
              <span className="font-serif font-bold text-xl">
                경기아트콜렉티브
              </span>
            </div>
            <p className="text-gray-400 text-sm leading-relaxed">
              {data.siteDescription}<br />
              예술로 숨 쉬고, 협동으로 길을 내는 협동조합입니다.
            </p>
          </div>

          {/* Quick Links */}
          <div>
            <h4 className="font-semibold mb-4">바로가기</h4>
            <ul className="space-y-2">
              <li>
                <Link href="/about" className="text-gray-400 hover:text-white transition-colors duration-200">
                  우리의 이야기
                </Link>
              </li>
              <li>
                <Link href="/archive" className="text-gray-400 hover:text-white transition-colors duration-200">
                  프로젝트
                </Link>
              </li>
              <li>
                <Link href="/artists" className="text-gray-400 hover:text-white transition-colors duration-200">
                  함께하는 사람들
                </Link>
              </li>
              <li>
                <Link href="/connect" className="text-gray-400 hover:text-white transition-colors duration-200">
                  소통과 참여
                </Link>
              </li>
            </ul>
          </div>

          {/* Contact */}
          <div>
            <h4 className="font-semibold mb-4">연락처</h4>
            <div className="text-gray-400 text-sm space-y-2">
              <p>
                이메일: 
                <a 
                  href={`mailto:${data.contact.email}`}
                  className="hover:text-white transition-colors duration-200 underline ml-1"
                >
                  {data.contact.email}
                </a>
              </p>
              <p>
                전화: 
                <a 
                  href={`tel:${data.contact.phone}`}
                  className="hover:text-white transition-colors duration-200 underline ml-1"
                >
                  {data.contact.phone}
                </a>
              </p>
              <p>
                주소: 
                <a 
                  href={`https://map.naver.com/v5/search/${encodeURIComponent(data.contact.address)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-white transition-colors duration-200 underline ml-1"
                >
                  {data.contact.address}
                </a>
              </p>
            </div>
            
            <div className="flex space-x-6 mt-4">
              <a 
                href={data.social.instagram}
                target="_blank" 
                rel="noopener noreferrer"
                className="flex items-center space-x-2 text-gray-400 hover:text-pink-400 transition-colors duration-200"
              >
                <FaInstagram className="w-5 h-5" />
                <span className="text-sm">Instagram</span>
              </a>
              <a 
                href={data.social.youtube}
                target="_blank" 
                rel="noopener noreferrer"
                className="flex items-center space-x-2 text-gray-400 hover:text-red-400 transition-colors duration-200"
              >
                <FaYoutube className="w-5 h-5" />
                <span className="text-sm">YouTube</span>
              </a>
            </div>
          </div>
        </div>

        {/* Bottom */}
        <div className="border-t border-gray-800 pt-8 flex flex-col md:flex-row justify-between items-center">
          <div className="text-gray-400 text-sm mb-4 md:mb-0">
            <p>설립신고: {new Date(data.businessInfo.establishedDate).toLocaleDateString('ko-KR')} | 법인성립: {new Date(data.businessInfo.registrationDate).toLocaleDateString('ko-KR')}</p>
            <p>사업자등록번호: {data.businessInfo.registrationNumber}</p>
          </div>
          <p className="text-gray-400 text-sm">
            © 2025 {data.siteName}. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  )
}

export default Footer
