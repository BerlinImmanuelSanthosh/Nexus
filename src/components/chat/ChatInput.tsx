import { useState, useRef, useEffect } from 'react';
import { Send, Mic, MicOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
declare global {
  interface Window {
    webkitSpeechRecognition: any;
    SpeechRecognition: any;
  }
}



interface ChatInputProps {
  onSend: (message: string) => void;
  disabled?: boolean;
}

const ChatInput = ({ onSend, disabled }: ChatInputProps) => {
  const [input, setInput] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recognitionRef = useRef<any>(null);
  const isListeningRef = useRef(false);

  useEffect(() => {
  const SpeechRecognition =
    window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!SpeechRecognition) {
    toast.error('Speech recognition not supported');
    return;
  }

  const recognition = new SpeechRecognition();
  recognition.lang = 'en-US';
  recognition.interimResults = false;
  recognition.continuous = false;

  recognition.onstart = () => {
    isListeningRef.current = true;
    console.log('🎤 Listening started');
  };

  recognition.onresult = (event: any) => {
    const transcript = event.results[0][0].transcript;
    setInput(transcript);
  };

  recognition.onerror = (event: any) => {
    console.error('Speech error:', event.error);
    toast.error(`Voice error: ${event.error}`);
    isListeningRef.current = false;
  };

  recognition.onend = () => {
    isListeningRef.current = false;
    console.log('🎤 Listening stopped');
  };

  recognitionRef.current = recognition;
}, []);



  const handleSubmit = () => {
    if (input.trim() && !disabled) {
      onSend(input.trim());
      setInput('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleStartRecording = () => {
  const SpeechRecognition =
    window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!SpeechRecognition) {
    toast.error('Speech recognition not supported in this browser');
    return;
  }

  const recognition = new SpeechRecognition();
  recognitionRef.current = recognition;

  recognition.lang = 'en-US';
  recognition.interimResults = false;
  recognition.continuous = false;

  recognition.onresult = (event) => {
    const spokenText = event.results[0][0].transcript;

    const improvedPrompt = `Give detailed beginner-friendly notes on ${spokenText}`;

    onSend(improvedPrompt);   // 🔥 SEND TO AI
    setInput('');
  };

  recognition.onerror = () => {
    toast.error('Voice recognition failed');
    setIsRecording(false);
  };

  recognition.onend = () => {
    setIsRecording(false);
  };

  recognition.start();
  setIsRecording(true);
  toast.success('Listening...');
  };


  const handleStopRecording = () => {
   recognitionRef.current?.stop();
   setIsRecording(false);
  };
  const toggleRecording = () => {
  if (!recognitionRef.current) {
    toast.error('Speech recognition not ready');
    return;
  }

  try {
    if (isListeningRef.current) {
      recognitionRef.current.stop();
    } else {
      recognitionRef.current.start(); // 👈 MUST be here
    }
  } catch (err) {
    console.error(err);
    toast.error('Voice recognition failed');
  }
};


  return (
    <div className="relative flex items-end gap-2 rounded-2xl border border-border bg-secondary/50 p-2 backdrop-blur-sm transition-all focus-within:border-primary/50 focus-within:glow-primary">
      <textarea
        ref={textareaRef}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Message NexusAI..."
        disabled={disabled}
        rows={1}
        className="max-h-[200px] min-h-[44px] flex-1 resize-none bg-transparent px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none disabled:opacity-50"
      />
      <Button
        onClick={toggleRecording}
        disabled={disabled}
        size="icon"
        variant="ghost"
        className={cn(
          "h-10 w-10 shrink-0 rounded-xl transition-all",
          isRecording 
            ? "bg-destructive text-destructive-foreground animate-pulse" 
            : "hover:bg-muted text-muted-foreground hover:text-foreground"
        )}
      >
        {isRecording ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
      </Button>
      <Button
        onClick={handleSubmit}
        disabled={!input.trim() || disabled}
        size="icon"
        className={cn(
          "h-10 w-10 shrink-0 rounded-xl transition-all",
          input.trim() 
            ? "bg-primary text-primary-foreground hover:bg-primary/90" 
            : "bg-muted text-muted-foreground"
        )}
      >
        <Send className="h-4 w-4" />
      </Button>
    </div>
  );
};

export default ChatInput;
