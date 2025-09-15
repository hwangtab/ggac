'use client'

import { useEffect, useState } from 'react'
import PostDetailClient from './PostDetailClient'

interface PostDetailClientBridgeProps {
  postId: string
}

export default function PostDetailClientBridge({ postId }: PostDetailClientBridgeProps) {
  const [initialData, setInitialData] = useState<any | undefined>(undefined)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    const load = () => {
      try {
        const el = document.getElementById('initial-post-data')
        if (!el) return null
        const txt = el.textContent || ''
        if (!txt.trim()) return null
        return JSON.parse(txt)
      } catch {
        return null
      }
    }

    let data = load()
    if (data) {
      setInitialData(data)
      setLoaded(true)
      return
    }

    let attempts = 0
    const maxAttempts = 20
    const iv = setInterval(() => {
      attempts++
      data = load()
      if (data || attempts >= maxAttempts) {
        clearInterval(iv)
        if (data) setInitialData(data)
        setLoaded(true)
      }
    }, 100)

    return () => clearInterval(iv)
  }, [postId])

  if (!loaded) {
    return (
      <div className="min-h-screen pt-24 md:pt-28 flex items-center justify-center">
        <div className="text-gray-600">게시글을 로드하는 중...</div>
      </div>
    )
  }

  return <PostDetailClient postId={postId} initialData={initialData} />
}
