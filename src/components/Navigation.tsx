'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'

const Navigation = () => {
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [isScrolled, setIsScrolled] = useState(false)
  const pathname = usePathname()
  
  // 홈페이지인지 확인
  const isHomePage = pathname === '/'
  
  // 홈페이지에서는 텍스트를 밝게, 다른 페이지에서는 어둡게
  const getTextColor = () => {
    if (isHomePage && !isScrolled) {
      return 'text-white'
    }
    return 'text-gray-700'
  }
  
  const getActiveTextColor = () => {
    if (isHomePage && !isScrolled) {
      return 'text-accent-300'
    }
    return 'text-primary-600'
  }
  
  const getHoverTextColor = () => {
    if (isHomePage && !isScrolled) {
      return 'hover:text-accent-300'
    }
    return 'hover:text-primary-600'
  }

  const menuItems = [
    { href: '/', label: 'HOME' },
    { href: '/about', label: 'ABOUT' },
    { href: '/archive', label: 'PROJECTS' },
    { href: '/artists', label: 'ARTISTS' },
    { href: '/connect', label: 'CONNECT' },
  ]

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 20)
    }
    window.addEventListener('scroll', handleScroll)
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

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
              isHomePage && !isScrolled ? 'brightness-0 invert' : ''
            }`}>
              <Image
                src="/images/logo/gac_logo.webp"
                alt="경기아트콜렉티브 협동조합"
                fill
                className="object-contain"
                priority
              />
            </div>
            <span className={`font-serif font-bold text-xl hidden sm:inline transition-colors duration-300 ${getTextColor()}`}>
              경기아트콜렉티브
            </span>
          </Link>

          {/* Desktop Menu */}
          <div className="hidden md:flex items-center space-x-8">
            {menuItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`font-medium transition-colors duration-300 ${
                  pathname === item.href
                    ? getActiveTextColor()
                    : `${getTextColor()} ${getHoverTextColor()}`
                }`}
              >
                {item.label}
              </Link>
            ))}
          </div>

          {/* Mobile Menu Button */}
          <button
            onClick={() => setIsMenuOpen(!isMenuOpen)}
            className={`md:hidden p-2 rounded-md transition-colors duration-300 ${getTextColor()} ${getHoverTextColor()}`}
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
        <div className={`md:hidden transition-all duration-300 overflow-hidden ${
          isMenuOpen ? 'max-h-64 pb-4' : 'max-h-0'
        }`}>
          <div className="bg-white/95 backdrop-blur-md rounded-lg shadow-lg mt-2 p-4">
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
          </div>
        </div>
      </div>
    </nav>
  )
}

export default Navigation
