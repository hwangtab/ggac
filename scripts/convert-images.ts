import fs from 'fs'
import path from 'path'
import sharp from 'sharp'

async function convertWebPtoJPG() {
  const projectsDir = path.join(process.cwd(), 'public/images/projects')
  const files = fs.readdirSync(projectsDir)

  for (const file of files) {
    if (file.endsWith('.webp')) {
      const webpPath = path.join(projectsDir, file)
      const jpgPath = path.join(projectsDir, file.replace('.webp', '.jpg'))
      
      if (!fs.existsSync(jpgPath)) {
        try {
          await sharp(webpPath)
            .jpeg({ quality: 80 })
            .toFile(jpgPath)
          console.log(`Converted ${file} to JPG`)
        } catch (err) {
          console.error(`Error converting ${file}:`, err)
        }
      }
    }
  }
}

convertWebPtoJPG().catch(console.error)