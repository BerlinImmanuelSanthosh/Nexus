import { memo } from 'react';

const ThinkingRobot = memo(() => {
  return (
    <div className="flex items-center gap-5 px-5 py-4">
      {/* Robot Container */}
      <div className="relative">
        {/* Outer glow ring */}
        <div className="absolute -inset-3 rounded-full bg-primary/20 blur-xl animate-pulse" />
        
        {/* Rotating orbit ring */}
        <div className="absolute -inset-2 animate-[spin_4s_linear_infinite]">
          <div className="absolute top-0 left-1/2 -translate-x-1/2 h-2 w-2 rounded-full bg-primary/60 blur-[2px]" />
          <div className="absolute bottom-0 left-1/2 -translate-x-1/2 h-1.5 w-1.5 rounded-full bg-primary/40 blur-[1px]" />
        </div>
        
        {/* Robot head container */}
        <div className="relative h-14 w-14">
          {/* Antenna with signal waves */}
          <div className="absolute -top-4 left-1/2 -translate-x-1/2 flex flex-col items-center">
            <div className="relative">
              {/* Signal waves */}
              <div className="absolute -top-2 left-1/2 -translate-x-1/2 h-4 w-4 rounded-full border border-primary/40 animate-[ping_2s_ease-out_infinite]" />
              <div className="absolute -top-1 left-1/2 -translate-x-1/2 h-2 w-2 rounded-full border border-primary/60 animate-[ping_2s_ease-out_infinite_0.5s]" />
              {/* Antenna ball */}
              <div className="relative h-2.5 w-2.5 rounded-full bg-gradient-to-br from-primary to-primary/60 animate-[bounce_1s_ease-in-out_infinite]">
                <div className="absolute inset-0 rounded-full bg-primary/50 animate-ping" />
              </div>
            </div>
            {/* Antenna stem */}
            <div className="h-2 w-0.5 bg-gradient-to-b from-primary to-primary/40" />
          </div>
          
          {/* Main head */}
          <div className="absolute top-2 h-12 w-14 rounded-2xl bg-gradient-to-br from-primary/30 via-primary/20 to-primary/10 border border-primary/40 shadow-lg shadow-primary/20 overflow-hidden">
            {/* Scanning line effect */}
            <div className="absolute inset-0 overflow-hidden">
              <div className="h-1 w-full bg-gradient-to-r from-transparent via-primary/50 to-transparent animate-[scan_2s_ease-in-out_infinite]" />
            </div>
            
            {/* Eyes container */}
            <div className="absolute top-2.5 left-0 right-0 flex justify-center gap-3">
            {/* Left eye */}
              <div className="relative h-4 w-4 rounded-full bg-background/80 border border-primary/50 overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-br from-transparent to-primary/20" />
                <div 
                  className="absolute h-2 w-2 rounded-full bg-gradient-to-br from-primary to-primary/70 animate-[lookAround_3s_ease-in-out_infinite]"
                  style={{ top: '25%', left: '25%' }}
                >
                  <div className="absolute top-0.5 left-0.5 h-1 w-1 rounded-full bg-foreground/60" />
                </div>
              </div>
              {/* Right eye */}
              <div className="relative h-4 w-4 rounded-full bg-background/80 border border-primary/50 overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-br from-transparent to-primary/20" />
                <div 
                  className="absolute h-2 w-2 rounded-full bg-gradient-to-br from-primary to-primary/70 animate-[lookAround_3s_ease-in-out_infinite]"
                  style={{ top: '25%', left: '25%' }}
                >
                  <div className="absolute top-0.5 left-0.5 h-1 w-1 rounded-full bg-foreground/60" />
                </div>
              </div>
            </div>
            
            {/* Processing mouth - animated bars */}
            <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex items-end gap-0.5 h-2">
              <div className="w-1 bg-primary/70 rounded-full animate-[wave_1s_ease-in-out_infinite]" style={{ height: '40%' }} />
              <div className="w-1 bg-primary/70 rounded-full animate-[wave_1s_ease-in-out_infinite_0.1s]" style={{ height: '70%' }} />
              <div className="w-1 bg-primary/70 rounded-full animate-[wave_1s_ease-in-out_infinite_0.2s]" style={{ height: '100%' }} />
              <div className="w-1 bg-primary/70 rounded-full animate-[wave_1s_ease-in-out_infinite_0.3s]" style={{ height: '70%' }} />
              <div className="w-1 bg-primary/70 rounded-full animate-[wave_1s_ease-in-out_infinite_0.4s]" style={{ height: '40%' }} />
            </div>
          </div>
          
          {/* Side ear lights */}
          <div className="absolute top-5 -left-1 h-2 w-1 rounded-full bg-primary/60 animate-[pulse_1.5s_ease-in-out_infinite]" />
          <div className="absolute top-5 -right-1 h-2 w-1 rounded-full bg-primary/60 animate-[pulse_1.5s_ease-in-out_infinite_0.75s]" />
        </div>
      </div>
      
      {/* Text content */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-foreground">NexusAI is thinking</span>
          <div className="flex gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-primary animate-[bounce_1s_ease-in-out_infinite]" />
            <span className="h-1.5 w-1.5 rounded-full bg-primary animate-[bounce_1s_ease-in-out_infinite_0.2s]" />
            <span className="h-1.5 w-1.5 rounded-full bg-primary animate-[bounce_1s_ease-in-out_infinite_0.4s]" />
          </div>
        </div>
        
        {/* Processing bar */}
        <div className="h-1 w-32 rounded-full bg-muted overflow-hidden">
          <div className="h-full w-full bg-gradient-to-r from-primary via-primary/60 to-primary animate-[shimmer_1.5s_ease-in-out_infinite] bg-[length:200%_100%]" />
        </div>
      </div>
    </div>
  );
});

ThinkingRobot.displayName = 'ThinkingRobot';

export default ThinkingRobot;
