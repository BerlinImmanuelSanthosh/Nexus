import { useState, useCallback, lazy, Suspense } from 'react';
import Sidebar from '@/components/sidebar/Sidebar';
import ChatMessages from '@/components/chat/ChatMessages';
import ChatInput from '@/components/chat/ChatInput';
import { useChat } from '@/hooks/useChat';
import { useQuiz } from '@/hooks/useQuiz';
import IntroAnimation from '@/components/ui/IntroAnimation';
import QuizSetup from '@/components/quiz/QuizSetup';
import QuizPage from '@/components/quiz/QuizPage';
import QuizResults from '@/components/quiz/QuizResults';
import PerformanceTracker from '@/components/performance/PerformanceTracker';
import { QuizConfig, QuizResult } from '@/types/quiz';
import { cn } from '@/lib/utils';
import { Loader2 } from 'lucide-react';

const AnimatedBackground = lazy(() => import('@/components/ui/AnimatedBackground'));

type ViewType = 'chat' | 'quiz-setup' | 'quiz' | 'quiz-results' | 'performance';

const Index = () => {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [showIntro, setShowIntro] = useState(true);
  const [currentView, setCurrentView] = useState<ViewType>('chat');
  const [latestResult, setLatestResult] = useState<QuizResult | null>(null);

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
    isGenerating,
    startQuiz,
    updateAnswer,
    evaluateQuiz,
  } = useQuiz();

  const handleIntroComplete = useCallback(() => setShowIntro(false), []);
  const handleToggleSidebar = useCallback(() => setSidebarOpen(prev => !prev), []);

  const handleStartQuiz = useCallback(async (config: QuizConfig) => {
    await startQuiz(config);
    setCurrentView('quiz');
  }, [startQuiz]);

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
    // Go to quiz setup but pre-fill with the question context
    setCurrentView('quiz-setup');
  }, []);

  if (showIntro) {
    return <IntroAnimation onComplete={handleIntroComplete} />;
  }

  const renderContent = () => {
    switch (currentView) {
      case 'quiz-setup':
        return <QuizSetup onStart={handleStartQuiz} onBack={() => setCurrentView('chat')} />;
      
      case 'quiz':
        if (isGenerating) {
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
      
      default:
        return (
          <>
            <ChatMessages messages={messages} isTyping={isTyping} onTakeTest={handleTakeTestFromChat} />
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
