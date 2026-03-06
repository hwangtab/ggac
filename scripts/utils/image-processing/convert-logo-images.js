const fs = require('fs')
const path = require('path')
const sharp = require('sharp')

async function convertLogoImages() {
  const logoDir = path.join(process.cwd(), 'public/images/logo')

  console.log('Converting logo WebP images to JPG...')
  console.log('Logo directory:', logoDir)

  if (!fs.existsSync(logoDir)) {
    console.error('Logo directory does not exist:', logoDir)
    return
  }

  const files = fs.readdirSync(logoDir)
  console.log('Found files:', files)

  for (const file of files) {
    if (file.endsWith('.webp')) {
      const webpPath = path.join(logoDir, file)
      const jpgPath = path.join(logoDir, file.replace('.webp', '.jpg'))

      console.log(`Processing: ${file}`)

      if (!fs.existsSync(jpgPath)) {
        try {
          await sharp(webpPath).jpeg({ quality: 90 }).toFile(jpgPath)
          console.log(`✅ Converted ${file} to JPG`)
        } catch (err) {
          console.error(`❌ Error converting ${file}:`, err)
        }
      } else {
        console.log(`⏭️  JPG already exists for ${file}`)
      }
    }
  }

  console.log('Logo conversion complete!')
}

convertLogoImages().catch(console.error)
