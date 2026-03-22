import { useState, useCallback } from 'react';
import { Roadmap, RoadmapLesson } from '@/types/roadmap';

const generateId = () => Math.random().toString(36).substring(2, 15);

// Resource site definitions.
// domain: if set → use Google "site:" search (always works for any topic)
// base:   native search URL (used for video/MOOC sites that work reliably)
const RESOURCE_SITES: Array<{
  name: string;
  domain: string | null;   // google site: domain, or null for native search
  base: string;            // native search base URL
  type: 'article' | 'video' | 'docs' | 'tutorial';
}> = [
  { name: 'W3Schools',      domain: 'w3schools.com',           base: 'https://www.w3schools.com/',                                type: 'tutorial'  },
  { name: 'GeeksforGeeks',  domain: 'geeksforgeeks.org',       base: 'https://www.geeksforgeeks.org/',                            type: 'article'   },
  { name: 'FreeCodeCamp',   domain: 'freecodecamp.org',        base: 'https://www.freecodecamp.org/news/',                        type: 'tutorial'  },
  { name: 'MDN Web Docs',   domain: 'developer.mozilla.org',   base: 'https://developer.mozilla.org/en-US/search?q=',             type: 'docs'      },
  { name: 'TutorialsPoint', domain: 'tutorialspoint.com',      base: 'https://www.tutorialspoint.com/',                           type: 'tutorial'  },
  { name: 'YouTube',        domain: null,                       base: 'https://www.youtube.com/results?search_query=',             type: 'video'     },
  { name: 'Khan Academy',   domain: null,                       base: 'https://www.khanacademy.org/search?page_search_query=',     type: 'video'     },
  { name: 'Codecademy',     domain: 'codecademy.com',          base: 'https://www.codecademy.com/search?query=',                  type: 'tutorial'  },
  { name: 'Real Python',    domain: 'realpython.com',          base: 'https://realpython.com/search/results/?q=',                 type: 'tutorial'  },
  { name: 'Coursera',       domain: null,                       base: 'https://www.coursera.org/search?query=',                    type: 'tutorial'  },
  { name: 'edX',            domain: null,                       base: 'https://www.edx.org/search?q=',                             type: 'tutorial'  },
  { name: 'Javatpoint',     domain: 'javatpoint.com',          base: 'https://www.javatpoint.com/',                               type: 'tutorial'  },
  { name: 'Programiz',      domain: 'programiz.com',           base: 'https://www.programiz.com/search?q=',                       type: 'tutorial'  },
  { name: 'Dev.to',         domain: 'dev.to',                  base: 'https://dev.to/search?q=',                                  type: 'article'   },
  { name: 'Stack Overflow', domain: 'stackoverflow.com',       base: 'https://stackoverflow.com/search?q=',                       type: 'docs'      },
];

/**
 * Build the best URL for a site + query.
 * - Sites with a domain → Google "site:" search (topic-specific, always works)
 * - Video/MOOC sites   → their own native search URL
 */
function makeSiteUrl(domain: string | null, base: string, query: string): string {
  const encoded = encodeURIComponent(query);
  if (domain) {
    // Google site: search guarantees on-topic results for any subject
    return `https://www.google.com/search?q=${encoded}+site%3A${domain}`;
  }
  // Native search for YouTube, Khan Academy, Coursera, edX
  return `${base}${encoded}`;
}

/** Build 15 guaranteed resources for a lesson, always including the subject */
function buildFallbackResources(
  lessonTitle: string,
  subject: string,
): RoadmapLesson['resources'] {
  // Always prefix with subject so "Python Introduction and Basics"
  // not just "Introduction and Basics" → correct site pages
  const query = `${subject} ${lessonTitle}`;
  return RESOURCE_SITES.map(site => ({
    title: `${site.name} — ${lessonTitle}`,
    url:   makeSiteUrl(site.domain, site.base, query),
    type:  site.type,
  }));
}

/** Pad an existing resource list to exactly 15, adding search-URL fallbacks */
function padToFifteen(
  existing: RoadmapLesson['resources'],
  lessonTitle: string,
  subject: string,
): RoadmapLesson['resources'] {
  if (existing.length >= 15) return existing.slice(0, 15);

  const fallbacks  = buildFallbackResources(lessonTitle, subject);
  const usedTitles = new Set(existing.map(r => r.title.toLowerCase()));
  const extras     = fallbacks.filter(fb => !usedTitles.has(fb.title.toLowerCase()));
  const combined   = [...existing, ...extras];
  return combined.slice(0, 15);
}

export function useRoadmap() {
  const [roadmaps, setRoadmaps]         = useState<Roadmap[]>([]);
  const [activeRoadmap, setActiveRoadmap] = useState<Roadmap | null>(null);
  const [isGenerating, setIsGenerating]   = useState(false);

  const generateRoadmap = useCallback(async (subject: string) => {
    setIsGenerating(true);
    try {
      // ── Call the dedicated /api/roadmap endpoint (NOT /api/chat) ──────
      const response = await fetch('http://localhost:8000/api/roadmap', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ subject }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.detail || `HTTP ${response.status}`);
      }

      const data = await response.json();   // { lessons: [...] }
      const rawLessons: Array<{
        title: string;
        content: string;
        resources: Array<{ title: string; url: string; type: string }>;
      }> = data.lessons || [];

      // ── Map backend lessons → RoadmapLesson, guarantee 15 resources ───
      const lessons: RoadmapLesson[] = rawLessons.map(item => {
        const validResources = (item.resources ?? [])
          .filter(r => r.url && r.url !== '#' && r.url.startsWith('http'))
          .map(r => ({
            title: r.title  || 'Resource',
            url:   r.url,
            type:  (['article', 'video', 'docs', 'tutorial'].includes(r.type)
                      ? r.type
                      : 'article') as RoadmapLesson['resources'][number]['type'],
          }));

        return {
          id:        generateId(),
          title:     item.title   || 'Untitled Lesson',
          content:   item.content || '',
          finished:  false,
          // Always pad to exactly 15 resources
          resources: padToFifteen(validResources, item.title, subject),
        };
      });

      // Guard: if somehow we still got nothing, show a generic fallback lesson
      const finalLessons: RoadmapLesson[] =
        lessons.length > 0
          ? lessons
          : [{
              id:        generateId(),
              title:     `Getting Started with ${subject}`,
              content:   `Begin your learning journey with ${subject}. This lesson covers the basics you need to get started.`,
              finished:  false,
              resources: buildFallbackResources(`Getting Started`, subject),
            }];

      const roadmap: Roadmap = {
        id:        generateId(),
        subject,
        lessons:   finalLessons,
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
    const toggle = (lessons: RoadmapLesson[]) =>
      lessons.map(l => l.id === lessonId ? { ...l, finished: !l.finished } : l);

    setRoadmaps(prev =>
      prev.map(r => r.id !== roadmapId ? r : { ...r, lessons: toggle(r.lessons) })
    );
    setActiveRoadmap(prev =>
      !prev || prev.id !== roadmapId ? prev : { ...prev, lessons: toggle(prev.lessons) }
    );
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