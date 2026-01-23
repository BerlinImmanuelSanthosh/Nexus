import { MessageSquare, Trash2 } from 'lucide-react';
import { Conversation } from '@/types/chat';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

interface ConversationItemProps {
  conversation: Conversation;
  isActive: boolean;
  onClick: () => void;
  onDelete: () => void;
}

const ConversationItem = ({ conversation, isActive, onClick, onDelete }: ConversationItemProps) => {
  return (
    <div
      className={cn(
        "group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors cursor-pointer",
        isActive 
          ? "bg-sidebar-accent text-sidebar-accent-foreground" 
          : "text-sidebar-foreground hover:bg-sidebar-accent/50"
      )}
      onClick={onClick}
    >
      <MessageSquare className="h-4 w-4 shrink-0 opacity-70" />
      <span className="flex-1 truncate">{conversation.title}</span>
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6 shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
      >
        <Trash2 className="h-3 w-3 text-muted-foreground hover:text-destructive" />
      </Button>
    </div>
  );
};

export default ConversationItem;
