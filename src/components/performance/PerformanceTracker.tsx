import { QuizResult } from '@/types/quiz';
import { Button } from '@/components/ui/button';
import { ArrowLeft, TrendingUp, TrendingDown, BarChart3, Target, BookOpen, Flame, Lightbulb } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, LineChart, Line, CartesianGrid
} from 'recharts';

interface PerformanceTrackerProps {
  results: QuizResult[];
  onBack: () => void;
}

const pct = (r: QuizResult) => Math.round((r.obtainedMarks / r.totalMarks) * 100);

const TIPS_DECLINING = [
  "📖 Review the questions you got wrong and understand the core concept behind each one.",
  "⏱️ Practice with shorter, focused quizzes on one topic at a time.",
  "✍️ Write a brief summary after each quiz — it reinforces memory.",
  "🧘 Don't rush! Read every question twice before answering.",
  "🔁 Re-take quizzes on weak subjects until you score above 70%.",
];

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="rounded-xl border border-border bg-background px-3 py-2 text-xs shadow-lg">
        <p className="font-semibold text-foreground">{label}</p>
        <p className="text-primary">{payload[0].value}%</p>
      </div>
    );
  }
  return null;
};

const PerformanceTracker = ({ results, onBack }: PerformanceTrackerProps) => {
  const isImproving = results.length >= 2 &&
    pct(results[results.length - 1]) >= pct(results[results.length - 2]);

  const average = results.length > 0
    ? Math.round(results.reduce((sum, r) => sum + pct(r), 0) / results.length)
    : 0;

  const best = results.length > 0 ? Math.max(...results.map(pct)) : 0;

  // Subject breakdown
  const subjectMap: Record<string, { total: number; count: number }> = {};
  results.forEach(r => {
    if (!subjectMap[r.subject]) subjectMap[r.subject] = { total: 0, count: 0 };
    subjectMap[r.subject].total += pct(r);
    subjectMap[r.subject].count += 1;
  });
  const subjectData = Object.entries(subjectMap).map(([subject, { total, count }]) => ({
    subject: subject.length > 12 ? subject.slice(0, 11) + '…' : subject,
    avg: Math.round(total / count),
  }));

  // Timeline chart data
  const timelineData = results.map((r, i) => ({
    name: `#${i + 1}`,
    score: pct(r),
    subject: r.subject,
  }));

  const weakSubjects = subjectData.filter(s => s.avg < 60);
  const strongSubjects = subjectData.filter(s => s.avg >= 70);

  return (
    <div className="flex flex-1 flex-col overflow-y-auto px-6 py-6 scrollbar-thin">
      <div className="mx-auto w-full max-w-2xl space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={onBack}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h2 className="text-2xl font-bold text-foreground">Performance Tracker</h2>
            <p className="text-sm text-muted-foreground">Your quiz progress at a glance</p>
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
            {/* Stats row */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="rounded-xl border border-border bg-secondary/30 p-4 text-center">
                <BookOpen className="h-5 w-5 text-primary mx-auto mb-1" />
                <p className="text-2xl font-bold text-foreground">{results.length}</p>
                <p className="text-xs text-muted-foreground">Tests Taken</p>
              </div>
              <div className="rounded-xl border border-border bg-secondary/30 p-4 text-center">
                <Target className="h-5 w-5 text-primary mx-auto mb-1" />
                <p className="text-2xl font-bold gradient-text">{average}%</p>
                <p className="text-xs text-muted-foreground">Average Score</p>
              </div>
              <div className="rounded-xl border border-border bg-secondary/30 p-4 text-center">
                <Flame className="h-5 w-5 text-primary mx-auto mb-1" />
                <p className="text-2xl font-bold text-foreground">{best}%</p>
                <p className="text-xs text-muted-foreground">Best Score</p>
              </div>
              <div className="rounded-xl border border-border bg-secondary/30 p-4 text-center flex flex-col items-center justify-center gap-1">
                {results.length >= 2 ? (
                  isImproving ? (
                    <>
                      <TrendingUp className="h-6 w-6 text-primary" />
                      <p className="text-xs font-semibold text-primary">Improving!</p>
                    </>
                  ) : (
                    <>
                      <TrendingDown className="h-6 w-6 text-destructive" />
                      <p className="text-xs font-semibold text-destructive">Declining</p>
                    </>
                  )
                ) : (
                  <p className="text-xs text-muted-foreground">More tests needed</p>
                )}
              </div>
            </div>

            {/* Score timeline */}
            {timelineData.length >= 2 && (
              <div className="rounded-xl border border-border bg-secondary/20 p-4">
                <h3 className="text-sm font-semibold text-foreground mb-3">Score Timeline</h3>
                <ResponsiveContainer width="100%" height={140}>
                  <LineChart data={timelineData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="name" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                    <Tooltip content={<CustomTooltip />} />
                    <Line
                      type="monotone"
                      dataKey="score"
                      stroke="hsl(var(--primary))"
                      strokeWidth={2}
                      dot={{ fill: 'hsl(var(--primary))', r: 4 }}
                      activeDot={{ r: 6 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Subject breakdown */}
            {subjectData.length > 0 && (
              <div className="rounded-xl border border-border bg-secondary/20 p-4">
                <h3 className="text-sm font-semibold text-foreground mb-3">By Subject</h3>
                <ResponsiveContainer width="100%" height={Math.max(100, subjectData.length * 36)}>
                  <BarChart data={subjectData} layout="vertical">
                    <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                    <YAxis dataKey="subject" type="category" width={80} tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                    <Tooltip content={<CustomTooltip />} />
                    <Bar dataKey="avg" radius={[0, 6, 6, 0]}>
                      {subjectData.map((entry, i) => (
                        <Cell
                          key={i}
                          fill={entry.avg >= 70 ? 'hsl(var(--primary))' : entry.avg >= 40 ? 'hsl(45 93% 47%)' : 'hsl(var(--destructive))'}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* AI-style tips for declining/weak */}
            {results.length >= 2 && (!isImproving || weakSubjects.length > 0) && (
              <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-5 space-y-3">
                <div className="flex items-center gap-2">
                  <TrendingDown className="h-4 w-4 text-destructive" />
                  <p className="text-sm font-semibold text-foreground">
                    {!isImproving ? "Your scores are declining — here's how to turn it around:" : "Weak areas detected:"}
                  </p>
                </div>
                {weakSubjects.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {weakSubjects.map(s => (
                      <span key={s.subject} className="text-xs px-2 py-1 rounded-full bg-destructive/15 text-destructive">
                        {s.subject} ({s.avg}%)
                      </span>
                    ))}
                  </div>
                )}
                <ul className="space-y-1.5">
                  {TIPS_DECLINING.map((tip, i) => (
                    <li key={i} className="text-sm text-muted-foreground">{tip}</li>
                  ))}
                </ul>
                <p className="text-sm font-medium text-primary">
                  💪 You've already started — every quiz is a step forward. Keep going!
                </p>
              </div>
            )}

            {/* Always-on improvement suggestions */}
            <div className="rounded-xl border border-primary/30 bg-primary/5 p-5 space-y-3">
              <div className="flex items-center gap-2">
                <Lightbulb className="h-4 w-4 text-primary" />
                <p className="text-sm font-semibold text-foreground">
                  Suggestions to boost your score
                </p>
              </div>
              <ul className="space-y-2 text-sm text-muted-foreground list-disc pl-5">
                {average < 50 && (
                  <li><span className="font-medium text-foreground">Start with the basics:</span> build a roadmap on your weakest subject and complete every lesson before re-attempting a quiz.</li>
                )}
                {average >= 50 && average < 75 && (
                  <li><span className="font-medium text-foreground">Close the gap:</span> review every wrong answer's feedback and re-quiz the same topic within 24 hours.</li>
                )}
                {average >= 75 && (
                  <li><span className="font-medium text-foreground">Push for mastery:</span> try harder difficulty quizzes and longer written questions to consolidate knowledge.</li>
                )}
                {weakSubjects.length > 0 && (
                  <li><span className="font-medium text-foreground">Focus on weak areas:</span> {weakSubjects.map(s => s.subject).join(', ')} — take a focused 5-question quiz on each.</li>
                )}
                <li><span className="font-medium text-foreground">Active recall:</span> after each quiz, write down the key concept in your own words.</li>
                <li><span className="font-medium text-foreground">Spaced repetition:</span> revisit a topic 1 day, 3 days, and 7 days after first studying it.</li>
                <li><span className="font-medium text-foreground">Use the chat:</span> ask NexusAI to re-explain any question you got wrong in simpler terms.</li>
                <li><span className="font-medium text-foreground">Practice 'Real Mode':</span> simulates exam pressure and improves recall under stress.</li>
              </ul>
            </div>


            {/* Praise if doing well */}
            {results.length >= 2 && isImproving && weakSubjects.length === 0 && (
              <div className="rounded-xl border border-primary/30 bg-primary/5 p-5">
                <p className="text-sm font-semibold text-foreground mb-1">🎉 You're on a roll!</p>
                <p className="text-sm text-muted-foreground">
                  Your scores are consistently improving. Keep up this momentum!
                </p>
                {strongSubjects.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-3">
                    {strongSubjects.map(s => (
                      <span key={s.subject} className="text-xs px-2 py-1 rounded-full bg-primary/15 text-primary">
                        ✓ {s.subject} ({s.avg}%)
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* History */}
            <div className="space-y-3">
              <h3 className="text-lg font-semibold text-foreground">Quiz History</h3>
              {[...results].reverse().map((result) => {
                const score = pct(result);
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
                        score >= 70 ? "text-primary" : score >= 40 ? "text-yellow-500" : "text-destructive"
                      )}>
                        {score}%
                      </span>
                    </div>
                    <div className="w-full h-2 rounded-full bg-secondary overflow-hidden">
                      <div
                        className={cn(
                          "h-full rounded-full transition-all",
                          score >= 70 ? "bg-primary" : score >= 40 ? "bg-yellow-500" : "bg-destructive"
                        )}
                        style={{ width: `${score}%` }}
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
