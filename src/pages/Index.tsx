import { useState, useCallback, lazy, Suspense } from 'react';
import Sidebar from '@/components/sidebar/Sidebar';
import ChatMessages from '@/components/chat/ChatMessages';
import ChatInput from '@/components/chat/ChatInput';
import { useChat } from '@/hooks/useChat';
import IntroAnimation from '@/components/ui/IntroAnimation';

// Lazy load heavy components
const AnimatedBackground = lazy(() => import('@/components/ui/AnimatedBackground'));

const Index = () => {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [showIntro, setShowIntro] = useState(true);
  
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

  const handleIntroComplete = useCallback(() => {
    setShowIntro(false);
  }, []);

  const handleToggleSidebar = useCallback(() => {
    setSidebarOpen(prev => !prev);
  }, []);

  if (showIntro) {
    return <IntroAnimation onComplete={handleIntroComplete} />;
  }

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
      />

      <main className="flex flex-1 flex-col overflow-hidden">
        <ChatMessages messages={messages} isTyping={isTyping} />
        
        <div className="border-t border-border bg-background/80 p-4 backdrop-blur-sm">
          <div className="mx-auto max-w-3xl">
            <ChatInput onSend={sendMessage} disabled={isTyping} />
            <p className="mt-2 text-center text-xs text-muted-foreground">
              NexusAI can make mistakes. Consider checking important information.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
};

export default Index;
