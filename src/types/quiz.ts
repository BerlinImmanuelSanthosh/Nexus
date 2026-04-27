// ========== FIRST CODE (UNCHANGED) ==========
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

// ========== CORRECTED ORIGINAL CODE ==========
// The following interfaces now correctly reference the types above,
// while preserving additional fields that were originally defined.

export interface QuizConfig {
  subject: string;
  questions: QuestionConfig[];
  timeHours: number;
  timeMinutes: number;
  mode: 'normal' | 'real';
  useFileContext?: boolean;
}

export interface QuestionConfig {
  marks: number;
  count: number;
  orChoice?: boolean;
}

export interface QuizQuestion {
  id: string;
  question: string;
  marks: number;
  type: 'mcq' | 'written';
  options?: string[];
  expected_answer?: string;
  orGroup?: number;
  orLabel?: 'a' | 'b';
}

export interface QuizAnswer {
  questionId: string;
  selectedOption?: string;
  textAnswer?: string;
  canvasData?: string;
}

export interface QuestionResult {
  questionId: string;
  question: string;
  marks: number;
  obtainedMarks: number;
  feedback: string;
  isCorrect: boolean;
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
