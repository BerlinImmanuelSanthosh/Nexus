import { memo } from 'react';

const TypingIndicator = memo(() => {
  return (
    <div className="flex items-center gap-1.5 px-4 py-3">
      <div className="typing-dot h-2 w-2 rounded-full bg-primary" />
      <div className="typing-dot h-2 w-2 rounded-full bg-primary" />
      <div className="typing-dot h-2 w-2 rounded-full bg-primary" />
    </div>
  );
});

TypingIndicator.displayName = 'TypingIndicator';

export default TypingIndicator;
