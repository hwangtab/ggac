import { getProjects } from '../src/lib/data'

const projects = await getProjects()
console.log(projects.map(p => ({slug: p.slug, cover: p.coverImage})))
