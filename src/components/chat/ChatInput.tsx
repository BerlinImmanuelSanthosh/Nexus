import { useState, useRef, useEffect } from 'react';
import { Send, Mic, MicOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

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

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, [input]);

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

  const handleStartRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 44100,
        },
      });

      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(chunksRef.current, { type: 'audio/webm' });
        stream.getTracks().forEach(track => track.stop());
        
        // For now, we'll show a toast since we don't have speech-to-text backend
        toast.info('Voice recording captured! Speech-to-text requires backend integration.');
        console.log('Audio blob size:', audioBlob.size);
      };

      mediaRecorder.start();
      setIsRecording(true);
      toast.success('Recording started...');
    } catch (error) {
      if ((error as Error).name === 'NotAllowedError') {
        toast.error('Microphone access denied. Check browser permissions.');
      } else {
        toast.error('Failed to start recording.');
        console.error('Recording error:', error);
      }
    }
  };

  const handleStopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      toast.info('Recording stopped.');
    }
  };

  const toggleRecording = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isRecording) {
      handleStopRecording();
    } else {
      handleStartRecording();
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
