import { useRef, useEffect, memo, useState, useCallback } from 'react';
import { Message } from '@/types/chat';
import MessageBubble from './MessageBubble';
import ThinkingRobot from './ThinkingRobot';
import MessageExpandModal from './MessageExpandModal';
import { Sparkles } from 'lucide-react';

interface ChatMessagesProps {
  messages: Message[];
  isTyping: boolean;
  onTakeTest?: (question: string) => void;
}

const ChatMessages = memo(({ messages, isTyping, onTakeTest }: ChatMessagesProps) => {
  const bottomRef = useRef<HTMLDivElement>(null);

  // Original expanded message state (the clicked message itself)
  const [expandedMessage, setExpandedMessage] = useState<Message | null>(null);

  // NEW: state for the short 300-400 word response fetched from backend
  const [simplifiedContent, setSimplifiedContent] = useState<string>('');
  const [isLoadingSimplified, setIsLoadingSimplified] = useState<boolean>(false);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping]);

  // NEW: when user clicks a message bubble, call /api/teach-simple with
  // the clicked message as "previous_response" so backend compresses it
  // into a fresh 300-400 word summary — NOT the same text repeated.
  const handleExpand = useCallback(async (message: Message) => {
    // For non-AI messages, open modal immediately as before
    if (!message.content || message.role !== 'assistant') {
      setExpandedMessage(message);
      setSimplifiedContent('');
      return;
    }

    // Show loading state BEFORE opening modal so original message never flashes
    setIsLoadingSimplified(true);
    setSimplifiedContent('');
    setExpandedMessage(null); // keep modal closed while fetching

    try {
      const res = await fetch('http://localhost:8000/api/teach-simple', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: message.content.replace(/<[^>]*>/g, '').slice(0, 80).trim(),
          language: 'en',
          previous_response: message.content,
        }),
      });

      if (!res.ok) throw new Error(`API error: ${res.status}`);

      const data = await res.json();
      setSimplifiedContent(data.response || '');
    } catch (err) {
      console.error('teach-simple error:', err);
      setSimplifiedContent(''); // fallback: modal will show original
    } finally {
      // NOW open the modal — content is ready, no flash
      setExpandedMessage(message);
      setIsLoadingSimplified(false);
    }
  }, []);

  const handleCloseExpand = useCallback(() => {
    setExpandedMessage(null);
    setSimplifiedContent('');
    setIsLoadingSimplified(false);
  }, []);

  if (messages.length === 0 && !isTyping) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-4">
        <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 animate-pulse">
          <Sparkles className="h-8 w-8 text-primary" />
        </div>
        <h2 className="mb-2 text-2xl font-semibold text-foreground">How can I help you today?</h2>
        <p className="max-w-md text-center text-muted-foreground">
          I'm NexusAI, your intelligent study companion. Ask me anything and I'll do my best to help you.
        </p>
      </div>
    );
  }

  return (
    <>
      {/* Subtle full-screen loading overlay while fetching simplified response */}
      {isLoadingSimplified && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3 rounded-2xl bg-background/90 px-8 py-6 shadow-xl">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
            <p className="text-sm text-muted-foreground">Simplifying...</p>
          </div>
        </div>
      )}
      <div className="flex flex-1 flex-col gap-6 overflow-y-auto px-4 py-6 scrollbar-thin">
        {messages.map((message) => (
          <MessageBubble
            key={message.id}
            message={message}
            onExpand={handleExpand}
            onTakeTest={onTakeTest}
          />
        ))}
        {isTyping && (
          <div className="flex gap-4 animate-fade-in">
            <div className="rounded-2xl rounded-bl-md bg-chat-ai">
              <ThinkingRobot />
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Modal: shows the short 300-400 word summary from backend,
          OR a loading state while fetching,
          OR falls back to the original message if fetch failed */}
      {expandedMessage && (
        <MessageExpandModal
          message={
            // If we have a simplified response, override the modal content
            // by creating a shallow copy of the message with new content
            simplifiedContent
              ? { ...expandedMessage, content: simplifiedContent }
              : expandedMessage
          }
          onClose={handleCloseExpand}
          // Pass loading flag so modal can show a spinner if it supports it
          isLoading={isLoadingSimplified}
        />
      )}
    </>
  );
});

ChatMessages.displayName = 'ChatMessages';

export default ChatMessages;