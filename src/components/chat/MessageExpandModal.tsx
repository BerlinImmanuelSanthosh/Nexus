import { memo, useState, useCallback, useMemo } from 'react';
import { Message } from '@/types/chat';
import { Sparkles, User } from 'lucide-react';
import { cn } from '@/lib/utils';

interface MessageExpandModalProps {
  message: Message;
  onClose: () => void;
}

const MessageExpandModal = memo(({ message, onClose }: MessageExpandModalProps) => {
  const [showRobotDialog, setShowRobotDialog] = useState(true);
  const [showReExplain, setShowReExplain] = useState(false);
  const [reExplainContent, setReExplainContent] = useState('');
  const [loading, setLoading] = useState(false);

  const isUser = message.role === 'user';

  // Remove timetable only inside modal
  const cleanedContent = useMemo(() => {
    if (!message.content) return '';
    const scheduleRegex =
      /(Here is a .*study schedule[\s\S]*|Study Plan:[\s\S]*)/i;
    return message.content.replace(scheduleRegex, '').trim();
  }, [message.content]);

  const handleYes = useCallback(() => {
    onClose();
  }, [onClose]);

  const handleNo = useCallback(async () => {
    setShowRobotDialog(false);
    setLoading(true);

    try {
      const response = await fetch('http://localhost:8000/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [
            {
              role: 'user',
              content: `Explain this like I am five years old:\n${cleanedContent}`,
            },
          ],
        }),
      });

      const data = await response.json();
      setReExplainContent(data.response);
      setShowReExplain(true);
    } catch {
      setReExplainContent('Something went wrong while re-explaining.');
      setShowReExplain(true);
    } finally {
      setLoading(false);
    }
  }, [cleanedContent]);

  return (
    <div
      className="fixed inset-0 z-50 bg-background/70 backdrop-blur-md animate-fade-in"
      onClick={onClose}
    >
      <div className="absolute inset-0 overflow-y-auto flex justify-center py-16 px-6">
        
        {/* Message Box */}
        <div
          className={cn(
            'flex-1 max-w-3xl rounded-2xl px-8 py-6 text-base leading-relaxed shadow-2xl border border-border/50 animate-scale-in max-h-[85vh] overflow-y-auto',
            isUser
              ? 'bg-chat-user text-foreground'
              : 'bg-chat-ai text-foreground'
          )}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center gap-3 mb-4">
            {isUser ? (
              <>
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-secondary">
                  <User className="h-4 w-4 text-secondary-foreground" />
                </div>
                <span className="text-sm font-medium text-muted-foreground">
                  You
                </span>
              </>
            ) : (
              <>
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/20">
                  <Sparkles className="h-4 w-4 text-primary" />
                </div>
                <span className="text-sm font-medium text-muted-foreground">
                  NexusAI
                </span>
              </>
            )}
          </div>

          <div
            className="whitespace-pre-wrap text-lg"
            dangerouslySetInnerHTML={{
              __html: showReExplain ? reExplainContent : cleanedContent,
            }}
          />
        </div>

        {/* Robot Panel */}
        <div
          className="ml-6 flex flex-col items-center gap-3 sticky top-8 self-start"
          onClick={(e) => e.stopPropagation()}
        >
          <RobotFace />

          {showRobotDialog && !showReExplain && (
            <div className="bg-card border border-border rounded-xl p-4 shadow-xl min-w-[180px] text-center">
              <p className="text-sm font-medium text-foreground mb-3">
                Do you understand?
              </p>
              <div className="flex gap-2">
                <button
                  onClick={handleYes}
                  className="flex-1 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
                >
                  Yes
                </button>
                <button
                  onClick={handleNo}
                  className="flex-1 px-3 py-1.5 rounded-lg bg-secondary text-secondary-foreground text-sm font-medium hover:bg-secondary/80 transition-colors"
                >
                  No
                </button>
              </div>
            </div>
          )}

          {loading && (
            <div className="bg-card border border-border rounded-xl p-4 shadow-xl min-w-[180px] text-center">
              <p className="text-sm font-medium text-foreground">
                Re-explaining...
              </p>
            </div>
          )}

          {showReExplain && !loading && (
            <div className="bg-card border border-border rounded-xl p-4 shadow-xl min-w-[180px] text-center">
              <p className="text-sm font-medium text-foreground">
                Hope this makes it clearer 🙂
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Bottom Hint Overlay */}
      <div className="pointer-events-none absolute bottom-6 left-1/2 -translate-x-1/2">
        <div className="px-4 py-2 rounded-full bg-card/80 backdrop-blur-sm border border-border text-xs text-muted-foreground shadow-lg">
          Click blank space to close
        </div>
      </div>
    </div>
  );
});

const RobotFace = memo(() => (
  <div className="relative">
    <div className="absolute -inset-2 rounded-full bg-primary/15 blur-lg animate-pulse" />
    <div className="relative h-16 w-16 rounded-2xl bg-gradient-to-br from-primary/30 via-primary/20 to-primary/10 border border-primary/40 shadow-lg overflow-hidden flex flex-col items-center justify-center">
      <div className="flex gap-2 mb-1.5">
        <div className="h-3 w-3 rounded-full bg-background/80 border border-primary/50 flex items-center justify-center">
          <div className="h-1.5 w-1.5 rounded-full bg-primary" />
        </div>
        <div className="h-3 w-3 rounded-full bg-background/80 border border-primary/50 flex items-center justify-center">
          <div className="h-1.5 w-1.5 rounded-full bg-primary" />
        </div>
      </div>
      <div className="w-4 h-2 border-b-2 border-primary/60 rounded-b-full" />
    </div>
  </div>
));

RobotFace.displayName = 'RobotFace';
MessageExpandModal.displayName = 'MessageExpandModal';

export default MessageExpandModal;