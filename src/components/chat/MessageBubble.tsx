import { Message } from '@/types/chat';
import { User, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useMemo } from 'react';

interface MessageBubbleProps {
  message: Message;
}

const MessageBubble = ({ message }: MessageBubbleProps) => {
  const isUser = message.role === 'user';

  // Convert **bold** and *italic* to <strong> and <em>
  // Also preserve <pre> tags from backend (for study schedule)
  const formattedContent = useMemo(() => {
    return message.content
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>');
    // Note: <pre> tags from backend are already valid HTML and will pass through
  }, [message.content]);

  return (
    <div className={cn("flex gap-4 animate-fade-in", isUser ? "justify-end" : "justify-start")}>
      {!isUser && (
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/20">
          <Sparkles className="h-4 w-4 text-primary" />
        </div>
      )}
      
      <div
        className={cn(
          "max-w-[70%] rounded-2xl px-4 py-3 text-sm leading-relaxed",
          isUser 
            ? "bg-chat-user text-foreground rounded-br-md" 
            : "bg-chat-ai text-foreground rounded-bl-md"
        )}
      >
        <div 
          className="whitespace-pre-wrap"
          dangerouslySetInnerHTML={{ __html: formattedContent }} 
        />
      </div>

      {isUser && (
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary">
          <User className="h-4 w-4 text-secondary-foreground" />
        </div>
      )}
    </div>
  );
};

export default MessageBubble;