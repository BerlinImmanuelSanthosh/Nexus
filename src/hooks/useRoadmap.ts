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
              content: `Create a detailed learning roadmap for "${subject}". Return ONLY a valid JSON array (no markdown, no backticks). Each object must have:
- "title": short lesson name
- "content": 2-3 paragraph explanation of what to learn
- "searchQuery": a Google search query to find the best free online resources for this specific lesson (e.g. "python variables tutorial for beginners")
- "resources": an array of 3-4 objects, each with "title" (resource name), "url" (real URL to a popular learning site like w3schools, MDN, freecodecamp, geeksforgeeks, tutorialspoint, youtube, khan academy, codecademy, realpython, etc.), and "type" (one of "article", "video", "docs", "tutorial")

Include 8-12 lessons from beginner to advanced. Use REAL, working URLs from well-known educational websites. Example:
[{"title":"Variables & Data Types","content":"Learn about...","searchQuery":"python variables tutorial","resources":[{"title":"W3Schools Python Variables","url":"https://www.w3schools.com/python/python_variables.asp","type":"tutorial"},{"title":"Python Variables - GeeksforGeeks","url":"https://www.geeksforgeeks.org/python-variables/","type":"article"}]}]`
            }
          ],
          mode: 'simple_english'
        }),
      });

      if (!response.ok) throw new Error('Failed to generate roadmap');

      const data = await response.json();
      const responseText = data.response || '';

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
            resources: (item.resources || []).map((r: any) => ({
              title: r.title || 'Resource',
              url: r.url || '#',
              type: r.type || 'article',
            })),
          }));
        }
      } catch {
        const lines = responseText.split(/\d+\.\s+/).filter(Boolean);
        lessons = lines.slice(0, 12).map((line: string) => ({
          id: generateId(),
          title: line.split('\n')[0]?.trim().replace(/\*\*/g, '') || 'Lesson',
          content: line.trim(),
          finished: false,
          resources: [],
        }));
      }

      if (lessons.length === 0) {
        lessons = [{
          id: generateId(),
          title: `Getting Started with ${subject}`,
          content: responseText.slice(0, 500),
          finished: false,
          resources: [
            { title: `Search: ${subject} tutorial`, url: `https://www.google.com/search?q=${encodeURIComponent(subject + ' tutorial for beginners')}`, type: 'article' },
            { title: `${subject} - W3Schools`, url: `https://www.w3schools.com/`, type: 'tutorial' },
          ],
        }];
      }

      // For any lesson with no resources, add Google search fallback
      lessons = lessons.map(l => ({
        ...l,
        resources: l.resources.length > 0 ? l.resources : [
          { title: `Search: ${l.title}`, url: `https://www.google.com/search?q=${encodeURIComponent(l.title + ' tutorial')}`, type: 'article' as const },
        ],
      }));

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
