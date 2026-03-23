import { useState, useCallback, useEffect, useRef } from 'react';
import { QuizQuestion, QuizAnswer, QuizConfig } from '@/types/quiz';
import QuizTimer from './QuizTimer';
import AnswerEditor, { AnswerEditorRef } from './AnswerEditor';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ChevronDown, ChevronUp, AlertTriangle, Sparkles } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { useQuiz } from '@/hooks/useQuiz';
import { QuizResultsBackend as QuizResults } from './QuizResults'; // Import the new component with correct props

interface QuizPageProps {
  config: QuizConfig;
  questions: QuizQuestion[];
  answers: QuizAnswer[];
  onUpdateAnswer: (questionId: string, answer: Partial<QuizAnswer>) => void;
  onSubmit: () => void;
}

const MOTIVATION_MESSAGES = [
  "You're doing great! Keep going! 💪",
  "Stay focused, you've got this! 🎯",
  "Believe in yourself! ✨",
  "Every question counts — give it your best! 🔥",
  "Almost there, keep pushing! 🚀",
  "Great minds think through tough questions! 🧠",
  "You're stronger than you think! 💎",
  "Stay calm and confident! 😊",
  "One step at a time — you'll ace this! 🌟",
  "Hard work pays off — keep it up! 🏆",
];

const QuizPage = ({ config, questions, answers, onUpdateAnswer, onSubmit }: QuizPageProps) => {
  const totalSeconds = config.timeHours * 3600 + config.timeMinutes * 60;
  const [expandedQuestion, setExpandedQuestion] = useState<string | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [motivationMsg, setMotivationMsg] = useState('');
  const [showMotivation, setShowMotivation] = useState(false);

  // One ref per written question to export canvas+text
  const editorRefs = useRef<Record<string, AnswerEditorRef | null>>({});

  // Destructure result and reset as well
  const { submitAnswers, result, reset, loading: submitLoading } = useQuiz();

  // Motivation messages every 10 seconds
  useEffect(() => {
    let msgIndex = 0;
    const show = () => {
      setMotivationMsg(MOTIVATION_MESSAGES[msgIndex % MOTIVATION_MESSAGES.length]);
      setShowMotivation(true);
      msgIndex++;
      setTimeout(() => setShowMotivation(false), 4000);
    };
    show(); // show first immediately
    const interval = setInterval(show, 10000);
    return () => clearInterval(interval);
  }, []);

  const handleTimeUp = useCallback(() => {
    // Flush all editor data before submitting
    questions.forEach(q => {
      if (q.type === 'written') {
        const edRef = editorRefs.current[q.id];
        if (edRef) {
          const { text, canvasData } = edRef.getExportData();
          onUpdateAnswer(q.id, { textAnswer: text, canvasData });
        }
      }
    });
    onSubmit();
  }, [onSubmit, questions, onUpdateAnswer]);

  const handleSubmitConfirmed = useCallback(async () => {
    // 1. Flush all editor data
    questions.forEach(q => {
      if (q.type === 'written') {
        const edRef = editorRefs.current[q.id];
        if (edRef) {
          const { text, canvasData } = edRef.getExportData();
          onUpdateAnswer(q.id, { textAnswer: text, canvasData });
        }
      }
    });

    // 2. Build answers for the evaluation endpoint
    const newAnswers = questions.map(q => {
      const answer = answers.find(a => a.questionId === q.id);
      let studentAnswer = '';
      if (q.type === 'mcq') {
        studentAnswer = answer?.selectedOption || '';
      } else {
        const editor = editorRefs.current[q.id];
        const { text, canvasData } = editor?.getExportData() || { text: '', canvasData: '' };
        studentAnswer = text || '';
        if (canvasData) studentAnswer += `\n[Canvas drawing: ${canvasData.slice(0, 50)}...]`;
      }
      return {
        question_id: q.id,
        question: q.question,
        student_answer: studentAnswer,
        max_marks: q.marks,
      };
    });

    // 3. Call the evaluation endpoint
    try {
      await submitAnswers(newAnswers);
    } catch (error) {
      console.error('Submit error:', error);
      // Optionally show toast error here
    }
    // No onSubmit() call here – result screen will handle navigation
  }, [onSubmit, questions, answers, onUpdateAnswer, submitAnswers]);

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

  // If evaluation is done, show results instead of the quiz
  if (result) {
    return (
      <QuizResults
        result={result}
        onRetry={() => {
          reset();       // clears result in the hook
          onSubmit();    // tells parent to go back to setup
        }}
      />
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden h-full">
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
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4" style={{ minHeight: 0 }}>
        {questions.map((q, index) => {
          const answer = answers.find(a => a.questionId === q.id);
          const isExpanded = expandedQuestion === q.id;
          const hasAnswer = q.type === 'mcq' ? !!answer?.selectedOption : !!(answer?.textAnswer || answer?.canvasData);

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
                  isExpanded
                    ? <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" />
                    : <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
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

              {/* Written answer - expandable with smooth transition */}
              {q.type === 'written' && (
                <div
                  className={cn(
                    "overflow-hidden transition-all duration-300 ease-in-out",
                    isExpanded ? "opacity-100" : "max-h-0 opacity-0"
                  )}
                  style={isExpanded ? { maxHeight: '2000px' } : undefined}
                >
                  <div className="px-4 pb-4">
                    <AnswerEditor
                      ref={(el) => { editorRefs.current[q.id] = el; }}
                      placeholder={`Type or draw your answer (minimum ${q.marks * 10} words in text mode)...`}
                      minWords={q.marks * 10}
                      onCopy={config.mode === 'real' ? e => e.preventDefault() : undefined}
                      onPaste={config.mode === 'real' ? e => e.preventDefault() : undefined}
                    />
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
            disabled={submitLoading}
          >
            {submitLoading ? 'Submitting...' : 'Done — Submit Quiz'}
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
            <Button onClick={handleSubmitConfirmed} className="bg-primary text-primary-foreground">Yes, Submit</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Motivation message - bottom left */}
      <div
        className={cn(
          "fixed bottom-6 left-6 z-50 flex items-center gap-2 px-4 py-3 rounded-xl border border-primary/30 bg-background/95 shadow-lg backdrop-blur-sm transition-all duration-500",
          showMotivation ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4 pointer-events-none"
        )}
      >
        <Sparkles className="h-4 w-4 text-primary shrink-0" />
        <span className="text-sm font-medium text-foreground">{motivationMsg}</span>
      </div>
    </div>
  );
};

export default QuizPage;