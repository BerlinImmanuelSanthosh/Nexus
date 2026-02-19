import { useState, useEffect, useCallback } from 'react';
import { Clock } from 'lucide-react';
import { cn } from '@/lib/utils';

interface QuizTimerProps {
  totalSeconds: number;
  onTimeUp: () => void;
}

const QuizTimer = ({ totalSeconds, onTimeUp }: QuizTimerProps) => {
  const [remaining, setRemaining] = useState(totalSeconds);

  useEffect(() => {
    const interval = setInterval(() => {
      setRemaining(prev => {
        if (prev <= 1) {
          clearInterval(interval);
          onTimeUp();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [totalSeconds, onTimeUp]);

  const hours = Math.floor(remaining / 3600);
  const minutes = Math.floor((remaining % 3600) / 60);
  const seconds = remaining % 60;
  const isLow = remaining < 60;

  const format = (n: number) => n.toString().padStart(2, '0');

  return (
    <div className={cn(
      "flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-mono font-semibold transition-colors",
      isLow ? "bg-destructive/20 text-destructive animate-pulse" : "bg-secondary text-foreground"
    )}>
      <Clock className="h-4 w-4" />
      {hours > 0 && <span>{format(hours)}:</span>}
      <span>{format(minutes)}:{format(seconds)}</span>
    </div>
  );
};

export default QuizTimer;
