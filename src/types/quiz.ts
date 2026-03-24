export interface QuizQuestionItem {
  id: string;
  question: string;
  max_marks: number;
  expected_answer?: string; // kept server-side only ideally
}

export interface QuizAnswerItem {
  question_id: string;
  question: string;
  student_answer: string;
  max_marks: number;
}

export interface EvaluatedAnswer {
  question_id: string;
  question: string;
  student_answer: string;
  awarded_marks: number;
  max_marks: number;
  feedback: string;
}

export interface QuizResultData {
  evaluations: EvaluatedAnswer[];
  total_awarded: number;
  total_possible: number;
}

export interface QuizSetupConfig {
  topic: string;
  num_questions: number;
  marks_per_question: number;
  difficulty: "easy" | "medium" | "hard";
}

// ========== ORIGINAL CODE (unchanged) ==========

export interface QuizConfig {
  subject: string;
  questions: QuestionConfig[];
  timeHours: number;
  timeMinutes: number;
  mode: 'normal' | 'real';
}

export interface QuestionConfig {
  marks: number;
  count: number;
  orChoice?: boolean; // For 2+ mark questions: each question has a/b choice options
}

export interface QuizQuestion {
  id: string;
  question: string;
  marks: number;
  options?: string[]; // For 1-mark MCQ questions
  type: 'mcq' | 'written';
}

export interface QuizAnswer {
  questionId: string;
  selectedOption?: string; // For MCQ
  textAnswer?: string; // For written
  canvasData?: string; // For drawing (base64)
}

export interface QuizResult {
  id: string;
  subject: string;
  date: Date;
  totalMarks: number;
  obtainedMarks: number;
  mode: 'normal' | 'real';
  questionResults: QuestionResult[];
}

export interface QuestionResult {
  questionId: string;
  question: string;
  marks: number;
  obtainedMarks: number;
  feedback: string;
  isCorrect: boolean;
}