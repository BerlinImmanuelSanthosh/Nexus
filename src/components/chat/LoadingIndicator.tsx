import { Loader2 } from 'lucide-react';
import { memo } from 'react';

const LoadingIndicator = memo(() => {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <Loader2 className="h-5 w-5 text-primary animate-spin" />
      <span className="text-sm text-muted-foreground animate-pulse">
        Generating response...
      </span>
    </div>
  );
});

LoadingIndicator.displayName = 'LoadingIndicator';

export default LoadingIndicator;
