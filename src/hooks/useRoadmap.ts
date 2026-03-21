import { useState, useCallback } from 'react';
import { Roadmap, RoadmapLesson } from '@/types/roadmap';

const generateId = () => Math.random().toString(36).substring(2, 15);

export function useRoadmap() {
  const [roadmaps, setRoadmaps] = useState<Roadmap[]>([]);
  const [activeRoadmap, setActiveRoadmap] = useState<Roadmap | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  const generateRoadmap = useCallback(async (subject: string) => {
    setIsGenerating(true);
    try {
      const response = await fetch('http://localhost:8000/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [
            {
              role: 'user',
              content: `Create a detailed learning roadmap for "${subject}". Return ONLY a JSON array of lesson objects. Each object must have "title" (short lesson name) and "content" (2-3 paragraph explanation of what to learn in this lesson). Include 8-12 lessons that progressively build knowledge from beginner to advanced. Example format: [{"title":"Introduction to ${subject}","content":"..."},{"title":"...","content":"..."}]`
            }
          ],
          mode: 'simple_english'
        }),
      });

      if (!response.ok) throw new Error('Failed to generate roadmap');

      const data = await response.json();
      const responseText = data.response || '';

      // Extract JSON array from response
      let lessons: RoadmapLesson[] = [];
      try {
        const jsonMatch = responseText.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          lessons = parsed.map((item: any) => ({
            id: generateId(),
            title: item.title || 'Untitled Lesson',
            content: item.content || '',
            finished: false,
          }));
        }
      } catch {
        // Fallback: split by numbered items
        const lines = responseText.split(/\d+\.\s+/).filter(Boolean);
        lessons = lines.slice(0, 12).map((line: string) => ({
          id: generateId(),
          title: line.split('\n')[0]?.trim().replace(/\*\*/g, '') || 'Lesson',
          content: line.trim(),
          finished: false,
        }));
      }

      if (lessons.length === 0) {
        lessons = [{
          id: generateId(),
          title: `Getting Started with ${subject}`,
          content: responseText.slice(0, 500),
          finished: false,
        }];
      }

      const roadmap: Roadmap = {
        id: generateId(),
        subject,
        lessons,
        createdAt: new Date(),
      };

      setRoadmaps(prev => [roadmap, ...prev]);
      setActiveRoadmap(roadmap);
      return roadmap;
    } catch (error) {
      console.error('Roadmap generation error:', error);
      return null;
    } finally {
      setIsGenerating(false);
    }
  }, []);

  const toggleLessonFinished = useCallback((roadmapId: string, lessonId: string) => {
    setRoadmaps(prev => prev.map(r => {
      if (r.id !== roadmapId) return r;
      return {
        ...r,
        lessons: r.lessons.map(l =>
          l.id === lessonId ? { ...l, finished: !l.finished } : l
        ),
      };
    }));
    setActiveRoadmap(prev => {
      if (!prev || prev.id !== roadmapId) return prev;
      return {
        ...prev,
        lessons: prev.lessons.map(l =>
          l.id === lessonId ? { ...l, finished: !l.finished } : l
        ),
      };
    });
  }, []);

  return {
    roadmaps,
    activeRoadmap,
    isGenerating,
    setActiveRoadmap,
    generateRoadmap,
    toggleLessonFinished,
  };
}
