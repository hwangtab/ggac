export default function MypageLoading() {
  return (
    <div className="min-h-screen pt-24 md:pt-28">
      <div className="container mx-auto px-4 max-w-2xl">
        <div className="h-8 w-32 bg-gray-200 rounded mb-6 animate-pulse" />
        <div className="bg-white rounded-lg shadow-md p-6 animate-pulse">
          <div className="flex items-center gap-4 mb-6">
            <div className="w-16 h-16 bg-gray-200 rounded-full" />
            <div>
              <div className="h-5 w-32 bg-gray-200 rounded mb-2" />
              <div className="h-4 w-48 bg-gray-200 rounded" />
            </div>
          </div>
          <div className="space-y-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-12 bg-gray-200 rounded" />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
