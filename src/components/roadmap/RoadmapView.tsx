import { memo, useState, useCallback } from 'react';
import { Roadmap } from '@/types/roadmap';
import { ArrowLeft, CheckCircle2, Circle, ChevronDown, ChevronUp, Map } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';

interface RoadmapViewProps {
  roadmap: Roadmap;
  onBack: () => void;
  onToggleLesson: (roadmapId: string, lessonId: string) => void;
}

const RoadmapView = memo(({ roadmap, onBack, onToggleLesson }: RoadmapViewProps) => {
  const [expandedLesson, setExpandedLesson] = useState<string | null>(null);

  const handleToggleExpand = useCallback((lessonId: string) => {
    setExpandedLesson(prev => prev === lessonId ? null : lessonId);
  }, []);

  const completedCount = roadmap.lessons.filter(l => l.finished).length;
  const progress = roadmap.lessons.length > 0 ? (completedCount / roadmap.lessons.length) * 100 : 0;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div className="border-b border-border bg-background/80 backdrop-blur-sm p-4">
        <div className="max-w-3xl mx-auto">
          <div className="flex items-center gap-3 mb-3">
            <Button variant="ghost" size="icon" onClick={onBack}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div className="flex items-center gap-2">
              <Map className="h-5 w-5 text-primary" />
              <h1 className="text-xl font-bold text-foreground">{roadmap.subject}</h1>
            </div>
          </div>
          {/* Progress bar */}
          <div className="flex items-center gap-3">
            <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-primary to-primary/70 rounded-full transition-all duration-500"
                style={{ width: `${progress}%` }}
              />
            </div>
            <span className="text-sm text-muted-foreground whitespace-nowrap">
              {completedCount}/{roadmap.lessons.length} completed
            </span>
          </div>
        </div>
      </div>

      {/* Lessons - scrollable roadmap path */}
      <div className="flex-1 overflow-y-auto px-4 py-6 scrollbar-thin">
        <div className="max-w-2xl mx-auto relative">
          {/* Vertical line connecting lessons */}
          <div className="absolute left-6 top-0 bottom-0 w-0.5 bg-border" />

          <div className="space-y-4">
            {roadmap.lessons.map((lesson, index) => (
              <div key={lesson.id} className="relative flex gap-4">
                {/* Node on the line */}
                <div className="relative z-10 flex-shrink-0 mt-4">
                  {lesson.finished ? (
                    <CheckCircle2 className="h-12 w-12 text-primary fill-primary/20" />
                  ) : (
                    <Circle className="h-12 w-12 text-muted-foreground" />
                  )}
                </div>

                {/* Lesson card */}
                <div
                  className={cn(
                    "flex-1 rounded-xl border p-4 transition-all duration-300 cursor-pointer",
                    lesson.finished
                      ? "bg-primary/5 border-primary/30 shadow-sm shadow-primary/10"
                      : "bg-card border-border hover:border-primary/30 hover:shadow-md",
                    expandedLesson === lesson.id && "ring-2 ring-primary/20"
                  )}
                  onClick={() => handleToggleExpand(lesson.id)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <span className={cn(
                        "text-xs font-bold px-2 py-0.5 rounded-full",
                        lesson.finished
                          ? "bg-primary/20 text-primary"
                          : "bg-muted text-muted-foreground"
                      )}>
                        {index + 1}
                      </span>
                      <h3 className={cn(
                        "font-semibold truncate",
                        lesson.finished ? "text-primary" : "text-foreground"
                      )}>
                        {lesson.title}
                      </h3>
                    </div>
                    {expandedLesson === lesson.id ? (
                      <ChevronUp className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                    ) : (
                      <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                    )}
                  </div>

                  {/* Expanded content */}
                  {expandedLesson === lesson.id && (
                    <div className="mt-3 space-y-3 animate-fade-in">
                      <div className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">
                        {lesson.content}
                      </div>
                      <div
                        className="flex items-center gap-2 pt-2 border-t border-border"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Checkbox
                          id={`lesson-${lesson.id}`}
                          checked={lesson.finished}
                          onCheckedChange={() => onToggleLesson(roadmap.id, lesson.id)}
                        />
                        <label
                          htmlFor={`lesson-${lesson.id}`}
                          className={cn(
                            "text-sm cursor-pointer select-none",
                            lesson.finished ? "text-primary font-medium" : "text-muted-foreground"
                          )}
                        >
                          {lesson.finished ? '✅ Finished!' : 'Mark as finished'}
                        </label>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
});

RoadmapView.displayName = 'RoadmapView';
export default RoadmapView;
