import { useEffect, useState, memo } from 'react';
import { Sparkles } from 'lucide-react';

interface IntroAnimationProps {
  onComplete: () => void;
}

const IntroAnimation = memo(({ onComplete }: IntroAnimationProps) => {
  const [phase, setPhase] = useState<'enter' | 'display' | 'exit'>('enter');

  useEffect(() => {
    // Enter animation
    const enterTimer = setTimeout(() => setPhase('display'), 100);
    
    // Start exit animation after 2.5s
    const displayTimer = setTimeout(() => setPhase('exit'), 2500);
    
    // Complete after exit animation (0.5s)
    const exitTimer = setTimeout(() => onComplete(), 3000);

    return () => {
      clearTimeout(enterTimer);
      clearTimeout(displayTimer);
      clearTimeout(exitTimer);
    };
  }, [onComplete]);

  return (
    <div
      className={`fixed inset-0 z-[100] flex items-center justify-center bg-background transition-opacity duration-500 ${
        phase === 'exit' ? 'opacity-0' : 'opacity-100'
      }`}
    >
      {/* Animated background elements */}
      <div className="absolute inset-0 overflow-hidden">
        {[...Array(20)].map((_, i) => (
          <div
            key={i}
            className="absolute rounded-full bg-primary/10 animate-pulse"
            style={{
              width: Math.random() * 100 + 50,
              height: Math.random() * 100 + 50,
              left: `${Math.random() * 100}%`,
              top: `${Math.random() * 100}%`,
              animationDelay: `${Math.random() * 2}s`,
              animationDuration: `${2 + Math.random() * 2}s`,
            }}
          />
        ))}
      </div>

      {/* Main logo container */}
      <div
        className={`relative flex flex-col items-center gap-6 transition-all duration-700 ${
          phase === 'enter' ? 'scale-50 opacity-0' : 'scale-100 opacity-100'
        }`}
      >
        {/* Logo icon with glow */}
        <div className="relative">
          <div className="absolute inset-0 blur-2xl bg-primary/50 rounded-full animate-pulse" />
          <div className="relative flex h-24 w-24 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-primary/50 shadow-2xl">
            <Sparkles className="h-12 w-12 text-primary-foreground animate-pulse" />
          </div>
        </div>

        {/* Logo text with gradient */}
        <div className="text-center">
          <h1 className="text-5xl font-bold gradient-text tracking-tight">
            NexusAI
          </h1>
          <p className="mt-2 text-muted-foreground text-lg animate-pulse">
            Your Intelligent Assistant
          </p>
        </div>

        {/* Loading dots */}
        <div className="flex gap-2 mt-4">
          <div className="w-2 h-2 rounded-full bg-primary typing-dot" />
          <div className="w-2 h-2 rounded-full bg-primary typing-dot" />
          <div className="w-2 h-2 rounded-full bg-primary typing-dot" />
        </div>
      </div>
    </div>
  );
});

IntroAnimation.displayName = 'IntroAnimation';

export default IntroAnimation;
