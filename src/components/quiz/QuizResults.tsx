import { QuizResult } from '@/types/quiz';
import { Button } from '@/components/ui/button';
import { ArrowLeft, CheckCircle, XCircle, Trophy } from 'lucide-react';
import { cn } from '@/lib/utils';

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
