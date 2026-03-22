import { Message } from '@/types/chat';
import { User, Sparkles, Copy, Check, ClipboardList, X, Map, FileDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useMemo, memo, useState, useCallback } from 'react';
import jsPDF from 'jspdf';

interface MessageBubbleProps {
  message: Message;
  onExpand?: (message: Message) => void;
  onTakeTest?: (question: string) => void;
  onRoadmap?: (subject: string) => void;
}

const MessageBubble = memo(({ message, onExpand, onTakeTest, onRoadmap }: MessageBubbleProps) => {
  const isUser = message.role === 'user';
  const [copied, setCopied] = useState(false);
  const [enlargedImage, setEnlargedImage] = useState<string | null>(null);

  const formattedContent = useMemo(() => {
    return message.content
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>');
  }, [message.content]);

  const handleCopy = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!message.content) return;

    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = formattedContent;
    const plainText = tempDiv.innerText;
    const cutoffRegex = /Here is a .*study schedule[\s\S]*/i;
    const cleanedText = plainText.replace(cutoffRegex, '').trim();

    await navigator.clipboard.writeText(cleanedText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [formattedContent, message.content]);

  const isGreeting = useMemo(() => {
    const greetings = ['hello', 'hi', 'hey', 'good morning', 'good afternoon', 'good evening', 'howdy', 'greetings', 'how can i help', 'how may i help', 'welcome', 'what can i do', 'how are you'];
    const lower = message.content.toLowerCase().trim();
    return (greetings.some(g => lower.startsWith(g)) && lower.length < 150) ||
           (lower.includes('how can i help') || lower.includes('how may i assist'));
  }, [message.content]);

  const handleClick = useCallback(() => {
    if (isGreeting) return;
    onExpand?.(message);
  }, [message, onExpand, isGreeting]);

  const handleTakeTest = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onTakeTest?.(message.content);
  }, [message.content, onTakeTest]);

  const handleRoadmap = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    // Extract the topic from the conversation - use the user message that triggered this AI response
    // We pass the AI message content to derive the topic
    const plainText = message.content.replace(/<[^>]*>/g, '').replace(/\*\*/g, '');
    const topic = plainText.split(/[.\n]/)[0]?.trim().slice(0, 60) || 'Topic';
    onRoadmap?.(topic);
  }, [message.content, onRoadmap]);

  return (
    <>
      {enlargedImage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm animate-fade-in" onClick={() => setEnlargedImage(null)}>
          <button className="absolute top-4 right-4 text-white/80 hover:text-white" onClick={() => setEnlargedImage(null)}>
            <X className="h-6 w-6" />
          </button>
          <img src={enlargedImage} alt="" className="max-w-[90vw] max-h-[90vh] rounded-xl object-contain shadow-2xl animate-scale-in" />
        </div>
      )}
      <div className={cn("flex flex-col gap-1", isUser ? "items-end" : "items-start")}>
        <div
          className={cn("flex gap-4 animate-fade-in group", isUser ? "justify-end" : "justify-start", isGreeting ? "cursor-default" : "cursor-pointer")}
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
              <div
                className="mb-3 overflow-hidden rounded-xl cursor-zoom-in"
                onClickCapture={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  e.nativeEvent.stopImmediatePropagation();
                  setEnlargedImage(message.imageUrl!);
                }}
              >
                <img
                  src={message.imageUrl}
                  alt=""
                  className="w-full h-40 object-cover hover:opacity-90 transition-opacity pointer-events-none"
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

          {!isUser && !isGreeting && onTakeTest && (
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

        {/* Build Your Roadmap - standalone button below message */}
        {!isUser && !isGreeting && onRoadmap && (
          <div className={cn("px-12", "self-start")}>
            <button
              onClick={handleRoadmap}
              className="flex items-center gap-2 mt-1 px-4 py-2 text-xs font-medium rounded-xl bg-primary/10 text-primary hover:bg-primary/20 border border-primary/20 hover:border-primary/40 transition-all"
            >
              <Map className="h-3.5 w-3.5" />
              <span>Build Your Roadmap</span>
            </button>
          </div>
        )}
      </div>
    </>
  );
});

MessageBubble.displayName = 'MessageBubble';

export default MessageBubble;
