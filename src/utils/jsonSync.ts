import { writeFile, readFile } from 'fs/promises'
import { join } from 'path'

export interface ArtistJsonData {
  id: string
  slug: string
  name: string
  category: string[]
  profileImage: string
  oneLiner: string
  bio: string
  templateType: string
  portfolioLinks?: Array<{ title: string; url: string }>
  youtubeVideos?: Array<{ title: string; url: string }>
  contact?: string
}

export async function updateArtistInJsonFile(artistId: string, updateData: any) {
  try {
    const jsonPath = join(process.cwd(), 'data', 'artists.json')
    
    // JSON 파일 읽기
    const jsonContent = await readFile(jsonPath, 'utf-8')
    const artists: ArtistJsonData[] = JSON.parse(jsonContent)
    
    // 해당 아티스트 찾기
    const artistIndex = artists.findIndex(artist => artist.id === artistId)
    
    if (artistIndex === -1) {
      console.warn(`Artist with ID ${artistId} not found in JSON file`)
      return false
    }
    
    // 아티스트 정보 업데이트
    const updatedArtist: ArtistJsonData = {
      ...artists[artistIndex],
      name: updateData.name || artists[artistIndex].name,
      category: updateData.category || artists[artistIndex].category,
      oneLiner: updateData.one_liner || artists[artistIndex].oneLiner,
      bio: updateData.bio || artists[artistIndex].bio,
      templateType: updateData.template_type || artists[artistIndex].templateType,
      portfolioLinks: updateData.portfolio_links || artists[artistIndex].portfolioLinks,
      youtubeVideos: updateData.youtube_videos || artists[artistIndex].youtubeVideos,
      contact: updateData.contact || artists[artistIndex].contact
    }
    
    // 프로필 이미지 경로 업데이트 (DB URL을 JSON 형식으로 변환)
    if (updateData.profile_photo_url) {
      // Supabase URL을 정적 이미지 경로로 변환하는 로직 필요
      // 여기서는 기존 경로 유지
      updatedArtist.profileImage = artists[artistIndex].profileImage
    }
    
    artists[artistIndex] = updatedArtist
    
    // JSON 파일 업데이트
    await writeFile(jsonPath, JSON.stringify(artists, null, 2), 'utf-8')
    
    console.log(`Successfully updated artist ${artistId} in JSON file`)
    return true
    
  } catch (error) {
    console.error('Error updating artist in JSON file:', error)
    return false
  }
}

export async function commitAndPushJsonChanges() {
  try {
    // Git add
    const { exec } = require('child_process')
    const { promisify } = require('util')
    const execAsync = promisify(exec)
    
    await execAsync('git add data/artists.json')
    
    // Git commit
    const commitMessage = `chore: Update artist data from mypage edit

🤖 Generated with [Claude Code](https://claude.ai/code)

Co-Authored-By: Claude <noreply@anthropic.com>`
    
    await execAsync(`git commit -m "${commitMessage}"`)
    
    // Git push
    await execAsync('git push')
    
    console.log('Successfully committed and pushed JSON changes')
    return true
    
  } catch (error) {
    console.error('Error committing JSON changes:', error)
    return false
  }
}