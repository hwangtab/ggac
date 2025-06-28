import fs from 'fs'
import path from 'path'

export default function OGTest() {
  const artistsData = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), 'data/artists.json'), 'utf8')
  )

  const baseUrl = process.env.NODE_ENV === 'production' ? 'https://ggac.kr' : 'http://localhost:3000'

  return (
    <div className="container mx-auto p-8">
      <h1 className="text-2xl font-bold mb-6">OG Image Test</h1>
      
      <div className="space-y-8">
        {artistsData.map((artist: any) => {
          const webpPath = artist.profileImage
          const jpgPath = webpPath.replace(/\.webp$/i, '.jpg')
          const publicPath = path.join(process.cwd(), 'public')
          const jpgExists = fs.existsSync(path.join(publicPath, jpgPath))

          return (
            <div key={artist.id} className="border p-4 rounded">
              <h2 className="text-xl font-semibold mb-2">{artist.name}</h2>
              <p className="text-sm text-gray-600 mb-2">Slug: {artist.slug}</p>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <h3 className="font-medium mb-1">WebP Image:</h3>
                  <p className="text-xs mb-2">{webpPath}</p>
                  <img src={webpPath} alt={artist.name} className="w-32 h-32 object-cover" />
                </div>
                
                <div>
                  <h3 className="font-medium mb-1">JPG Image:</h3>
                  <p className="text-xs mb-2">{jpgPath} (Exists: {jpgExists ? 'Yes' : 'No'})</p>
                  {jpgExists && (
                    <img src={jpgPath} alt={artist.name} className="w-32 h-32 object-cover" />
                  )}
                </div>
              </div>
              
              <div className="mt-4 space-y-2">
                <div>
                  <h3 className="font-medium">Page URL:</h3>
                  <a 
                    href={`${baseUrl}/artists/${artist.slug}`} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:underline text-sm"
                  >
                    {baseUrl}/artists/{artist.slug}
                  </a>
                </div>
                
                <div>
                  <h3 className="font-medium">OG Image URL (Dynamic):</h3>
                  <p className="text-sm text-gray-600 break-all">{baseUrl}/api/og/artist/{artist.slug}</p>
                  <img 
                    src={`${baseUrl}/api/og/artist/${artist.slug}`} 
                    alt={`${artist.name} OG`} 
                    className="mt-2 w-full max-w-md border"
                  />
                </div>
                
                <div>
                  <h3 className="font-medium">Static JPG URL:</h3>
                  <p className="text-sm text-gray-600 break-all">{baseUrl}{jpgPath}</p>
                </div>
              </div>
            </div>
          )
        })}
      </div>
      
      <div className="mt-8 p-4 bg-yellow-50 border border-yellow-200 rounded">
        <h2 className="font-bold mb-2">테스트 방법:</h2>
        <ol className="list-decimal list-inside space-y-1 text-sm">
          <li>위 페이지 URL을 복사</li>
          <li>Facebook Debugger: https://developers.facebook.com/tools/debug/</li>
          <li>Twitter Card Validator: https://cards-dev.twitter.com/validator</li>
          <li>LinkedIn Post Inspector: https://www.linkedin.com/post-inspector/</li>
          <li>카카오톡 디버거: https://developers.kakao.com/tool/debugger/sharing</li>
        </ol>
      </div>
    </div>
  )
}