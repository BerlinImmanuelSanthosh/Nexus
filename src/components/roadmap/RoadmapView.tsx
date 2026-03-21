import { memo, useState, useCallback } from 'react';
import { Roadmap, RoadmapResource } from '@/types/roadmap';
import { ArrowLeft, CheckCircle2, Circle, ChevronDown, ChevronUp, Map, ExternalLink, BookOpen, Video, FileText, GraduationCap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';

interface RoadmapViewProps {
  roadmap: Roadmap;
  onBack: () => void;
  onToggleLesson: (roadmapId: string, lessonId: string) => void;
}

const resourceIcon = (type: RoadmapResource['type']) => {
  switch (type) {
    case 'video': return <Video className="h-3.5 w-3.5" />;
    case 'docs': return <FileText className="h-3.5 w-3.5" />;
    case 'tutorial': return <GraduationCap className="h-3.5 w-3.5" />;
    default: return <BookOpen className="h-3.5 w-3.5" />;
  }
};

const resourceColor = (type: RoadmapResource['type']) => {
  switch (type) {
    case 'video': return 'text-red-400 bg-red-500/10 border-red-500/20';
    case 'docs': return 'text-blue-400 bg-blue-500/10 border-blue-500/20';
    case 'tutorial': return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20';
    default: return 'text-amber-400 bg-amber-500/10 border-amber-500/20';
  }
};

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
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onBack}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div className="flex items-center gap-2">
              <Map className="h-5 w-5 text-primary" />
              <h1 className="text-xl font-bold text-foreground">{roadmap.subject}</h1>
            </div>
          </div>
          {/* Progress bar */}
          <div className="flex items-center gap-3 ml-11">
            <div className="flex-1 h-2.5 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-primary to-primary/70 rounded-full transition-all duration-500"
                style={{ width: `${progress}%` }}
              />
            </div>
            <span className="text-sm font-medium text-muted-foreground whitespace-nowrap">
              {completedCount}/{roadmap.lessons.length}
            </span>
          </div>
        </div>
      </div>

      {/* Lessons */}
      <div className="flex-1 overflow-y-auto px-4 py-6 scrollbar-thin">
        <div className="max-w-2xl mx-auto relative">
          {/* Vertical connecting line */}
          <div className="absolute left-[23px] top-6 bottom-6 w-0.5 bg-gradient-to-b from-primary/40 via-border to-border" />

          <div className="space-y-3">
            {roadmap.lessons.map((lesson, index) => (
              <div key={lesson.id} className="relative flex gap-4">
                {/* Node */}
                <div className="relative z-10 flex-shrink-0 mt-4">
                  {lesson.finished ? (
                    <div className="h-12 w-12 rounded-full bg-primary/20 flex items-center justify-center ring-4 ring-background">
                      <CheckCircle2 className="h-7 w-7 text-primary" />
                    </div>
                  ) : (
                    <div className={cn(
                      "h-12 w-12 rounded-full flex items-center justify-center ring-4 ring-background",
                      expandedLesson === lesson.id ? "bg-primary/10" : "bg-muted"
                    )}>
                      <span className={cn(
                        "text-sm font-bold",
                        expandedLesson === lesson.id ? "text-primary" : "text-muted-foreground"
                      )}>
                        {index + 1}
                      </span>
                    </div>
                  )}
                </div>

                {/* Card */}
                <div
                  className={cn(
                    "flex-1 rounded-xl border p-4 transition-all duration-300 cursor-pointer",
                    lesson.finished
                      ? "bg-primary/5 border-primary/30"
                      : "bg-card border-border hover:border-primary/20 hover:shadow-md",
                    expandedLesson === lesson.id && "ring-2 ring-primary/20 shadow-lg"
                  )}
                  onClick={() => handleToggleExpand(lesson.id)}
                >
                  <div className="flex items-center justify-between">
                    <h3 className={cn(
                      "font-semibold text-sm flex-1 min-w-0 truncate",
                      lesson.finished ? "text-primary" : "text-foreground"
                    )}>
                      {lesson.title}
                    </h3>
                    {expandedLesson === lesson.id ? (
                      <ChevronUp className="h-4 w-4 text-muted-foreground flex-shrink-0 ml-2" />
                    ) : (
                      <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0 ml-2" />
                    )}
                  </div>

                  {/* Expanded */}
                  {expandedLesson === lesson.id && (
                    <div className="mt-3 space-y-4 animate-fade-in">
                      <div className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">
                        {lesson.content}
                      </div>

                      {/* Online Resources */}
                      {lesson.resources.length > 0 && (
                        <div className="space-y-2">
                          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                            📚 Online Resources
                          </p>
                          <div className="grid gap-2">
                            {lesson.resources.map((resource, rIdx) => (
                              <a
                                key={rIdx}
                                href={resource.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className={cn(
                                  "flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-medium transition-all hover:scale-[1.02] hover:shadow-sm",
                                  resourceColor(resource.type)
                                )}
                                onClick={(e) => e.stopPropagation()}
                              >
                                {resourceIcon(resource.type)}
                                <span className="flex-1 truncate">{resource.title}</span>
                                <ExternalLink className="h-3 w-3 opacity-50" />
                              </a>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Finished checkbox */}
                      <div
                        className="flex items-center gap-2 pt-3 border-t border-border"
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
