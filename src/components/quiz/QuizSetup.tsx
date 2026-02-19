import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { QuizConfig, QuestionConfig } from '@/types/quiz';
import { ArrowLeft, Plus, Trash2, Clock, BookOpen } from 'lucide-react';
import { cn } from '@/lib/utils';

interface QuizSetupProps {
  onStart: (config: QuizConfig) => void;
  onBack: () => void;
}

const QuizSetup = ({ onStart, onBack }: QuizSetupProps) => {
  const [subject, setSubject] = useState('');
  const [questions, setQuestions] = useState<QuestionConfig[]>([{ marks: 1, count: 5 }]);
  const [timeHours, setTimeHours] = useState(0);
  const [timeMinutes, setTimeMinutes] = useState(30);
  const [mode, setMode] = useState<'normal' | 'real'>('normal');

  const totalMarks = questions.reduce((sum, q) => sum + q.marks * q.count, 0);
  const totalQuestions = questions.reduce((sum, q) => sum + q.count, 0);

  const addQuestionType = () => {
    setQuestions(prev => [...prev, { marks: 2, count: 3 }]);
  };

  const removeQuestionType = (index: number) => {
    setQuestions(prev => prev.filter((_, i) => i !== index));
  };

  const updateQuestion = (index: number, field: keyof QuestionConfig, value: number) => {
    setQuestions(prev => prev.map((q, i) => i === index ? { ...q, [field]: value } : q));
  };

  const handleStart = () => {
    if (!subject.trim()) return;
    if (timeHours === 0 && timeMinutes === 0) return;
    onStart({ subject, questions, timeHours, timeMinutes, mode });
  };

  return (
    <div className="flex flex-1 flex-col items-center justify-center p-6 overflow-y-auto">
      <div className="w-full max-w-lg space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={onBack} className="shrink-0">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h2 className="text-2xl font-bold text-foreground">Quiz Setup</h2>
            <p className="text-sm text-muted-foreground">Configure your quiz parameters</p>
          </div>
        </div>

        {/* Subject */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-primary" />
            Subject
          </label>
          <input
            type="text"
            value={subject}
            onChange={e => setSubject(e.target.value)}
            placeholder="e.g. Physics, Mathematics, History..."
            className="w-full rounded-xl border border-border bg-secondary/50 px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary/50 focus:outline-none"
          />
        </div>

        {/* Questions */}
        <div className="space-y-3">
          <label className="text-sm font-medium text-foreground">Questions</label>
          {questions.map((q, i) => (
            <div key={i} className="flex items-center gap-3 rounded-xl border border-border bg-secondary/30 p-3">
              <div className="flex-1 space-y-1">
                <div className="flex gap-3">
                  <div className="flex-1">
                    <label className="text-xs text-muted-foreground">Marks each</label>
                    <input
                      type="number"
                      min={1}
                      max={20}
                      value={q.marks}
                      onChange={e => updateQuestion(i, 'marks', parseInt(e.target.value) || 1)}
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary/50 focus:outline-none"
                    />
                  </div>
                  <div className="flex-1">
                    <label className="text-xs text-muted-foreground">No. of questions</label>
                    <input
                      type="number"
                      min={1}
                      max={50}
                      value={q.count}
                      onChange={e => updateQuestion(i, 'count', parseInt(e.target.value) || 1)}
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary/50 focus:outline-none"
                    />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  {q.marks === 1 ? '4 choices (MCQ)' : `Written answer (min ${q.marks * 10} words)`}
                </p>
              </div>
              {questions.length > 1 && (
                <Button variant="ghost" size="icon" onClick={() => removeQuestionType(i)} className="shrink-0 text-destructive hover:text-destructive">
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
          ))}
          <Button variant="outline" onClick={addQuestionType} className="w-full gap-2">
            <Plus className="h-4 w-4" /> Add Question Type
          </Button>
        </div>

        {/* Total Marks */}
        <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 text-center">
          <p className="text-sm text-muted-foreground">Total</p>
          <p className="text-2xl font-bold gradient-text">{totalQuestions} Questions • {totalMarks} Marks</p>
        </div>

        {/* Time */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground flex items-center gap-2">
            <Clock className="h-4 w-4 text-primary" />
            Time Limit
          </label>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="text-xs text-muted-foreground">Hours</label>
              <input
                type="number"
                min={0}
                max={5}
                value={timeHours}
                onChange={e => setTimeHours(parseInt(e.target.value) || 0)}
                className="w-full rounded-lg border border-border bg-secondary/50 px-3 py-2 text-sm text-foreground focus:border-primary/50 focus:outline-none"
              />
            </div>
            <div className="flex-1">
              <label className="text-xs text-muted-foreground">Minutes</label>
              <input
                type="number"
                min={0}
                max={59}
                value={timeMinutes}
                onChange={e => setTimeMinutes(parseInt(e.target.value) || 0)}
                className="w-full rounded-lg border border-border bg-secondary/50 px-3 py-2 text-sm text-foreground focus:border-primary/50 focus:outline-none"
              />
            </div>
          </div>
        </div>

        {/* Mode */}
        <div className="space-y-3">
          <label className="text-sm font-medium text-foreground">Mode</label>
          <div className="flex gap-3">
            <button
              onClick={() => setMode('normal')}
              className={cn(
                "flex-1 rounded-xl border p-4 text-left transition-all",
                mode === 'normal'
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border bg-secondary/30 text-muted-foreground hover:border-primary/30"
              )}
            >
              <p className="font-medium text-sm">Normal Mode</p>
              <p className="text-xs mt-1 opacity-70">Copy & paste allowed</p>
            </button>
            <button
              onClick={() => setMode('real')}
              className={cn(
                "flex-1 rounded-xl border p-4 text-left transition-all",
                mode === 'real'
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border bg-secondary/30 text-muted-foreground hover:border-primary/30"
              )}
            >
              <p className="font-medium text-sm">Real Mode</p>
              <p className="text-xs mt-1 opacity-70">No copy & paste</p>
            </button>
          </div>
        </div>

        {/* Start Button */}
        <Button
          onClick={handleStart}
          disabled={!subject.trim() || (timeHours === 0 && timeMinutes === 0)}
          className="w-full h-12 text-base font-semibold rounded-xl bg-primary text-primary-foreground hover:bg-primary/90"
        >
          Confirm & Start Test
        </Button>
      </div>
    </div>
  );
};

export default QuizSetup;
