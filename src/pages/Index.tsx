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
import { toast } from 'sonner';

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
    isUploadingFile,
    setActiveConversationId,
    createNewConversation,
    sendMessage,
    deleteConversation,
    uploadFile,
    checkUploadStatus,
    clearFile,
  } = useChat();

  // Compute activeConversation from conversations and activeConversationId
  const activeConversation = conversations.find(c => c.id === activeConversationId);

  const {
    quizResults,
    currentQuiz,
    isGenerating: isQuizGenerating,
    startQuiz,
    updateAnswer,
    evaluateQuiz,
    setCurrentQuiz,
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

  // ── File upload handler ─────────────────────────
  const handleFileUpload = useCallback(async (file: File) => {
    try {
      await uploadFile(file);
      toast.success(`📄 ${file.name} uploaded successfully`);
    } catch (error) {
      toast.error(`Failed to upload ${file.name}`);
      console.error(error);
    }
  }, [uploadFile]);

  // ── Check file upload status ─────────────────────
  const handleCheckUploadStatus = useCallback(async () => {
    const status = await checkUploadStatus();
    if (status) {
      if (status.processing) {
        toast.info(`⏳ Still processing ${status.filename}...`);
      } else if (status.ready) {
        toast.success(`✅ ${status.filename} ready! (${status.chars_extracted} chars)`);
      } else if (status.error) {
        toast.error(`Error: ${status.error}`);
      }
    }
  }, [checkUploadStatus]);

  // ── Clear file handler ──────────────────────────
  const handleClearFile = useCallback(async () => {
    try {
      await clearFile();
      toast.success('File cleared');
    } catch (error) {
      toast.error('Failed to clear file');
    }
  }, [clearFile]);

  const handleStartQuiz = useCallback(async (config: QuizConfig) => {
    // Stay on quiz-setup while generating (loading shown on button)
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

  const handleSelectQuizResult = useCallback((result: QuizResult) => {
    setLatestResult(result);
    setCurrentView('quiz-results');
  }, []);

  const handleSelectRoadmap = useCallback((roadmap: any) => {
    setActiveRoadmap(roadmap);
    setCurrentView('roadmap');
  }, [setActiveRoadmap]);

  if (showIntro) {
    return <IntroAnimation onComplete={handleIntroComplete} />;
  }

  const renderContent = () => {
    switch (currentView) {
      case 'quiz-setup':
        return (
          <QuizSetup
            onStart={handleStartQuiz}
            onBack={() => { setCurrentView('chat'); setChatQuestion(null); }}
            chatQuestion={chatQuestion}
            isLoading={isQuizGenerating}
          />
        );

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
              onRetryQuiz={() => {
                setCurrentQuiz(null);
                setCurrentView('quiz-setup');
              }}
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
            <ChatMessages
              messages={messages}
              isTyping={isTyping}
              uploadedFile={activeConversation?.uploadedFile}
              onClearFile={handleClearFile}
              onTakeTest={handleTakeTestFromChat}
              onRoadmap={handleRoadmapFromChat}
            />
            <div className="border-t border-border bg-background/80 p-4 backdrop-blur-sm">
              <div className={cn(
                "mx-auto transition-all duration-300",
                sidebarOpen ? "max-w-3xl" : "max-w-4xl"
              )}>
                {/* ── onFileUpload now wired to handleFileUpload ── */}
                <ChatInput
                  onSend={sendMessage}
                  onFileUpload={handleFileUpload}
                  disabled={isTyping}
                />
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
        quizResults={quizResults}
        onSelectQuizResult={handleSelectQuizResult}
        roadmaps={roadmaps}
        onSelectRoadmap={handleSelectRoadmap}
      />

      <main className="flex flex-1 flex-col overflow-hidden">
        {renderContent()}
      </main>
    </div>
  );
};

export default Index;