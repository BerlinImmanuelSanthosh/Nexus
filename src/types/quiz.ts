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
