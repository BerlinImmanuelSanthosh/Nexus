import { QuizResult } from '@/types/quiz';
import { Button } from '@/components/ui/button';
import { ArrowLeft, TrendingUp, TrendingDown, BarChart3 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PerformanceTrackerProps {
  results: QuizResult[];
  onBack: () => void;
}

const PerformanceTracker = ({ results, onBack }: PerformanceTrackerProps) => {
  const getPercentage = (r: QuizResult) => Math.round((r.obtainedMarks / r.totalMarks) * 100);

  const isImproving = results.length >= 2 && 
    getPercentage(results[results.length - 1]) >= getPercentage(results[results.length - 2]);

  const average = results.length > 0
    ? Math.round(results.reduce((sum, r) => sum + getPercentage(r), 0) / results.length)
    : 0;

  return (
    <div className="flex flex-1 flex-col overflow-y-auto px-6 py-6 scrollbar-thin">
      <div className="mx-auto w-full max-w-2xl space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={onBack}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h2 className="text-2xl font-bold text-foreground">Performance Tracker</h2>
            <p className="text-sm text-muted-foreground">Track your quiz progress</p>
          </div>
        </div>

        {results.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <BarChart3 className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-lg text-muted-foreground">No quizzes taken yet</p>
            <p className="text-sm text-muted-foreground mt-1">Complete a quiz to see your performance here</p>
          </div>
        ) : (
          <>
            {/* Summary */}
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-xl border border-border bg-secondary/30 p-4 text-center">
                <p className="text-2xl font-bold text-foreground">{results.length}</p>
                <p className="text-xs text-muted-foreground">Tests Taken</p>
              </div>
              <div className="rounded-xl border border-border bg-secondary/30 p-4 text-center">
                <p className="text-2xl font-bold gradient-text">{average}%</p>
                <p className="text-xs text-muted-foreground">Average Score</p>
              </div>
              <div className="rounded-xl border border-border bg-secondary/30 p-4 text-center flex flex-col items-center justify-center">
                {results.length >= 2 ? (
                  isImproving ? (
                    <>
                      <TrendingUp className="h-6 w-6 text-primary" />
                      <p className="text-xs text-primary mt-1">Improving!</p>
                    </>
                  ) : (
                    <>
                      <TrendingDown className="h-6 w-6 text-destructive" />
                      <p className="text-xs text-destructive mt-1">Needs work</p>
                    </>
                  )
                ) : (
                  <p className="text-xs text-muted-foreground">Take more tests</p>
                )}
              </div>
            </div>

            {/* Trend advice */}
            {results.length >= 2 && !isImproving && (
              <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4">
                <p className="text-sm font-medium text-foreground mb-2">💡 Tips to Improve</p>
                <ul className="text-sm text-muted-foreground space-y-1 list-disc pl-4">
                  <li>Review your incorrect answers and understand the concepts</li>
                  <li>Practice with shorter quizzes on specific topics</li>
                  <li>Take notes while studying before attempting quizzes</li>
                  <li>Don't rush — read each question carefully</li>
                </ul>
                <p className="text-sm text-primary mt-3">You've got this! Every attempt is progress 🚀</p>
              </div>
            )}

            {/* History */}
            <div className="space-y-3">
              <h3 className="text-lg font-semibold text-foreground">Quiz History</h3>
              {[...results].reverse().map((result) => {
                const pct = getPercentage(result);
                return (
                  <div key={result.id} className="rounded-xl border border-border bg-secondary/20 p-4">
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        <p className="text-sm font-medium text-foreground">{result.subject}</p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(result.date).toLocaleDateString()} • {result.mode} mode
                        </p>
                      </div>
                      <span className={cn(
                        "text-lg font-bold",
                        pct >= 70 ? "text-primary" : pct >= 40 ? "text-yellow-500" : "text-destructive"
                      )}>
                        {pct}%
                      </span>
                    </div>
                    <div className="w-full h-2 rounded-full bg-secondary overflow-hidden">
                      <div
                        className={cn(
                          "h-full rounded-full transition-all",
                          pct >= 70 ? "bg-primary" : pct >= 40 ? "bg-yellow-500" : "bg-destructive"
                        )}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {result.obtainedMarks}/{result.totalMarks} marks
                    </p>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default PerformanceTracker;
