import { useState, useCallback } from 'react';
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

export function useQuiz() {
  // ── existing state ────────────────────────────────────────────────────────
  const [quizResults, setQuizResults]   = useState<QuizResult[]>([]);
  const [currentQuiz, setCurrentQuiz]   = useState<{
    config: QuizConfig;
    questions: QuizQuestion[];
    answers: QuizAnswer[];
  } | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  // ── new state ─────────────────────────────────────────────────────────────
  const [questions, setQuestions] = useState<QuizQuestionItem[]>([]);
  const [result, setResult]       = useState<QuizResultData | null>(null);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string | null>(null);

  // ════════════════════════════════════════════════════════════════════════
  //  generateQuestions  — NOW calls /api/quiz/generate (fixed)
  //  Previously it called /api/chat which returned placeholder text.
  // ════════════════════════════════════════════════════════════════════════
  const generateQuestions = useCallback(async (
    config: QuizConfig,
    overrideQuestion?: string
  ): Promise<QuizQuestion[]> => {
    setIsGenerating(true);
    try {
      // Single question from chat — keep existing behaviour
      if (overrideQuestion) {
        const marks = config.questions[0]?.marks ?? 2;
        const q: QuizQuestion = {
          id: generateId(),
          question: overrideQuestion,
          marks,
          type: marks === 1 ? 'mcq' : 'written',
          options: marks === 1
            ? ['A) Option 1', 'B) Option 2', 'C) Option 3', 'D) Option 4']
            : undefined,
        };
        return [q];
      }

      const allQuestions: QuizQuestion[] = [];

      for (const qConfig of config.questions) {
        try {
          // ── call the dedicated quiz endpoint ──────────────────────────
          const res = await fetch(`${API}/api/quiz/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              topic:              config.subject,
              num_questions:      qConfig.count,
              marks_per_question: qConfig.marks,
              difficulty:         'medium',
            }),
          });

          if (!res.ok) throw new Error('Backend returned error');

          const data   = await res.json();
          const parsed: any[] = data.questions ?? [];

          for (const q of parsed.slice(0, qConfig.count)) {
            allQuestions.push({
              id:      q.id ?? generateId(),
              question: q.question,
              marks:   q.max_marks ?? qConfig.marks,
              // MCQ options not yet returned by backend — use written for all
              options: qConfig.marks === 1
                ? ['A) Option 1', 'B) Option 2', 'C) Option 3', 'D) Option 4']
                : undefined,
              type: qConfig.marks === 1 ? 'mcq' : 'written',
            });
          }
        } catch (err) {
          console.error('Error generating questions:', err);
          // Fallback so the quiz can still open
          for (let i = 0; i < qConfig.count; i++) {
            allQuestions.push({
              id:       generateId(),
              question: `${config.subject}: Question ${allQuestions.length + 1} (${qConfig.marks} marks)`,
              marks:    qConfig.marks,
              options:  qConfig.marks === 1
                ? ['A) Option 1', 'B) Option 2', 'C) Option 3', 'D) Option 4']
                : undefined,
              type: qConfig.marks === 1 ? 'mcq' : 'written',
            });
          }
        }
      }

      return allQuestions;
    } finally {
      setIsGenerating(false);
    }
  }, []);

  // ── startQuiz (unchanged signature) ──────────────────────────────────────
  const startQuiz = useCallback(async (
    config: QuizConfig,
    overrideQuestion?: string
  ) => {
    const qs      = await generateQuestions(config, overrideQuestion);
    const answers: QuizAnswer[] = qs.map(q => ({ questionId: q.id }));
    setCurrentQuiz({ config, questions: qs, answers });
    return qs;
  }, [generateQuestions]);

  // ── updateAnswer (unchanged) ──────────────────────────────────────────────
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

  // ════════════════════════════════════════════════════════════════════════
  //  evaluateQuiz — NOW calls /api/quiz/evaluate (fixed)
  //  Previously it called /api/chat which was unreliable.
  // ════════════════════════════════════════════════════════════════════════
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
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers: payload }),
      });

      if (!res.ok) throw new Error('Evaluation failed');

      const data = await res.json();
      // data = { evaluations: [...], total_awarded, total_possible }

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

  // ── startQuizFromChat (unchanged) ─────────────────────────────────────────
  const startQuizFromChat = useCallback(async (question: string, marks: number) => {
    const config: QuizConfig = {
      subject:     'Chat Question',
      questions:   [{ marks, count: 1 }],
      timeHours:   0,
      timeMinutes: 10,
      mode:        'normal',
    };
    const quizQuestion: QuizQuestion = {
      id:       generateId(),
      question,
      marks,
      type:     marks === 1 ? 'mcq' : 'written',
      options:  marks === 1
        ? ['A) Option 1', 'B) Option 2', 'C) Option 3', 'D) Option 4']
        : undefined,
    };
    setCurrentQuiz({
      config,
      questions: [quizQuestion],
      answers:   [{ questionId: quizQuestion.id }],
    });
    return config;
  }, []);

  // ════════════════════════════════════════════════════════════════════════
  //  New standalone helpers (used by QuizPage submit flow)
  // ════════════════════════════════════════════════════════════════════════
  async function generateQuiz(config: QuizSetupConfig) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API}/api/quiz/generate`, {
        method: 'POST',
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
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers }),
      });
      const data: QuizResultData = await res.json();
      setResult(data);
    } catch {
      setError('Failed to evaluate answers.');
    } finally {
      setLoading(false);
    }
  }

  function reset() {
    setQuestions([]);
    setResult(null);
    setError(null);
  }

  // ── return ────────────────────────────────────────────────────────────────
  return {
    // existing
    quizResults,
    currentQuiz,
    isGenerating,
    startQuiz,
    updateAnswer,
    evaluateQuiz,
    startQuizFromChat,
    setCurrentQuiz,
    // new
    questions,
    result,
    loading,
    error,
    generateQuiz,
    submitAnswers,
    reset,
  };
}