import type { Project } from '@/types'

type ProjectDateFields = Pick<Project, 'publishedDate' | 'eventDate'>

/**
 * 프로젝트를 날짜로 보일 때 쓰는 기준일.
 * 공연·행사는 게시한 날(publishedDate)이 아니라 실제로 열리는 날(eventDate)을 보여야 한다.
 * 공연일이 없는 글(탐방 후기 등)만 발행일로 떨어진다.
 */
export function getProjectDisplayDate(project: ProjectDateFields): string {
  return project.eventDate || project.publishedDate
}
