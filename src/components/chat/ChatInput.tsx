import { useState, useRef, useEffect } from 'react';
import { Send, Mic, MicOff, Plus, X, FileText, FileImage, File as FileIcon } from 'lucide-react';
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
  onFileUpload?: (file: File) => void;
  disabled?: boolean;
}

const ChatInput = ({ onSend, onFileUpload, disabled }: ChatInputProps) => {
  const [input, setInput] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
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
    setInput(prev => prev ? prev + ' ' + spokenText : spokenText);
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


  const handleFileClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const allowedTypes = ['application/pdf', 'image/png', 'image/jpeg', 'image/gif', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      toast.error('Only PDF and image files are supported');
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      toast.error('File must be under 20MB');
      return;
    }
    onFileUpload?.(file);
    toast.success(`Attached: ${file.name}`);
    e.target.value = '';
  };

  return (
    <div className="relative">
      {/* Mic recording indicator */}
      {isRecording && (
        <div className="flex items-center gap-2 mb-2 px-3 py-2 rounded-xl bg-destructive/10 border border-destructive/30 animate-fade-in">
          <div className="h-2.5 w-2.5 rounded-full bg-destructive animate-pulse" />
          <span className="text-xs font-medium text-destructive">Listening… speak now</span>
          <div className="flex gap-0.5 ml-auto">
            {[1,2,3,4,5].map(i => (
              <div key={i} className="w-1 bg-destructive/60 rounded-full animate-pulse" style={{ height: `${8 + Math.random() * 12}px`, animationDelay: `${i * 0.1}s` }} />
            ))}
          </div>
        </div>
      )}
      <div className="flex items-end gap-2 rounded-2xl border border-border bg-secondary/50 p-2 backdrop-blur-sm transition-all focus-within:border-primary/50 focus-within:glow-primary">
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,image/*"
          onChange={handleFileChange}
          className="hidden"
        />
        <Button
          onClick={handleFileClick}
          disabled={disabled}
          size="icon"
          variant="ghost"
          className="h-10 w-10 shrink-0 rounded-xl hover:bg-muted text-muted-foreground hover:text-foreground transition-all"
          title="Attach PDF or image"
        >
          <Plus className="h-4 w-4" />
        </Button>
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            const ta = textareaRef.current;
            if (ta) {
              ta.style.height = 'auto';
              ta.style.height = Math.min(ta.scrollHeight, 160) + 'px';
            }
          }}
          onKeyDown={handleKeyDown}
          placeholder="Message NexusAI..."
          disabled={disabled}
          rows={1}
          className="max-h-[160px] min-h-[44px] flex-1 resize-none bg-transparent px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none disabled:opacity-50 transition-[height] duration-150"
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
    </div>
  );
};

export default ChatInput;
