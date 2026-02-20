import { useState, useCallback } from 'react';
import { QuizConfig, QuizQuestion, QuizAnswer, QuizResult, QuestionResult } from '@/types/quiz';

const generateId = () => Math.random().toString(36).substring(2, 15);

export function useQuiz() {
  const [quizResults, setQuizResults] = useState<QuizResult[]>([]);
  const [currentQuiz, setCurrentQuiz] = useState<{
    config: QuizConfig;
    questions: QuizQuestion[];
    answers: QuizAnswer[];
  } | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  const generateQuestions = useCallback(async (config: QuizConfig, overrideQuestion?: string): Promise<QuizQuestion[]> => {
    setIsGenerating(true);
    try {
      // If a specific question is passed (from chat), skip generation
      if (overrideQuestion) {
        const marks = config.questions[0]?.marks ?? 2;
        const q: QuizQuestion = {
          id: generateId(),
          question: overrideQuestion,
          marks,
          type: marks === 1 ? 'mcq' : 'written',
          options: marks === 1 ? ['A) Option 1', 'B) Option 2', 'C) Option 3', 'D) Option 4'] : undefined,
        };
        return [q];
      }

      const allQuestions: QuizQuestion[] = [];
      
      for (const qConfig of config.questions) {
        const prompt = qConfig.marks === 1
          ? `Generate ${qConfig.count} multiple choice questions about "${config.subject}" worth 1 mark each. For each question provide exactly 4 options labeled A, B, C, D. Format as JSON array: [{"question": "...", "options": ["A) ...", "B) ...", "C) ...", "D) ..."], "correct": "A"}]. Only return the JSON array, nothing else.`
          : `Generate ${qConfig.count} written/descriptive questions about "${config.subject}" worth ${qConfig.marks} marks each. Each answer should require minimum ${qConfig.marks * 10} words. Format as JSON array: [{"question": "..."}]. Only return the JSON array, nothing else.`;

        try {
          const response = await fetch('http://localhost:8000/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              messages: [{ role: 'user', content: prompt }]
            }),
          });

          if (!response.ok) throw new Error('Failed to generate questions');
          
          const data = await response.json();
          let parsed: any[] = [];
          
          try {
            // Try to extract JSON from the response
            const jsonMatch = data.response.match(/\[[\s\S]*\]/);
            if (jsonMatch) {
              parsed = JSON.parse(jsonMatch[0]);
            }
          } catch {
            console.error('Failed to parse questions, using fallback');
          }

          if (parsed.length === 0) {
            // Fallback: generate placeholder questions
            for (let i = 0; i < qConfig.count; i++) {
              parsed.push({
                question: `${config.subject} question ${i + 1} (${qConfig.marks} marks)`,
                ...(qConfig.marks === 1 ? {
                  options: ['A) Option 1', 'B) Option 2', 'C) Option 3', 'D) Option 4']
                } : {})
              });
            }
          }

          for (const q of parsed.slice(0, qConfig.count)) {
            allQuestions.push({
              id: generateId(),
              question: q.question,
              marks: qConfig.marks,
              options: qConfig.marks === 1 ? q.options : undefined,
              type: qConfig.marks === 1 ? 'mcq' : 'written',
            });
          }
        } catch (err) {
          console.error('Error generating questions:', err);
          // Fallback questions
          for (let i = 0; i < qConfig.count; i++) {
            allQuestions.push({
              id: generateId(),
              question: `${config.subject}: Question ${allQuestions.length + 1} (${qConfig.marks} marks)`,
              marks: qConfig.marks,
              options: qConfig.marks === 1 ? ['A) Option 1', 'B) Option 2', 'C) Option 3', 'D) Option 4'] : undefined,
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

  const startQuiz = useCallback(async (config: QuizConfig, overrideQuestion?: string) => {
    const questions = await generateQuestions(config, overrideQuestion);
    const answers: QuizAnswer[] = questions.map(q => ({ questionId: q.id }));
    setCurrentQuiz({ config, questions, answers });
    return questions;
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

    const { config, questions, answers } = currentQuiz;

    try {
      const evalPrompt = questions.map((q, i) => {
        const answer = answers.find(a => a.questionId === q.id);
        const userAnswer = q.type === 'mcq'
          ? (answer?.selectedOption || 'No answer')
          : (answer?.textAnswer || 'No answer');
        const hasDrawing = q.type === 'written' && !!answer?.canvasData;
        
        return `Question ${i + 1} (${q.marks} marks): ${q.question}\n${q.options ? `Options: ${q.options.join(', ')}\n` : ''}User's answer: ${userAnswer}${hasDrawing ? '\n[User also submitted a hand-drawn diagram/working]' : ''}`;
      }).join('\n\n');

      const response = await fetch('http://localhost:8000/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{
            role: 'user',
            content: `Evaluate these quiz answers for subject "${config.subject}". For each question, give marks obtained (out of total) and brief feedback. Format as JSON array: [{"questionIndex": 0, "obtainedMarks": 1, "feedback": "...", "isCorrect": true}]. Only return the JSON array.\n\n${evalPrompt}`
          }]
        }),
      });

      if (!response.ok) throw new Error('Evaluation failed');

      const data = await response.json();
      let evalResults: any[] = [];

      try {
        const jsonMatch = data.response.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          evalResults = JSON.parse(jsonMatch[0]);
        }
      } catch {
        console.error('Failed to parse evaluation');
      }

      const questionResults: QuestionResult[] = questions.map((q, i) => {
        const evalResult = evalResults.find(e => e.questionIndex === i) || {};
        return {
          questionId: q.id,
          question: q.question,
          marks: q.marks,
          obtainedMarks: evalResult.obtainedMarks ?? 0,
          feedback: evalResult.feedback ?? 'Could not evaluate this answer.',
          isCorrect: evalResult.isCorrect ?? false,
        };
      });

      const totalMarks = questions.reduce((sum, q) => sum + q.marks, 0);
      const obtainedMarks = questionResults.reduce((sum, r) => sum + r.obtainedMarks, 0);

      const result: QuizResult = {
        id: generateId(),
        subject: config.subject,
        date: new Date(),
        totalMarks,
        obtainedMarks,
        mode: config.mode,
        questionResults,
      };

      setQuizResults(prev => [...prev, result]);
      setCurrentQuiz(null);
      return result;
    } catch (error) {
      console.error('Evaluation error:', error);
      // Fallback result
      const totalMarks = questions.reduce((sum, q) => sum + q.marks, 0);
      const result: QuizResult = {
        id: generateId(),
        subject: config.subject,
        date: new Date(),
        totalMarks,
        obtainedMarks: 0,
        mode: config.mode,
        questionResults: questions.map(q => ({
          questionId: q.id,
          question: q.question,
          marks: q.marks,
          obtainedMarks: 0,
          feedback: 'Could not evaluate. Is the backend running?',
          isCorrect: false,
        })),
      };
      setQuizResults(prev => [...prev, result]);
      setCurrentQuiz(null);
      return result;
    }
  }, [currentQuiz]);

  const startQuizFromChat = useCallback(async (question: string, marks: number) => {
    const config: QuizConfig = {
      subject: 'Chat Question',
      questions: [{ marks, count: 1 }],
      timeHours: 0,
      timeMinutes: 10,
      mode: 'normal',
    };
    
    // Create a single question quiz from the chat question
    const quizQuestion: QuizQuestion = {
      id: generateId(),
      question,
      marks,
      type: marks === 1 ? 'mcq' : 'written',
      options: marks === 1 ? ['A) Option 1', 'B) Option 2', 'C) Option 3', 'D) Option 4'] : undefined,
    };

    setCurrentQuiz({
      config,
      questions: [quizQuestion],
      answers: [{ questionId: quizQuestion.id }],
    });

    return config;
  }, []);

  return {
    quizResults,
    currentQuiz,
    isGenerating,
    startQuiz,
    updateAnswer,
    evaluateQuiz,
    startQuizFromChat,
    setCurrentQuiz,
  };
}
