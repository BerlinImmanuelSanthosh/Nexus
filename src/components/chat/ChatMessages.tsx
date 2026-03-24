import { useRef, useEffect, memo, useState, useCallback } from 'react';
import { Message, UploadedFile } from '@/types/chat';
import MessageBubble from './MessageBubble';
import MessageExpandModal from './MessageExpandModal';
import { Sparkles } from 'lucide-react';

interface ChatMessagesProps {
  messages: Message[];
  isTyping: boolean;
  uploadedFile?: UploadedFile;
  onClearFile?: () => void;
  onTakeTest?: (question: string) => void;
  onRoadmap?: (subject: string) => void;
}

const ChatMessages = memo(({ messages, isTyping, uploadedFile, onClearFile, onTakeTest, onRoadmap }: ChatMessagesProps) => {
  const bottomRef = useRef<HTMLDivElement>(null);
  const [expandedMessage, setExpandedMessage] = useState<Message | null>(null);
  const [simplifiedContent, setSimplifiedContent] = useState<string>('');
  const [isLoadingSimplified, setIsLoadingSimplified] = useState<boolean>(false);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping]);

  const handleExpand = useCallback(async (message: Message) => {
    if (!message.content || message.role !== 'assistant') {
      setExpandedMessage(message);
      setSimplifiedContent('');
      return;
    }

    setIsLoadingSimplified(true);
    setSimplifiedContent('');
    setExpandedMessage(null);

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
      setSimplifiedContent('');
    } finally {
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
      {isLoadingSimplified && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3 rounded-2xl bg-background/90 px-8 py-6 shadow-xl">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
            <p className="text-sm text-muted-foreground">Simplifying...</p>
          </div>
        </div>
      )}

      <div className="flex flex-1 flex-col gap-6 overflow-y-auto px-4 py-6 scrollbar-thin">
        {/* Uploaded file status indicator - temporarily disabled */}
        {/* {uploadedFile && uploadedFile.filename && (
          ... file status code ...
        )} */}

        {messages.map((message, index) => {
          const isLastAssistant = message.role === 'assistant' && index === messages.length - 1;
          return (
            <MessageBubble
              key={message.id}
              message={message}
              userQuestion={
                message.role === 'assistant'
                  ? messages[index - 1]?.content
                  : undefined
              }
              onExpand={handleExpand}
              onTakeTest={onTakeTest}
              onRoadmap={onRoadmap}
              isStreaming={isLastAssistant && isTyping}
            />
          );
        })}

        {/* Streaming cursor shown while typing and last message is still being built */}
        {isTyping && messages.length > 0 && messages[messages.length - 1]?.role === 'assistant' && (
          <div className="flex gap-4 pl-12">
            <span className="inline-block h-4 w-1 animate-pulse bg-primary rounded-full" />
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {expandedMessage && (
        <MessageExpandModal
          message={
            simplifiedContent
              ? { ...expandedMessage, content: simplifiedContent }
              : expandedMessage
          }
          onClose={handleCloseExpand}
        />
      )}
    </>
  );
});

ChatMessages.displayName = 'ChatMessages';
export default ChatMessages;