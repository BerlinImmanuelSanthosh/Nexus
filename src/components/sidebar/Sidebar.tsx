import { Plus, PanelLeftClose, PanelLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Conversation } from '@/types/chat';
import ConversationItem from './ConversationItem';
import { cn } from '@/lib/utils';
import { memo, useCallback } from 'react';

interface SidebarProps {
  conversations: Conversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  isOpen: boolean;
  onToggle: () => void;
}

const Sidebar = memo(({ 
  conversations, 
  activeId, 
  onSelect, 
  onNew, 
  onDelete,
  isOpen,
  onToggle 
}: SidebarProps) => {
  const handleOverlayClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onToggle();
  }, [onToggle]);

  const handleNewChat = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onNew();
  }, [onNew]);

  return (
    <>
      {/* Mobile overlay */}
      {isOpen && (
        <div 
          className="fixed inset-0 z-40 bg-background/80 backdrop-blur-sm md:hidden"
          onClick={handleOverlayClick}
        />
      )}

      <aside
        className={cn(
          "fixed left-0 top-0 z-50 flex h-full w-64 flex-col bg-sidebar/95 backdrop-blur-md border-r border-sidebar-border transition-transform duration-300 md:relative md:translate-x-0",
          isOpen ? "translate-x-0" : "-translate-x-full"
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4">
          <h1 className="text-lg font-semibold gradient-text">NexusAI</h1>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-sidebar-foreground hover:bg-sidebar-accent"
            onClick={(e) => {
              e.stopPropagation();
              onToggle();
            }}
          >
            <PanelLeftClose className="h-4 w-4" />
          </Button>
        </div>

        <div className="px-3">
          <Button
            onClick={handleNewChat}
            className="w-full justify-start gap-2 bg-sidebar-accent text-sidebar-accent-foreground hover:bg-sidebar-accent/80"
          >
            <Plus className="h-4 w-4" />
            New Chat
          </Button>
        </div>

        <div className="mt-4 flex-1 overflow-y-auto px-3 scrollbar-thin">
          <p className="mb-2 px-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Recent
          </p>
          <div className="space-y-1">
            {conversations && conversations.length > 0 ? (
              conversations.map((conv) => (
                <ConversationItem
                  key={conv.id}
                  conversation={conv}
                  isActive={conv.id === activeId}
                  onClick={() => onSelect(conv.id)}
                  onDelete={() => onDelete(conv.id)}
                />
              ))
            ) : (
              <p className="px-3 py-4 text-center text-sm text-muted-foreground">
                No conversations yet
              </p>
            )}
          </div>
        </div>

        <div className="border-t border-sidebar-border p-4">
          <p className="text-xs text-muted-foreground">
            Powered by AI • Free to use
          </p>
        </div>
      </aside>

      {/* Toggle button when closed */}
      {!isOpen && (
        <Button
          variant="ghost"
          size="icon"
          className="fixed left-4 top-4 z-30 h-10 w-10 bg-secondary/80 backdrop-blur-sm hover:bg-secondary md:absolute"
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
        >
          <PanelLeft className="h-5 w-5" />
        </Button>
      )}
    </>
  );
});

Sidebar.displayName = 'Sidebar';

export default Sidebar;
