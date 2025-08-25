'use client'

import { useEffect, useState, ReactNode } from 'react'
import { createPortal } from 'react-dom'

interface PortalProps {
  children: ReactNode
}

const Portal: React.FC<PortalProps> = ({ children }) => {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)

    // 포털을 위한 div가 없으면 생성
    if (!document.getElementById('portal-root')) {
      const portalRoot = document.createElement('div')
      portalRoot.id = 'portal-root'
      document.body.appendChild(portalRoot)
    }

    return () => setMounted(false)
  }, [])

  if (!mounted) {
    return null
  }

  const container = document.getElementById('portal-root')
  return container ? createPortal(children, container) : null
}

export default Portal
