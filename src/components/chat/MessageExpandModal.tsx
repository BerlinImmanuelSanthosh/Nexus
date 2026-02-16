import { memo, useState, useCallback } from 'react';
import { Message } from '@/types/chat';
import { Sparkles, User } from 'lucide-react';
import { cn } from '@/lib/utils';

interface MessageExpandModalProps {
  message: Message;
  onClose: () => void;
  onNotUnderstand: (originalMessage: Message) => void;
}

const MessageExpandModal = memo(({ message, onClose, onNotUnderstand }: MessageExpandModalProps) => {
  const [showRobotDialog, setShowRobotDialog] = useState(true);
  const isUser = message.role === 'user';

  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  }, [onClose]);

  const handleYes = useCallback(() => {
    onClose();
  }, [onClose]);

  const handleNo = useCallback(() => {
    setShowRobotDialog(false);
    onNotUnderstand(message);
    onClose();
  }, [message, onNotUnderstand, onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center backdrop-blur-md bg-background/60 animate-fade-in cursor-pointer"
      onClick={handleBackdropClick}
    >
      <div className="flex items-start gap-6 max-w-4xl w-full px-4 cursor-default" onClick={(e) => e.stopPropagation()}>
        {/* Enlarged message */}
        <div className={cn(
          "flex-1 rounded-2xl px-8 py-6 text-base leading-relaxed shadow-2xl shadow-primary/10 border border-border/50 animate-scale-in",
          isUser
            ? "bg-chat-user text-foreground"
            : "bg-chat-ai text-foreground"
        )}>
          <div className="flex items-center gap-3 mb-4">
            {isUser ? (
              <>
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-secondary">
                  <User className="h-4 w-4 text-secondary-foreground" />
                </div>
                <span className="text-sm font-medium text-muted-foreground">You</span>
              </>
            ) : (
              <>
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/20">
                  <Sparkles className="h-4 w-4 text-primary" />
                </div>
                <span className="text-sm font-medium text-muted-foreground">NexusAI</span>
              </>
            )}
          </div>
          <div className="whitespace-pre-wrap text-lg">{message.content}</div>
        </div>

        {/* Robot dialog on the right */}
        {showRobotDialog && (
          <div className="flex flex-col items-center gap-3 animate-fade-in" style={{ animationDelay: '0.3s', animationFillMode: 'backwards' }}>
            {/* Mini robot */}
            <div className="relative">
              <div className="absolute -inset-2 rounded-full bg-primary/15 blur-lg animate-pulse" />
              <div className="relative h-16 w-16 rounded-2xl bg-gradient-to-br from-primary/30 via-primary/20 to-primary/10 border border-primary/40 shadow-lg shadow-primary/20 overflow-hidden flex flex-col items-center justify-center">
                {/* Eyes */}
                <div className="flex gap-2 mb-1.5">
                  <div className="h-3 w-3 rounded-full bg-background/80 border border-primary/50 flex items-center justify-center">
                    <div className="h-1.5 w-1.5 rounded-full bg-primary animate-[lookAround_3s_ease-in-out_infinite]" />
                  </div>
                  <div className="h-3 w-3 rounded-full bg-background/80 border border-primary/50 flex items-center justify-center">
                    <div className="h-1.5 w-1.5 rounded-full bg-primary animate-[lookAround_3s_ease-in-out_infinite]" />
                  </div>
                </div>
                {/* Smile */}
                <div className="w-4 h-2 border-b-2 border-primary/60 rounded-b-full" />
              </div>
            </div>

            {/* Dialog box */}
            <div className="bg-card border border-border rounded-xl p-4 shadow-xl min-w-[160px] text-center">
              <p className="text-sm font-medium text-foreground mb-3">Do you understand?</p>
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
          </div>
        )}
      </div>
    </div>
  );
});

MessageExpandModal.displayName = 'MessageExpandModal';

export default MessageExpandModal;
