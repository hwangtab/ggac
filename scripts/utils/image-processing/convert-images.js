const fs = require('fs')
const path = require('path')
const sharp = require('sharp')

async function convertWebPtoJPG() {
  const projectsDir = path.join(process.cwd(), 'public/images/projects')
  
  console.log('Converting WebP images to JPG...')
  console.log('Projects directory:', projectsDir)
  
  if (!fs.existsSync(projectsDir)) {
    console.error('Projects directory does not exist:', projectsDir)
    return
  }

  const files = fs.readdirSync(projectsDir)
  console.log('Found files:', files)

  for (const file of files) {
    if (file.endsWith('.webp')) {
      const webpPath = path.join(projectsDir, file)
      const jpgPath = path.join(projectsDir, file.replace('.webp', '.jpg'))
      
      console.log(`Processing: ${file}`)
      
      if (!fs.existsSync(jpgPath)) {
        try {
          await sharp(webpPath)
            .jpeg({ quality: 85 })
            .toFile(jpgPath)
          console.log(`✅ Converted ${file} to JPG`)
        } catch (err) {
          console.error(`❌ Error converting ${file}:`, err)
        }
      } else {
        console.log(`⏭️  JPG already exists for ${file}`)
      }
    }
  }
  
  console.log('Conversion complete!')
}

convertWebPtoJPG().catch(console.error)
