import { useState, useCallback, useEffect } from 'react';
import {
  QuizConfig,
  QuizQuestion,
  QuizAnswer,
  QuizResult,
  QuestionResult,
  QuizQuestionItem,
  QuizSetupConfig,
  QuizResultData,
  QuizAnswerItem,
} from '@/types/quiz';

const API = "http://localhost:8000";
const generateId = () => Math.random().toString(36).substring(2, 15);

const QUIZ_RESULTS_KEY = 'nexusai_quiz_results';

function loadQuizResults(): QuizResult[] {
  try {
    const raw = localStorage.getItem(QUIZ_RESULTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return parsed.map((r: any) => ({ ...r, date: new Date(r.date) }));
  } catch {
    return [];
  }
}

export function useQuiz() {
  const [quizResults, setQuizResults]   = useState<QuizResult[]>(() => loadQuizResults());

  useEffect(() => {
    try {
      localStorage.setItem(QUIZ_RESULTS_KEY, JSON.stringify(quizResults));
    } catch {}
  }, [quizResults]);

  const [currentQuiz, setCurrentQuiz]   = useState<{
    config: QuizConfig;
    questions: QuizQuestion[];
    answers: QuizAnswer[];
  } | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [questions, setQuestions]       = useState<QuizQuestionItem[]>([]);
  const [result, setResult]             = useState<QuizResultData | null>(null);
  const [loading, setLoading]           = useState(false);
  const [error, setError]               = useState<string | null>(null);

  // ══════════════════════════════════════════════════════════════════════
  //  generateQuestions
  //  BUG 2 FIX: For 1-mark MCQ questions the backend now returns
  //  real options. We use them directly instead of hardcoding
  //  "Option 1 / Option 2 / Option 3 / Option 4".
  // ══════════════════════════════════════════════════════════════════════
  const generateQuestions = useCallback(async (
    config: QuizConfig,
    overrideQuestion?: string
  ): Promise<QuizQuestion[]> => {
    setIsGenerating(true);
    try {
      // ── Single question from chat — fetch options from backend too ──────
      if (overrideQuestion) {
        const marks = config.questions[0]?.marks ?? 2;
        if (marks === 1) {
          // Always call backend so options are AI-generated for this topic
          const res = await fetch(`${API}/api/quiz/generate`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              topic:              overrideQuestion,
              num_questions:      1,
              marks_per_question: 1,
              difficulty:         'medium',
            }),
          });
          if (res.ok) {
            const data = await res.json();
            const first = data.questions?.[0];
            console.log('MCQ from backend (chat):', first);
            if (first && first.options?.length >= 4) {
              return [{
                id:       first.id ?? generateId(),
                question: first.question ?? overrideQuestion,
                marks:    1,
                type:     'mcq',
                options:  first.options,
              }];
            }
          }
          // Backend failed — return question with empty options so UI shows error
          // NOT hardcoded True/False — that would be wrong for every topic
          console.warn('MCQ backend did not return valid options for:', overrideQuestion);
          return [{
            id:       generateId(),
            question: overrideQuestion,
            marks:    1,
            type:     'mcq',
            options:  ['A) Loading failed — retry', 'B) —', 'C) —', 'D) —'],
          }];
        }
        // Written question from chat
        return [{
          id:       generateId(),
          question: overrideQuestion,
          marks,
          type:     'written',
          options:  undefined,
        }];
      }

      // ── Batch question generation ─────────────────────────────────────
      const allQuestions: QuizQuestion[] = [];

      for (const qConfig of config.questions) {
        try {
          // For or-choice, generate 2x questions (a and b variants)
          const numToGenerate = qConfig.orChoice ? qConfig.count * 2 : qConfig.count;
          
          const res = await fetch(`${API}/api/quiz/generate`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              topic:              config.subject,
              num_questions:      numToGenerate,
              marks_per_question: qConfig.marks,
              difficulty:         'medium',
            }),
          });

          if (!res.ok) throw new Error(`Backend ${res.status}`);

          const data   = await res.json();
          const parsed: any[] = data.questions ?? [];
          console.log(`Quiz questions from backend (${qConfig.marks}m):`, parsed);

          const isMcq = qConfig.marks === 1;

          if (qConfig.orChoice && !isMcq) {
            // Group questions in pairs as a/b choices
            for (let i = 0; i < Math.min(parsed.length, numToGenerate); i += 2) {
              const qA = parsed[i];
              const qB = parsed[i + 1];
              if (qA) {
                allQuestions.push({
                  id:       (qA.id ?? generateId()),
                  question: qA.question,
                  marks:    qA.max_marks ?? qConfig.marks,
                  type:     'written',
                  options:  undefined,
                  orGroup:  Math.floor(i / 2) + 1,
                  orLabel:  'a',
                } as any);
              }
              if (qB) {
                allQuestions.push({
                  id:       (qB.id ?? generateId()),
                  question: qB.question,
                  marks:    qB.max_marks ?? qConfig.marks,
                  type:     'written',
                  options:  undefined,
                  orGroup:  Math.floor(i / 2) + 1,
                  orLabel:  'b',
                } as any);
              }
            }
          } else {
            for (const q of parsed.slice(0, qConfig.count)) {
              if (isMcq) {
                const opts: string[] = q.options ?? [];
                const hasRealOptions =
                  opts.length >= 4 &&
                  !opts.some((o: string) =>
                    /option\s*[1-4abcd]/i.test(o) ||
                    /^(true|false)$/i.test(o.replace(/^[A-D]\)\s*/i, '').trim())
                  );

                if (!hasRealOptions) {
                  console.warn('Backend returned bad options, will retry question:', q);
                  continue;
                }

                allQuestions.push({
                  id:       q.id ?? generateId(),
                  question: q.question,
                  marks:    q.max_marks ?? 1,
                  type:     'mcq',
                  options:  opts.slice(0, 4),
                });
              } else {
                allQuestions.push({
                  id:       q.id ?? generateId(),
                  question: q.question,
                  marks:    q.max_marks ?? qConfig.marks,
                  type:     'written',
                  options:  undefined,
                });
              }
            }
          }

          // If MCQ and we got fewer questions than requested, fill with a retry
          if (isMcq && allQuestions.filter(q => q.type === 'mcq').length < qConfig.count) {
            const missing = qConfig.count - allQuestions.filter(q => q.type === 'mcq').length;
            console.warn(`Only got ${qConfig.count - missing}/${qConfig.count} valid MCQs, retrying for ${missing} more`);
            // Retry once for the missing count
            const res2 = await fetch(`${API}/api/quiz/generate`, {
              method:  'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                topic:              config.subject,
                num_questions:      missing,
                marks_per_question: 1,
                difficulty:         'medium',
              }),
            });
            if (res2.ok) {
              const data2   = await res2.json();
              const parsed2: any[] = data2.questions ?? [];
              for (const q of parsed2.slice(0, missing)) {
                const opts: string[] = q.options ?? [];
                if (opts.length >= 4) {
                  allQuestions.push({
                    id:       q.id ?? generateId(),
                    question: q.question,
                    marks:    1,
                    type:     'mcq',
                    options:  opts.slice(0, 4),
                  });
                }
              }
            }
          }

        } catch (err) {
          console.error('Error generating questions for config:', qConfig, err);
          // Minimal fallback — shows the question number but signals failure
          for (let i = 0; i < qConfig.count; i++) {
            allQuestions.push({
              id:       generateId(),
              question: `[Failed to load — retry] ${config.subject} Q${allQuestions.length + 1}`,
              marks:    qConfig.marks,
              type:     qConfig.marks === 1 ? 'mcq' : 'written',
              options:  qConfig.marks === 1
                ? ['A) Retry quiz generation', 'B) —', 'C) —', 'D) —']
                : undefined,
            });
          }
        }
      }

      return allQuestions;
    } finally {
      setIsGenerating(false);
    }
  }, []);

  const startQuiz = useCallback(async (
    config: QuizConfig,
    overrideQuestion?: string
  ) => {
    const qs      = await generateQuestions(config, overrideQuestion);
    const answers: QuizAnswer[] = qs.map(q => ({ questionId: q.id }));
    setCurrentQuiz({ config, questions: qs, answers });
    return qs;
  }, [generateQuestions]);

  const updateAnswer = useCallback((questionId: string, answer: Partial<QuizAnswer>) => {
    setCurrentQuiz(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        answers: prev.answers.map(a =>
          a.questionId === questionId ? { ...a, ...answer } : a
        ),
      };
    });
  }, []);

  const evaluateQuiz = useCallback(async (): Promise<QuizResult | null> => {
    if (!currentQuiz) return null;
    const { config, questions: qs, answers } = currentQuiz;

    try {
      const payload = qs.map(q => {
        const ans = answers.find(a => a.questionId === q.id);
        const studentAnswer = q.type === 'mcq'
          ? (ans?.selectedOption || '')
          : (ans?.textAnswer || '');
        return {
          question_id:    q.id,
          question:       q.question,
          student_answer: studentAnswer,
          max_marks:      q.marks,
        };
      });

      const res = await fetch(`${API}/api/quiz/evaluate`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ answers: payload }),
      });

      if (!res.ok) throw new Error('Evaluation failed');

      const data = await res.json();

      const questionResults: QuestionResult[] = qs.map(q => {
        const ev = (data.evaluations ?? []).find((e: any) => e.question_id === q.id);
        return {
          questionId:    q.id,
          question:      q.question,
          marks:         q.marks,
          obtainedMarks: ev?.awarded_marks ?? 0,
          feedback:      ev?.feedback ?? 'Could not evaluate this answer.',
          isCorrect:     (ev?.awarded_marks ?? 0) >= q.marks,
        };
      });

      const quizResult: QuizResult = {
        id:            generateId(),
        subject:       config.subject,
        date:          new Date(),
        totalMarks:    data.total_possible,
        obtainedMarks: data.total_awarded,
        mode:          config.mode,
        questionResults,
      };

      setQuizResults(prev => [...prev, quizResult]);
      setCurrentQuiz(null);
      return quizResult;
    } catch (error) {
      console.error('Evaluation error:', error);
      const totalMarks = qs.reduce((s, q) => s + q.marks, 0);
      const quizResult: QuizResult = {
        id:            generateId(),
        subject:       config.subject,
        date:          new Date(),
        totalMarks,
        obtainedMarks: 0,
        mode:          config.mode,
        questionResults: qs.map(q => ({
          questionId:    q.id,
          question:      q.question,
          marks:         q.marks,
          obtainedMarks: 0,
          feedback:      'Could not evaluate. Is the backend running?',
          isCorrect:     false,
        })),
      };
      setQuizResults(prev => [...prev, quizResult]);
      setCurrentQuiz(null);
      return quizResult;
    }
  }, [currentQuiz]);

  const startQuizFromChat = useCallback(async (question: string, marks: number) => {
    const config: QuizConfig = {
      subject:     'Chat Question',
      questions:   [{ marks, count: 1 }],
      timeHours:   0,
      timeMinutes: 10,
      mode:        'normal',
    };
    // Always use generateQuestions so MCQ options come from the backend
    const qs = await generateQuestions(config, question);
    setCurrentQuiz({
      config,
      questions: qs,
      answers:   [{ questionId: qs[0].id }],
    });
    return config;
  }, [generateQuestions]);

  // ── Standalone helpers used by QuizPage submit flow ─────────────────────
  async function generateQuiz(config: QuizSetupConfig) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API}/api/quiz/generate`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic:              config.topic,
          num_questions:      config.num_questions,
          marks_per_question: config.marks_per_question,
          difficulty:         config.difficulty,
        }),
      });
      const data = await res.json();
      setQuestions(data.questions);
    } catch {
      setError('Failed to generate quiz. Is the backend running?');
    } finally {
      setLoading(false);
    }
  }

  async function submitAnswers(answers: QuizAnswerItem[]) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API}/api/quiz/evaluate`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers }),
      });
      const data: QuizResultData = await res.json();
      setResult(data);
    } catch {
      // Backend unreachable — show a fallback result so the UI still renders
      const totalPossible = answers.reduce((s, a) => s + a.max_marks, 0);
      const fallbackResult: QuizResultData = {
        total_possible: totalPossible,
        total_awarded: 0,
        evaluations: answers.map(a => ({
          question_id: a.question_id,
          question: a.question,
          student_answer: a.student_answer,
          max_marks: a.max_marks,
          awarded_marks: 0,
          feedback: 'Could not evaluate — backend is not reachable. Please ensure your backend server is running on localhost:8000.',
        })),
      };
      setResult(fallbackResult);
      setError('Failed to evaluate answers. Backend not reachable.');
    } finally {
      setLoading(false);
    }
  }

  function reset() {
    setQuestions([]);
    setResult(null);
    setError(null);
  }

  return {
    quizResults,
    currentQuiz,
    isGenerating,
    startQuiz,
    updateAnswer,
    evaluateQuiz,
    startQuizFromChat,
    setCurrentQuiz,
    questions,
    result,
    loading,
    error,
    generateQuiz,
    submitAnswers,
    reset,
  };
}