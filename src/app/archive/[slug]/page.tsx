import fs from 'fs'
import path from 'path'
import { notFound } from 'next/navigation'
import ProjectDetailContent from './ProjectDetailContent'
import type { Metadata } from 'next'

interface Project {
  id: string; slug: string; title: string; category: string; publishedDate: string;
  coverImage: string; description: string; gallery: string[]; videoUrl: string | null;
  artistIds: string[]; ticketing?: any[];
}

interface Artist {
  id: string; name: string; slug: string;
}

interface ProjectPageProps {
  params: { slug: string }
}

const projectsData: Project[] = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), 'data/projects.json'), 'utf8')
)

const artistsData: Artist[] = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), 'data/artists.json'), 'utf8')
)

export async function generateStaticParams() {
  return projectsData.map((project) => ({ slug: project.slug }))
}

export async function generateMetadata({ params }: ProjectPageProps): Promise<Metadata> {
  const project = projectsData.find(p => p.slug === params.slug)
  if (!project) {
    return { title: '프로젝트를 찾을 수 없음' }
  }

  const ogImageUrl = project.coverImage
    ? `https://ggac.kr${project.coverImage.replace('.webp', '.jpg')}`
    : `https://ggac.kr/images/logo/gac_og.webp`

  return {
    title: `${project.title} | 경기아트콜렉티브 협동조합`,
    description: project.description.split('\n')[0],
    openGraph: {
      title: project.title,
      description: project.description.split('\n')[0],
      images: [{ url: ogImageUrl, width: 1200, height: 630, alt: project.title }],
    },
  }
}

const ProjectDetailPage = ({ params }: ProjectPageProps) => {
  const project = projectsData.find(p => p.slug === params.slug)

  if (!project) {
    notFound()
  }

  const projectWithArtists = {
    ...project,
    participatingArtists: project.artistIds
      .map(id => artistsData.find(artist => artist.id === id))
      .filter(Boolean) as Artist[],
  }

  return <ProjectDetailContent project={projectWithArtists} />
}

export default ProjectDetailPage