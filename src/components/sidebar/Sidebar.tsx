import { Plus, PanelLeftClose, PanelLeft, BrainCircuit, BarChart3, BookPlus, Map, Trash2, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Conversation } from '@/types/chat';
import { QuizResult } from '@/types/quiz';
import { Roadmap } from '@/types/roadmap';
import ConversationItem from './ConversationItem';
import { cn } from '@/lib/utils';
import { memo, useCallback, useState, useEffect } from 'react';

type ViewType = 'chat' | 'quiz-setup' | 'quiz' | 'quiz-results' | 'performance' | 'roadmap-setup' | 'roadmap';

interface SidebarProps {
  conversations: Conversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  isOpen: boolean;
  onToggle: () => void;
  currentView?: ViewType;
  onViewChange?: (view: ViewType) => void;
  quizResults?: QuizResult[];
  onSelectQuizResult?: (result: QuizResult) => void;
  roadmaps?: Roadmap[];
  onSelectRoadmap?: (roadmap: Roadmap) => void;
}

const Sidebar = memo(({ 
  conversations, 
  activeId, 
  onSelect, 
  onNew, 
  onDelete,
  isOpen,
  onToggle,
  currentView = 'chat',
  onViewChange,
  quizResults = [],
  onSelectQuizResult,
  roadmaps = [],
  onSelectRoadmap,
}: SidebarProps) => {
  const [historyTab, setHistoryTab] = useState<'chats' | 'quizzes' | 'roadmaps'>('chats');

  // Auto-switch history tab based on current view/mode
  useEffect(() => {
    if (currentView === 'quiz-setup' || currentView === 'quiz' || currentView === 'quiz-results') {
      setHistoryTab('quizzes');
    } else if (currentView === 'roadmap-setup' || currentView === 'roadmap') {
      setHistoryTab('roadmaps');
    } else if (currentView === 'chat') {
      setHistoryTab('chats');
    }
  }, [currentView]);

  const handleOverlayClick = useCallback(() => {
    onToggle();
  }, [onToggle]);

  const handleToggleClick = useCallback(() => {
    onToggle();
  }, [onToggle]);

  return (
    <>
      {/* Mobile overlay */}
      {isOpen && (
        <div 
          className="fixed inset-0 z-40 bg-background/80 backdrop-blur-sm md:hidden"
          onClick={handleOverlayClick}
        />
      )}

      <aside
        className={cn(
          "flex h-full flex-col bg-sidebar/95 backdrop-blur-md border-r border-sidebar-border transition-all duration-300 ease-in-out overflow-hidden",
          isOpen ? "w-64 opacity-100" : "w-0 opacity-0 border-r-0"
        )}
      >
        <div className="flex items-center justify-between p-4">
          <h1 className="text-lg font-semibold gradient-text">NexusAI</h1>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-sidebar-foreground hover:bg-sidebar-accent"
            onClick={handleToggleClick}
          >
            <PanelLeftClose className="h-4 w-4" />
          </Button>
        </div>

        <div className="px-3 space-y-2">
          <Button
            onClick={() => { onNew(); onViewChange?.('chat'); }}
            className="w-full justify-start gap-2 bg-sidebar-accent text-sidebar-accent-foreground hover:bg-sidebar-accent/80"
          >
            <Plus className="h-4 w-4" />
            New Chat
          </Button>

          <Button
            onClick={() => onViewChange?.('quiz-setup')}
            variant={currentView === 'quiz-setup' || currentView === 'quiz' || currentView === 'quiz-results' ? 'default' : 'outline'}
            className={cn(
              "w-full justify-start gap-2",
              (currentView === 'quiz-setup' || currentView === 'quiz' || currentView === 'quiz-results')
                ? "bg-primary text-primary-foreground"
                : "border-sidebar-border text-sidebar-foreground hover:bg-sidebar-accent"
            )}
          >
            <BrainCircuit className="h-4 w-4" />
            Quiz Mode
          </Button>

          <Button
            onClick={() => onViewChange?.('performance')}
            variant={currentView === 'performance' ? 'default' : 'outline'}
            className={cn(
              "w-full justify-start gap-2",
              currentView === 'performance'
                ? "bg-primary text-primary-foreground"
                : "border-sidebar-border text-sidebar-foreground hover:bg-sidebar-accent"
            )}
          >
            <BarChart3 className="h-4 w-4" />
            Performance Tracker
          </Button>

          <Button
            onClick={() => onViewChange?.('roadmap-setup')}
            variant={currentView === 'roadmap-setup' || currentView === 'roadmap' ? 'default' : 'outline'}
            className={cn(
              "w-full justify-start gap-2",
              (currentView === 'roadmap-setup' || currentView === 'roadmap')
                ? "bg-primary text-primary-foreground"
                : "border-sidebar-border text-sidebar-foreground hover:bg-sidebar-accent"
            )}
          >
            <Map className="h-4 w-4" />
            Roadmap
          </Button>

          {(currentView === 'quiz' || currentView === 'quiz-results') && (
            <Button
              onClick={() => onViewChange?.('quiz-setup')}
              variant="outline"
              className="w-full justify-start gap-2 border-sidebar-border text-sidebar-foreground hover:bg-sidebar-accent"
            >
              <BookPlus className="h-4 w-4" />
              New Quiz
            </Button>
          )}
        </div>

        {/* History tabs */}
        <div className="mt-4 px-3">
          <div className="flex rounded-lg bg-sidebar-accent/50 p-0.5">
            {(['chats', 'quizzes', 'roadmaps'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setHistoryTab(tab)}
                className={cn(
                  "flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition-all capitalize",
                  historyTab === tab
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {tab}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-2 flex-1 overflow-y-auto px-3 scrollbar-thin">
          {historyTab === 'chats' && (
            <>
              <p className="mb-2 px-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">Recent Chats</p>
              <div className="space-y-1">
                {conversations && conversations.length > 0 ? (
                  conversations.map((conv) => (
                    <ConversationItem
                      key={conv.id}
                      conversation={conv}
                      isActive={conv.id === activeId && currentView === 'chat'}
                      onClick={() => { onSelect(conv.id); onViewChange?.('chat'); }}
                      onDelete={() => onDelete(conv.id)}
                    />
                  ))
                ) : (
                  <p className="px-3 py-4 text-center text-sm text-muted-foreground">No conversations yet</p>
                )}
              </div>
            </>
          )}

          {historyTab === 'quizzes' && (
            <>
              <p className="mb-2 px-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">Quiz History</p>
              <div className="space-y-1">
                {quizResults.length > 0 ? (
                  quizResults.map((result) => (
                    <button
                      key={result.id}
                      onClick={() => onSelectQuizResult?.(result)}
                      className="w-full flex items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm hover:bg-sidebar-accent transition-colors group"
                    >
                      <BrainCircuit className="h-4 w-4 text-primary shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="truncate font-medium text-sidebar-foreground text-xs">{result.subject}</p>
                        <p className="text-xs text-muted-foreground">
                          {result.obtainedMarks}/{result.totalMarks} marks • {new Date(result.date).toLocaleDateString()}
                        </p>
                      </div>
                    </button>
                  ))
                ) : (
                  <p className="px-3 py-4 text-center text-sm text-muted-foreground">No quizzes taken yet</p>
                )}
              </div>
            </>
          )}

          {historyTab === 'roadmaps' && (
            <>
              <p className="mb-2 px-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">Roadmap History</p>
              <div className="space-y-1">
                {roadmaps.length > 0 ? (
                  roadmaps.map((roadmap) => {
                    const finished = roadmap.lessons.filter(l => l.finished).length;
                    const total = roadmap.lessons.length;
                    return (
                      <button
                        key={roadmap.id}
                        onClick={() => onSelectRoadmap?.(roadmap)}
                        className="w-full flex items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm hover:bg-sidebar-accent transition-colors group"
                      >
                        <Map className="h-4 w-4 text-primary shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="truncate font-medium text-sidebar-foreground text-xs">{roadmap.subject}</p>
                          <p className="text-xs text-muted-foreground">
                            {finished}/{total} lessons • {new Date(roadmap.createdAt).toLocaleDateString()}
                          </p>
                        </div>
                      </button>
                    );
                  })
                ) : (
                  <p className="px-3 py-4 text-center text-sm text-muted-foreground">No roadmaps yet</p>
                )}
              </div>
            </>
          )}
        </div>

        <div className="border-t border-sidebar-border p-4">
          <p className="text-xs text-muted-foreground">
            Powered by AI • Free to use
          </p>
        </div>
      </aside>

      {/* Toggle button when closed */}
      {!isOpen && (
        <Button
          variant="ghost"
          size="icon"
          className="absolute left-4 top-4 z-30 h-10 w-10 bg-secondary/80 backdrop-blur-sm hover:bg-secondary"
          onClick={handleToggleClick}
        >
          <PanelLeft className="h-5 w-5" />
        </Button>
      )}
    </>
  );
});

Sidebar.displayName = 'Sidebar';

export default Sidebar;
