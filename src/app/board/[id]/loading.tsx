'use client'

export default function Loading() {
  return (
    <div className="container mx-auto px-4 pt-24 md:pt-28">
      <div className="max-w-4xl mx-auto">
        <div className="h-6 w-48 bg-gray-200 rounded mb-4 animate-pulse" />
        <div className="bg-white rounded-lg shadow p-6 animate-pulse">
          <div className="w-24 h-5 bg-gray-200 rounded mb-3" />
          <div className="w-3/4 h-8 bg-gray-200 rounded mb-4" />
          <div className="w-full h-24 bg-gray-200 rounded" />
        </div>
      </div>
    </div>
  )
}
