export interface RoadmapLesson {
  id: string;
  title: string;
  content: string;
  finished: boolean;
}

export interface Roadmap {
  id: string;
  subject: string;
  lessons: RoadmapLesson[];
  createdAt: Date;
}
