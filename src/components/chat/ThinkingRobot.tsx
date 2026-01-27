import { memo } from 'react';

const ThinkingRobot = memo(() => {
  return (
    <div className="flex items-center gap-4 px-4 py-3">
      <div className="relative">
        {/* Robot head */}
        <div className="relative h-12 w-12">
          {/* Antenna */}
          <div className="absolute -top-2 left-1/2 -translate-x-1/2">
            <div className="h-3 w-0.5 bg-primary animate-pulse" />
            <div className="absolute -top-1 left-1/2 -translate-x-1/2 h-2 w-2 rounded-full bg-primary animate-ping" />
          </div>
          
          {/* Head */}
          <div className="absolute top-1 h-10 w-12 rounded-xl bg-gradient-to-b from-primary/30 to-primary/10 border border-primary/40 overflow-hidden">
            {/* Eyes container */}
            <div className="absolute top-2 left-0 right-0 flex justify-center gap-2">
              {/* Left eye */}
              <div className="relative h-3 w-3 rounded-full bg-background border border-primary/60">
                <div className="absolute h-1.5 w-1.5 rounded-full bg-primary animate-[bounce_1s_ease-in-out_infinite]" 
                     style={{ top: '25%', left: '25%' }} />
              </div>
              {/* Right eye */}
              <div className="relative h-3 w-3 rounded-full bg-background border border-primary/60">
                <div className="absolute h-1.5 w-1.5 rounded-full bg-primary animate-[bounce_1s_ease-in-out_infinite_0.1s]"
                     style={{ top: '25%', left: '25%' }} />
              </div>
            </div>
            
            {/* Mouth - thinking expression */}
            <div className="absolute bottom-2 left-1/2 -translate-x-1/2 w-4 h-1 rounded-full bg-primary/60 animate-pulse" />
          </div>
          
          {/* Glow effect */}
          <div className="absolute inset-0 rounded-xl bg-primary/20 blur-md animate-pulse" />
        </div>
      </div>
      
      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium text-foreground">NexusAI is thinking</span>
        <div className="flex items-center gap-1">
          <div className="typing-dot h-1.5 w-1.5 rounded-full bg-primary" />
          <div className="typing-dot h-1.5 w-1.5 rounded-full bg-primary" />
          <div className="typing-dot h-1.5 w-1.5 rounded-full bg-primary" />
        </div>
      </div>
    </div>
  );
});

ThinkingRobot.displayName = 'ThinkingRobot';

export default ThinkingRobot;
