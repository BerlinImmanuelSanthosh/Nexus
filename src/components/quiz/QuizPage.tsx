import { useState, useCallback, useEffect } from 'react';
import { QuizQuestion, QuizAnswer, QuizConfig } from '@/types/quiz';
import QuizTimer from './QuizTimer';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ChevronDown, ChevronUp, AlertTriangle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';

interface QuizPageProps {
  config: QuizConfig;
  questions: QuizQuestion[];
  answers: QuizAnswer[];
  onUpdateAnswer: (questionId: string, answer: Partial<QuizAnswer>) => void;
  onSubmit: () => void;
}

const QuizPage = ({ config, questions, answers, onUpdateAnswer, onSubmit }: QuizPageProps) => {
  const totalSeconds = config.timeHours * 3600 + config.timeMinutes * 60;
  const [expandedQuestion, setExpandedQuestion] = useState<string | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);

  const handleTimeUp = useCallback(() => {
    onSubmit();
  }, [onSubmit]);

  const toggleQuestion = (id: string) => {
    setExpandedQuestion(prev => prev === id ? null : id);
  };

  // Disable copy/paste in real mode
  useEffect(() => {
    if (config.mode !== 'real') return;
    const handler = (e: Event) => { e.preventDefault(); };
    document.addEventListener('copy', handler);
    document.addEventListener('paste', handler);
    document.addEventListener('cut', handler);
    return () => {
      document.removeEventListener('copy', handler);
      document.removeEventListener('paste', handler);
      document.removeEventListener('cut', handler);
    };
  }, [config.mode]);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header with timer */}
      <div className="flex items-center justify-between border-b border-border bg-background/80 px-6 py-3 backdrop-blur-sm">
        <div>
          <h2 className="text-lg font-semibold text-foreground">{config.subject}</h2>
          <p className="text-xs text-muted-foreground">
            {questions.length} questions • {config.mode === 'real' ? 'Real' : 'Normal'} Mode
          </p>
        </div>
        <QuizTimer totalSeconds={totalSeconds} onTimeUp={handleTimeUp} />
      </div>

      {/* Questions */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4 scrollbar-thin">
        {questions.map((q, index) => {
          const answer = answers.find(a => a.questionId === q.id);
          const isExpanded = expandedQuestion === q.id;
          const hasAnswer = q.type === 'mcq' ? !!answer?.selectedOption : !!answer?.textAnswer;

          return (
            <div key={q.id} className="rounded-xl border border-border bg-secondary/30 overflow-hidden transition-all">
              {/* Question header */}
              <button
                onClick={() => q.type === 'written' ? toggleQuestion(q.id) : undefined}
                className={cn(
                  "flex w-full items-center justify-between p-4 text-left",
                  q.type === 'written' && "cursor-pointer hover:bg-secondary/50"
                )}
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-primary/20 text-primary">
                      Q{index + 1}
                    </span>
                    <span className="text-xs text-muted-foreground">{q.marks} mark{q.marks > 1 ? 's' : ''}</span>
                    {hasAnswer && (
                      <span className="text-xs text-primary">✓ Answered</span>
                    )}
                  </div>
                  <p className="text-sm text-foreground">{q.question}</p>
                </div>
                {q.type === 'written' && (
                  isExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                )}
              </button>

              {/* MCQ Options */}
              {q.type === 'mcq' && q.options && (
                <div className="px-4 pb-4 space-y-2">
                  {q.options.map((option, optIdx) => (
                    <button
                      key={optIdx}
                      onClick={() => onUpdateAnswer(q.id, { selectedOption: option })}
                      className={cn(
                        "w-full text-left rounded-lg px-4 py-2.5 text-sm transition-all border",
                        answer?.selectedOption === option
                          ? "border-primary bg-primary/15 text-foreground"
                          : "border-border bg-background hover:border-primary/30 text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              )}

              {/* Written answer - expandable */}
              {q.type === 'written' && (
                <div className={cn(
                  "overflow-hidden transition-all duration-300",
                  isExpanded ? "max-h-[500px] opacity-100" : "max-h-0 opacity-0"
                )}>
                  <div className="px-4 pb-4">
                    <textarea
                      value={answer?.textAnswer || ''}
                      onChange={e => onUpdateAnswer(q.id, { textAnswer: e.target.value })}
                      placeholder={`Write your answer here (minimum ${q.marks * 10} words)...`}
                      className="w-full min-h-[120px] rounded-lg border border-border bg-background px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary/50 focus:outline-none resize-y"
                      onCopy={config.mode === 'real' ? e => e.preventDefault() : undefined}
                      onPaste={config.mode === 'real' ? e => e.preventDefault() : undefined}
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      {(answer?.textAnswer || '').split(/\s+/).filter(Boolean).length} words
                    </p>
                    {/* Drawing canvas placeholder - Phase 2 */}
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {/* Done button */}
        <div className="py-6 flex justify-center">
          <Button
            onClick={() => setShowConfirm(true)}
            className="px-8 h-12 text-base font-semibold rounded-xl bg-primary text-primary-foreground hover:bg-primary/90"
          >
            Done - Submit Quiz
          </Button>
        </div>
      </div>

      {/* Confirmation Dialog */}
      <Dialog open={showConfirm} onOpenChange={setShowConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Submit Quiz?
            </DialogTitle>
            <DialogDescription>
              Are you sure you want to submit? You won't be able to change your answers after this.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowConfirm(false)}>Cancel</Button>
            <Button onClick={onSubmit} className="bg-primary text-primary-foreground">Yes, Submit</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default QuizPage;
