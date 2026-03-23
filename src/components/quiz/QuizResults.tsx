import { QuizResult } from '@/types/quiz';
import { Button } from '@/components/ui/button';
import { ArrowLeft, CheckCircle, XCircle, Trophy } from 'lucide-react';
import { cn } from '@/lib/utils';

// ========== ORIGINAL COMPONENT (unchanged) ==========
interface QuizResultsProps {
  result: QuizResult;
  onBack: () => void;
  onNewQuiz: () => void;
}

const QuizResults = ({ result, onBack, onNewQuiz }: QuizResultsProps) => {
  const percentage = Math.round((result.obtainedMarks / result.totalMarks) * 100);
  const isGood = percentage >= 70;
  const isAverage = percentage >= 40 && percentage < 70;

  return (
    <div className="flex flex-1 flex-col overflow-y-auto px-6 py-6 scrollbar-thin">
      <div className="mx-auto w-full max-w-2xl space-y-6">
        <Button variant="ghost" onClick={onBack} className="gap-2">
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>

        {/* Score card */}
        <div className="rounded-2xl border border-border bg-secondary/30 p-8 text-center">
          <Trophy className={cn("h-12 w-12 mx-auto mb-3", isGood ? "text-primary" : isAverage ? "text-yellow-500" : "text-destructive")} />
          <p className="text-4xl font-bold gradient-text">{result.obtainedMarks}/{result.totalMarks}</p>
          <p className="text-lg text-muted-foreground mt-1">{percentage}%</p>
          <p className="text-sm mt-2 text-foreground">
            {isGood ? "Excellent work! Keep it up! 🎉" : isAverage ? "Good effort! Room for improvement." : "Keep practicing, you'll get better! 💪"}
          </p>
        </div>

        {/* Question-by-question feedback */}
        <div className="space-y-3">
          <h3 className="text-lg font-semibold text-foreground">Detailed Feedback</h3>
          {result.questionResults.map((qr, i) => (
            <div key={qr.questionId} className="rounded-xl border border-border bg-secondary/20 p-4">
              <div className="flex items-start gap-3">
                {qr.isCorrect ? (
                  <CheckCircle className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                ) : (
                  <XCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
                )}
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-sm font-medium text-foreground">Q{i + 1}: {qr.question}</p>
                    <span className={cn(
                      "text-xs font-semibold px-2 py-0.5 rounded-full",
                      qr.isCorrect ? "bg-primary/20 text-primary" : "bg-destructive/20 text-destructive"
                    )}>
                      {qr.obtainedMarks}/{qr.marks}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">{qr.feedback}</p>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="flex gap-3 pb-6">
          <Button onClick={onNewQuiz} className="flex-1 bg-primary text-primary-foreground">Take Another Quiz</Button>
          <Button variant="outline" onClick={onBack} className="flex-1">Back to Chat</Button>
        </div>
      </div>
    </div>
  );
};

export default QuizResults;

// ========== NEW COMPONENT (added below, renamed) ==========
import { QuizResultData } from "@/types/quiz";

interface QuizResultsBackendProps {
  result: QuizResultData;
  onRetry: () => void;
}

export function QuizResultsBackend({ result, onRetry }: QuizResultsBackendProps) {
  const percentage = Math.round((result.total_awarded / result.total_possible) * 100);

  function getGrade() {
    if (percentage >= 90) return { label: "Excellent", color: "text-green-400" };
    if (percentage >= 75) return { label: "Good", color: "text-blue-400" };
    if (percentage >= 50) return { label: "Pass", color: "text-yellow-400" };
    return { label: "Needs Improvement", color: "text-red-400" };
  }

  const grade = getGrade();

  return (
    <div className="flex flex-1 flex-col overflow-y-auto h-full">
      <div className="p-6 max-w-3xl mx-auto space-y-6 w-full">

        {/* Total score card */}
        <div className="rounded-xl border border-border bg-secondary/30 p-6 text-center">
          <p className="text-sm text-muted-foreground mb-1">Your Score</p>
          <p className="text-5xl font-bold text-foreground">
            {result.total_awarded}
            <span className="text-2xl text-muted-foreground"> / {result.total_possible}</span>
          </p>
          <p className={`mt-2 text-lg font-semibold ${grade.color}`}>
            {grade.label} — {percentage}%
          </p>
        </div>

        {/* Per-question breakdown */}
        <div className="space-y-4">
          {result.evaluations.map((ev, i) => (
            <div
              key={ev.question_id}
              className="rounded-xl border border-border bg-secondary/20 p-5 space-y-2"
            >
              <p className="text-sm text-muted-foreground">Question {i + 1}</p>
              <p className="text-foreground font-medium">{ev.question}</p>
              <div className="flex items-center gap-2">
                <span
                  className={`text-sm font-semibold px-3 py-1 rounded-full ${
                    ev.awarded_marks === ev.max_marks
                      ? "bg-primary/20 text-primary"
                      : ev.awarded_marks === 0
                      ? "bg-destructive/20 text-destructive"
                      : "bg-yellow-500/20 text-yellow-500"
                  }`}
                >
                  {ev.awarded_marks} / {ev.max_marks} marks
                </span>
              </div>
              <p className="text-sm text-muted-foreground border-l-2 border-border pl-3">
                {ev.feedback}
              </p>
            </div>
          ))}
        </div>

        {/* Retry button */}
        <div className="pb-8">
          <button
            onClick={onRetry}
            className="w-full py-3 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground font-semibold transition"
          >
            Try Another Quiz
          </button>
        </div>
      </div>
    </div>
  );
}