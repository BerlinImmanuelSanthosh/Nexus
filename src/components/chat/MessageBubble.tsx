import { Message } from '@/types/chat';
import { User, Sparkles, Copy, Check, ClipboardList } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useMemo, memo, useState, useCallback } from 'react';

interface MessageBubbleProps {
  message: Message;
  onExpand?: (message: Message) => void;
  onTakeTest?: (question: string) => void;
}

const MessageBubble = memo(({ message, onExpand, onTakeTest }: MessageBubbleProps) => {
  const isUser = message.role === 'user';
  const [copied, setCopied] = useState(false);

  const formattedContent = useMemo(() => {
    return message.content
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>');
  }, [message.content]);

  const handleCopy = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    await navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [message.content]);

  const handleClick = useCallback(() => {
    onExpand?.(message);
  }, [message, onExpand]);

  const handleTakeTest = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onTakeTest?.(message.content);
  }, [message.content, onTakeTest]);

  return (
    <div className={cn("flex flex-col gap-1", isUser ? "items-end" : "items-start")}>
      <div
        className={cn("flex gap-4 animate-fade-in cursor-pointer group", isUser ? "justify-end" : "justify-start")}
        onClick={handleClick}
      >
        {!isUser && (
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/20">
            <Sparkles className="h-4 w-4 text-primary" />
          </div>
        )}

        <div
          className={cn(
            "max-w-[70%] rounded-2xl px-4 py-3 text-sm leading-relaxed transition-all duration-200 group-hover:shadow-lg group-hover:shadow-primary/5",
            isUser
              ? "bg-chat-user text-foreground rounded-br-md"
              : "bg-chat-ai text-foreground rounded-bl-md"
          )}
        >
          {message.imageUrl && !isUser && (
            <div className="mb-3 overflow-hidden rounded-xl">
              <img
                src={message.imageUrl}
                alt="Related visual"
                className="w-full h-40 object-cover"
                loading="lazy"
              />
            </div>
          )}
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

      {/* Action buttons */}
      <div className={cn("flex items-center gap-3 px-12", isUser ? "self-end" : "self-start")}>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors py-1"
          title="Copy message"
        >
          {copied ? (
            <><Check className="h-3 w-3 text-primary" /><span className="text-primary">Copied!</span></>
          ) : (
            <><Copy className="h-3 w-3" /><span>Copy</span></>
          )}
        </button>

        {/* Take Test button - only on AI messages */}
        {!isUser && onTakeTest && (
          <button
            onClick={handleTakeTest}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors py-1"
            title="Take a test on this topic"
          >
            <ClipboardList className="h-3 w-3" />
            <span>Take Test</span>
          </button>
        )}
      </div>
    </div>
  );
});

MessageBubble.displayName = 'MessageBubble';

export default MessageBubble;
