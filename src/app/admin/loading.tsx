export default function AdminLoading() {
  return (
    <div className="min-h-screen pt-24 md:pt-28">
      <div className="container mx-auto px-4">
        <div className="h-8 w-48 bg-gray-200 rounded mb-6 animate-pulse" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="bg-white p-6 rounded-lg shadow-md animate-pulse">
              <div className="h-4 w-24 bg-gray-200 rounded mb-3" />
              <div className="h-8 w-16 bg-gray-300 rounded" />
            </div>
          ))}
        </div>
        <div className="bg-white rounded-lg shadow-md p-6 animate-pulse">
          <div className="space-y-4">
            {[...Array(8)].map((_, i) => (
              <div key={i} className="h-10 bg-gray-200 rounded" />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
