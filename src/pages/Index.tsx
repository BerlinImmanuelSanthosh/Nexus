import { useState, useCallback, lazy, Suspense } from 'react';
import Sidebar from '@/components/sidebar/Sidebar';
import ChatMessages from '@/components/chat/ChatMessages';
import ChatInput from '@/components/chat/ChatInput';
import { useChat } from '@/hooks/useChat';
import { useQuiz } from '@/hooks/useQuiz';
import { useRoadmap } from '@/hooks/useRoadmap';
import IntroAnimation from '@/components/ui/IntroAnimation';
import QuizSetup from '@/components/quiz/QuizSetup';
import QuizPage from '@/components/quiz/QuizPage';
import QuizResults from '@/components/quiz/QuizResults';
import PerformanceTracker from '@/components/performance/PerformanceTracker';
import RoadmapSetup from '@/components/roadmap/RoadmapSetup';
import RoadmapView from '@/components/roadmap/RoadmapView';
import { QuizConfig, QuizResult } from '@/types/quiz';
import { cn } from '@/lib/utils';
import { Loader2 } from 'lucide-react';

const AnimatedBackground = lazy(() => import('@/components/ui/AnimatedBackground'));

type ViewType = 'chat' | 'quiz-setup' | 'quiz' | 'quiz-results' | 'performance' | 'roadmap-setup' | 'roadmap';

const Index = () => {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [showIntro, setShowIntro] = useState(true);
  const [currentView, setCurrentView] = useState<ViewType>('chat');
  const [latestResult, setLatestResult] = useState<QuizResult | null>(null);
  const [chatQuestion, setChatQuestion] = useState<string | null>(null);

  const {
    conversations,
    activeConversationId,
    messages,
    isTyping,
    setActiveConversationId,
    createNewConversation,
    sendMessage,
    deleteConversation,
  } = useChat();

  const {
    quizResults,
    currentQuiz,
    isGenerating: isQuizGenerating,
    startQuiz,
    updateAnswer,
    evaluateQuiz,
  } = useQuiz();

  const {
    roadmaps,
    activeRoadmap,
    isGenerating: isRoadmapGenerating,
    generateRoadmap,
    toggleLessonFinished,
    setActiveRoadmap,
  } = useRoadmap();

  const handleIntroComplete = useCallback(() => setShowIntro(false), []);
  const handleToggleSidebar = useCallback(() => setSidebarOpen(prev => !prev), []);

  const handleStartQuiz = useCallback(async (config: QuizConfig) => {
    await startQuiz(config, chatQuestion ?? undefined);
    setChatQuestion(null);
    setCurrentView('quiz');
  }, [startQuiz, chatQuestion]);

  const handleSubmitQuiz = useCallback(async () => {
    const result = await evaluateQuiz();
    if (result) {
      setLatestResult(result);
      setCurrentView('quiz-results');
    }
  }, [evaluateQuiz]);

  const handleViewChange = useCallback((view: ViewType) => {
    setCurrentView(view);
  }, []);

  const handleTakeTestFromChat = useCallback((question: string) => {
    setChatQuestion(question);
    setCurrentView('quiz-setup');
  }, []);

  const handleRoadmapFromChat = useCallback(async (subject: string) => {
    setCurrentView('roadmap');
    await generateRoadmap(subject);
  }, [generateRoadmap]);

  const handleRoadmapGenerate = useCallback(async (subject: string) => {
    setCurrentView('roadmap');
    await generateRoadmap(subject);
  }, [generateRoadmap]);

  if (showIntro) {
    return <IntroAnimation onComplete={handleIntroComplete} />;
  }

  const renderContent = () => {
    switch (currentView) {
      case 'quiz-setup':
        return <QuizSetup onStart={handleStartQuiz} onBack={() => { setCurrentView('chat'); setChatQuestion(null); }} chatQuestion={chatQuestion} />;
      
      case 'quiz':
        if (isQuizGenerating) {
          return (
            <div className="flex flex-1 items-center justify-center">
              <div className="flex flex-col items-center gap-3">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <p className="text-muted-foreground">Generating questions...</p>
              </div>
            </div>
          );
        }
        if (currentQuiz) {
          return (
            <QuizPage
              config={currentQuiz.config}
              questions={currentQuiz.questions}
              answers={currentQuiz.answers}
              onUpdateAnswer={updateAnswer}
              onSubmit={handleSubmitQuiz}
            />
          );
        }
        return null;
      
      case 'quiz-results':
        if (latestResult) {
          return (
            <QuizResults
              result={latestResult}
              onBack={() => setCurrentView('chat')}
              onNewQuiz={() => setCurrentView('quiz-setup')}
            />
          );
        }
        return null;
      
      case 'performance':
        return (
          <PerformanceTracker
            results={quizResults}
            onBack={() => setCurrentView('chat')}
          />
        );

      case 'roadmap-setup':
        return (
          <RoadmapSetup
            onGenerate={handleRoadmapGenerate}
            onBack={() => setCurrentView('chat')}
            isGenerating={isRoadmapGenerating}
          />
        );

      case 'roadmap':
        if (isRoadmapGenerating) {
          return (
            <div className="flex flex-1 items-center justify-center">
              <div className="flex flex-col items-center gap-3">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <p className="text-muted-foreground">Building your roadmap...</p>
              </div>
            </div>
          );
        }
        if (activeRoadmap) {
          return (
            <RoadmapView
              roadmap={activeRoadmap}
              onBack={() => setCurrentView('chat')}
              onToggleLesson={toggleLessonFinished}
            />
          );
        }
        return (
          <RoadmapSetup
            onGenerate={handleRoadmapGenerate}
            onBack={() => setCurrentView('chat')}
            isGenerating={isRoadmapGenerating}
          />
        );
      
      default:
        return (
          <>
            <ChatMessages messages={messages} isTyping={isTyping} onTakeTest={handleTakeTestFromChat} onRoadmap={handleRoadmapFromChat} />
            <div className="border-t border-border bg-background/80 p-4 backdrop-blur-sm">
              <div className={cn(
                "mx-auto transition-all duration-300",
                sidebarOpen ? "max-w-3xl" : "max-w-4xl"
              )}>
                <ChatInput onSend={sendMessage} disabled={isTyping} />
                <p className="mt-2 text-center text-xs text-muted-foreground">
                  NexusAI can make mistakes. Consider checking important information.
                </p>
              </div>
            </div>
          </>
        );
    }
  };

  return (
    <div className="flex h-screen bg-transparent">
      <Suspense fallback={null}>
        <AnimatedBackground />
      </Suspense>
      
      <Sidebar
        conversations={conversations}
        activeId={activeConversationId}
        onSelect={setActiveConversationId}
        onNew={createNewConversation}
        onDelete={deleteConversation}
        isOpen={sidebarOpen}
        onToggle={handleToggleSidebar}
        currentView={currentView}
        onViewChange={handleViewChange}
      />

      <main className="flex flex-1 flex-col overflow-hidden">
        {renderContent()}
      </main>
    </div>
  );
};

export default Index;
