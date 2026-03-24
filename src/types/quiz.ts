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
}

export interface QuestionConfig {
  marks: number;
  count: number;
  orChoice?: boolean; // For 2+ mark questions: each question has a/b choice options
}

// Use QuizQuestionItem for the base question data, extended with quiz‑specific fields
export interface QuizQuestion extends QuizQuestionItem {
  // Inherits id, question, max_marks, expected_answer from QuizQuestionItem
  options?: string[]; // For 1‑mark MCQ questions
  type: 'mcq' | 'written';
  orGroup?: number;   // Questions with same orGroup are a/b choices
  orLabel?: 'a' | 'b'; // Which choice variant this is
}

// Use QuizAnswerItem for the answer data, extended with canvas support
export interface QuizAnswer extends Omit<QuizAnswerItem, 'student_answer'> {
  // Override student_answer to allow more detailed answer types
  student_answer?: string;
  selectedOption?: string; // For MCQ
  textAnswer?: string;     // For written
  canvasData?: string;     // For drawing (base64)
  // Keep question_id and max_marks as inherited from QuizAnswerItem
}

// Use QuizResultData for the core result data, extended with metadata and flags
export interface QuizResult extends Omit<QuizResultData, 'evaluations' | 'total_awarded' | 'total_possible'> {
  id: string;
  subject: string;
  date: Date;
  totalMarks: number;      // Alias for total_possible
  obtainedMarks: number;   // Alias for total_awarded
  mode: 'normal' | 'real';
  questionResults: QuestionResult[]; // Detailed per‑question results
}

// QuestionResult uses EvaluatedAnswer as a base, adding extra fields like isCorrect
export interface QuestionResult extends Omit<EvaluatedAnswer, 'awarded_marks'> {
  obtainedMarks: number;   // Alias for awarded_marks
  isCorrect: boolean;      // Convenience flag
}