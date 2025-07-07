'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { usePathname, useRouter } from 'next/navigation'
import { supabase } from '../lib/supabase/client'

const Navigation = () => {
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [isScrolled, setIsScrolled] = useState(false)
  const [user, setUser] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const pathname = usePathname()
  const router = useRouter()
  
  // 홈페이지인지 확인
  const isHomePage = pathname === '/'
  
  // 간소화된 색상 로직
  const isDark = isHomePage && !isScrolled
  const textColor = isDark ? 'text-white' : 'text-gray-700'
  const activeColor = isDark ? 'text-accent-300' : 'text-primary-600'
  const hoverColor = isDark ? 'hover:text-accent-300' : 'hover:text-primary-600'

  const menuItems = [
    { href: '/', label: 'HOME' },
    { href: '/about', label: 'ABOUT' },
    { href: '/archive', label: 'PROJECTS' },
    { href: '/artists', label: 'ARTISTS' },
    { href: '/board', label: 'BOARD' },
    { href: '/connect', label: 'CONNECT' },
  ]

  // 스크롤 이벤트
  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 20)
    }
    window.addEventListener('scroll', handleScroll)
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  // 사용자 인증 상태 관리
  useEffect(() => {
    let mounted = true

    const getUser = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (mounted) {
          setUser(user)
          setLoading(false)
        }
      } catch (error) {
        console.error('Error getting user:', error)
        if (mounted) {
          setUser(null)
          setLoading(false)
        }
      }
    }

    // Set initial loading to false immediately to show auth buttons
    setLoading(false)
    getUser()

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (mounted) {
        setUser(session?.user || null)
      }
    })

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [])

  const handleLogout = async () => {
    try {
      await supabase.auth.signOut()
      router.push('/')
    } catch (error) {
      console.error('Error signing out:', error)
    }
  }

  return (
    <nav className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
      isScrolled 
        ? 'bg-white/90 backdrop-blur-md shadow-sm' 
        : isHomePage 
          ? 'bg-transparent' 
          : 'bg-white/90 backdrop-blur-md shadow-sm'
    }`}>
      <div className="container-custom">
        <div className="flex items-center justify-between h-16 md:h-20">
          {/* Logo */}
          <Link href="/" className="flex items-center space-x-3">
            <div className={`relative w-10 h-10 transition-all duration-300 ${
              isDark ? 'brightness-0 invert' : ''
            }`}>
              <Image
                src="/images/logo/gac_logo.webp"
                alt="경기아트콜렉티브 협동조합"
                fill
                sizes="40px"
                className="object-contain"
                priority
              />
            </div>
            <span className={`font-serif font-bold text-xl hidden sm:inline transition-colors duration-300 ${textColor}`}>
              경기아트콜렉티브
            </span>
          </Link>

          {/* Desktop Menu */}
          <div className="hidden md:flex items-center space-x-6">
            {/* Main Navigation */}
            <div className="flex items-center space-x-6">
              {menuItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`font-medium transition-colors duration-300 ${
                    pathname === item.href
                      ? activeColor
                      : `${textColor} ${hoverColor}`
                  }`}
                >
                  {item.label}
                </Link>
              ))}
            </div>
            
            {/* Auth Section */}
            <div className="flex items-center space-x-4 ml-4 pl-4 border-l border-gray-300/20">
              {user ? (
                <button
                  onClick={handleLogout}
                  className={`font-medium transition-colors duration-300 text-sm ${textColor} ${hoverColor}`}
                >
                  로그아웃
                </button>
              ) : (
                <>
                  <Link
                    href="/login"
                    className={`font-medium transition-colors duration-300 text-sm ${
                      pathname === '/login' ? activeColor : `${textColor} ${hoverColor}`
                    }`}
                  >
                    로그인
                  </Link>
                  <Link
                    href="/signup"
                    className={`font-medium transition-colors duration-300 text-sm px-3 py-1 rounded-md ${
                      pathname === '/signup' 
                        ? 'bg-primary-600 text-white' 
                        : isDark 
                          ? 'bg-accent-300 text-gray-900 hover:bg-accent-400' 
                          : 'bg-primary-600 text-white hover:bg-primary-700'
                    }`}
                  >
                    조합원 가입
                  </Link>
                </>
              )}
            </div>
          </div>

          {/* Mobile Menu Button */}
          <button
            onClick={() => setIsMenuOpen(!isMenuOpen)}
            className={`md:hidden p-2 rounded-md transition-colors duration-300 ${textColor} ${hoverColor}`}
          >
            <div className="w-6 h-6 flex flex-col justify-center items-center">
              <span className={`bg-current h-0.5 w-6 transition-all duration-300 ${
                isMenuOpen ? 'rotate-45 translate-y-0.5' : ''
              }`} />
              <span className={`bg-current h-0.5 w-6 mt-1 transition-all duration-300 ${
                isMenuOpen ? 'opacity-0' : ''
              }`} />
              <span className={`bg-current h-0.5 w-6 mt-1 transition-all duration-300 ${
                isMenuOpen ? '-rotate-45 -translate-y-1.5' : ''
              }`} />
            </div>
          </button>
        </div>

        {/* Mobile Menu */}
        {isMenuOpen && (
          <div className="md:hidden absolute left-4 right-4 top-full mt-2 z-50">
            <div className="bg-white/95 backdrop-blur-md rounded-lg shadow-lg p-2 border border-gray-200/20">
              {/* Main Menu Items */}
              {menuItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setIsMenuOpen(false)}
                  className={`block py-3 px-4 rounded-md transition-colors duration-200 ${
                    pathname === item.href
                      ? 'text-primary-600 bg-primary-50'
                      : 'text-gray-700 hover:text-primary-600 hover:bg-gray-50'
                  }`}
                >
                  {item.label}
                </Link>
              ))}
              
              {/* Mobile Auth Section */}
              <div className="border-t border-gray-200/50 mt-2 pt-2">
                {user ? (
                  <button
                    onClick={() => {
                      handleLogout()
                      setIsMenuOpen(false)
                    }}
                    className="block w-full text-left py-3 px-4 rounded-md transition-colors duration-200 text-gray-700 hover:text-primary-600 hover:bg-gray-50"
                  >
                    로그아웃
                  </button>
                ) : (
                  <>
                    <Link
                      href="/login"
                      onClick={() => setIsMenuOpen(false)}
                      className={`block py-3 px-4 rounded-md transition-colors duration-200 ${
                        pathname === '/login'
                          ? 'text-primary-600 bg-primary-50'
                          : 'text-gray-700 hover:text-primary-600 hover:bg-gray-50'
                      }`}
                    >
                      로그인
                    </Link>
                    <Link
                      href="/signup"
                      onClick={() => setIsMenuOpen(false)}
                      className={`block py-3 px-4 rounded-md transition-colors duration-200 font-medium ${
                        pathname === '/signup'
                          ? 'text-white bg-primary-600'
                          : 'text-white bg-primary-600 hover:bg-primary-700'
                      }`}
                    >
                      조합원 가입
                    </Link>
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </nav>
  )
}

export default Navigation