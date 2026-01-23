import { useRef, useEffect } from 'react';
import { Message } from '@/types/chat';
import MessageBubble from './MessageBubble';
import TypingIndicator from './TypingIndicator';
import { Sparkles } from 'lucide-react';

interface ChatMessagesProps {
  messages: Message[];
  isTyping: boolean;
}

const ChatMessages = ({ messages, isTyping }: ChatMessagesProps) => {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping]);

  if (messages.length === 0 && !isTyping) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-4">
        <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
          <Sparkles className="h-8 w-8 text-primary" />
        </div>
        <h2 className="mb-2 text-2xl font-semibold text-foreground">How can I help you today?</h2>
        <p className="max-w-md text-center text-muted-foreground">
          I'm NexusAI, your intelligent assistant. Ask me anything and I'll do my best to help users like you.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-6 overflow-y-auto px-4 py-6 scrollbar-thin">
      {messages.map((message) => (
        <MessageBubble key={message.id} message={message} />
      ))}
      {isTyping && (
        <div className="flex gap-4">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/20">
            <Sparkles className="h-4 w-4 text-primary" />
          </div>
          <div className="rounded-2xl rounded-bl-md bg-chat-ai">
            <TypingIndicator />
          </div>
        </div>
      )}
      <div ref={bottomRef} />
    </div>
  );
};

export default ChatMessages;
