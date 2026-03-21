export interface RoadmapResource {
  title: string;
  url: string;
  type: 'article' | 'video' | 'docs' | 'tutorial';
}

export interface RoadmapLesson {
  id: string;
  title: string;
  content: string;
  finished: boolean;
  resources: RoadmapResource[];
}

export interface Roadmap {
  id: string;
  subject: string;
  lessons: RoadmapLesson[];
  createdAt: Date;
}
