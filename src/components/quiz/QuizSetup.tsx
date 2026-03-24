import { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { QuizConfig, QuestionConfig } from '@/types/quiz';
import { ArrowLeft, Plus, Trash2, Clock, BookOpen, Upload, FileText, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import * as pdfjsLib from 'pdfjs-dist';

// Set worker source
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

interface QuizSetupProps {
  onStart: (config: QuizConfig) => void;
  onBack: () => void;
  /** When launched from chat, the AI message becomes the question — subject is auto-filled */
  chatQuestion?: string | null;
  isLoading?: boolean;
}

const QuizSetup = ({ onStart, onBack, chatQuestion, isLoading }: QuizSetupProps) => {
  const autoSubject = chatQuestion
    ? chatQuestion.slice(0, 60).replace(/\n/g, ' ').trim()
    : '';

  const [subject, setSubject]           = useState(autoSubject);
  const [questions, setQuestions]       = useState<QuestionConfig[]>([{ marks: 1, count: 5 }]);
  const [timeHours, setTimeHours]       = useState(0);
  const [timeMinutes, setTimeMinutes]   = useState(30);
  const [mode, setMode]                 = useState<'normal' | 'real'>('normal');
  const [attachedFile, setAttachedFile] = useState<{ name: string; text: string } | null>(null);
  const [isExtracting, setIsExtracting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const totalMarks     = questions.reduce((sum, q) => sum + q.marks * q.count, 0);
  const totalQuestions = questions.reduce((sum, q) => sum + q.count, 0);

  const addQuestionType = () => {
    setQuestions(prev => [...prev, { marks: 2, count: 3 }]);
  };

  const removeQuestionType = (index: number) => {
    setQuestions(prev => prev.filter((_, i) => i !== index));
  };

  const updateQuestion = (index: number, field: keyof QuestionConfig, value: number | boolean) => {
    setQuestions(prev => prev.map((q, i) => i === index ? { ...q, [field]: value } : q));
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    const allowedTypes = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain',
    ];
    if (!allowedTypes.includes(file.type) && !file.name.match(/\.(txt|pdf|doc|docx)$/i)) {
      toast.error('Only PDF, Word, or text files are supported');
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      toast.error('File must be under 20MB');
      return;
    }

    setIsExtracting(true);
    try {
      // Send directly to the backend — it handles extraction + cleaning
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch('http://localhost:8000/api/upload-file', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
      const data = await res.json();

      if (!data.success) {
        toast.error(data.message || 'Could not process file');
        return;
      }

      // Store only the filename — quiz generation will use use_file_context: true
      setAttachedFile({ name: file.name, text: '__use_backend_context__' });

      if (!subject.trim()) {
        setSubject(file.name.replace(/\.[^.]+$/, '').slice(0, 60));
      }

      if (data.processing) {
        toast.info(`File uploaded — indexing in background. Start the quiz in a moment.`);
      } else {
        toast.success(`File "${file.name}" ready for quiz generation`);
      }
    } catch (err) {
      console.error('File upload error:', err);
      toast.error('Failed to upload file to server');
    } finally {
      setIsExtracting(false);
    }
  };

  const handleStart = () => {
    // If a file is attached, subject is the topic label and
    // useQuiz will use use_file_context: true on the backend
    const effectiveSubject = chatQuestion
      ? autoSubject
      : subject.trim() || (attachedFile ? attachedFile.name.replace(/\.[^.]+$/, '') : '');

    if (!effectiveSubject.trim()) return;
    if (timeHours === 0 && timeMinutes === 0) return;

    onStart({
      subject: effectiveSubject,
      questions,
      timeHours,
      timeMinutes,
      mode,
      useFileContext: !!attachedFile, // <-- new flag
    });
  };

  return (
    <div className="flex flex-1 flex-col items-center justify-center p-6 overflow-y-auto">
      <div className="w-full max-w-lg space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={onBack} className="shrink-0">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h2 className="text-2xl font-bold text-foreground">Quiz Setup</h2>
            <p className="text-sm text-muted-foreground">Configure your quiz parameters</p>
          </div>
        </div>

        {/* Subject */}
        {chatQuestion ? (
          <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
            <div className="flex items-center gap-2 mb-2">
              <BookOpen className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium text-foreground">Question from chat</span>
            </div>
            <p className="text-sm text-muted-foreground line-clamp-3">{chatQuestion}</p>
          </div>
        ) : (
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground flex items-center gap-2">
              <BookOpen className="h-4 w-4 text-primary" />
              Subject
            </label>
            <input
              type="text"
              value={subject}
              onChange={e => setSubject(e.target.value)}
              placeholder="e.g. Physics, Mathematics, History..."
              className="w-full rounded-xl border border-border bg-secondary/50 px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary/50 focus:outline-none"
            />

            {/* File attachment */}
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.doc,.docx,.txt"
              onChange={handleFileUpload}
              className="hidden"
            />
            {attachedFile ? (
              <div className="flex items-center gap-2 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3">
                <FileText className="h-4 w-4 text-primary shrink-0" />
                <span className="text-sm text-foreground flex-1 truncate">{attachedFile.name}</span>
                <button onClick={() => setAttachedFile(null)} className="text-muted-foreground hover:text-foreground">
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <Button
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
                disabled={isExtracting}
                className="w-full gap-2 rounded-xl"
              >
                {isExtracting ? (
                  <><div className="h-4 w-4 border-2 border-primary border-t-transparent rounded-full animate-spin" /> Extracting...</>
                ) : (
                  <><Upload className="h-4 w-4" /> Or upload a file (PDF, Word, TXT)</>
                )}
              </Button>
            )}
            <p className="text-xs text-muted-foreground">
              Type a subject or upload a document — questions will be generated from the content
            </p>
          </div>
        )}

        {/* Questions config */}
        {chatQuestion ? (
          <div className="space-y-3">
            <label className="text-sm font-medium text-foreground">Marks for this question</label>
            <div className="flex items-center gap-3 rounded-xl border border-border bg-secondary/30 p-3">
              <div className="flex-1">
                <label className="text-xs text-muted-foreground">Marks</label>
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={questions[0]?.marks ?? 2}
                  onChange={e => setQuestions([{ marks: parseInt(e.target.value) || 1, count: 1 }])}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary/50 focus:outline-none"
                />
              </div>
              <p className="text-xs text-muted-foreground flex-1">
                {questions[0]?.marks === 1
                  ? '4 choices (MCQ)'
                  : `Written answer (min ${(questions[0]?.marks ?? 2) * 10} words)`}
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <label className="text-sm font-medium text-foreground">Questions</label>
            {questions.map((q, i) => (
              <div key={i} className="flex items-center gap-3 rounded-xl border border-border bg-secondary/30 p-3">
                <div className="flex-1 space-y-1">
                  <div className="flex gap-3">
                    <div className="flex-1">
                      <label className="text-xs text-muted-foreground">Marks each</label>
                      <input
                        type="number"
                        min={1}
                        max={20}
                        value={q.marks}
                        onChange={e => updateQuestion(i, 'marks', parseInt(e.target.value) || 1)}
                        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary/50 focus:outline-none"
                      />
                    </div>
                    <div className="flex-1">
                      <label className="text-xs text-muted-foreground">No. of questions</label>
                      <input
                        type="number"
                        min={1}
                        max={50}
                        value={q.count}
                        onChange={e => updateQuestion(i, 'count', parseInt(e.target.value) || 1)}
                        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary/50 focus:outline-none"
                      />
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {q.marks === 1
                      ? '4 choices (MCQ)'
                      : `Written answer (min ${q.marks * 10} words)`}
                  </p>
                  {q.marks >= 2 && (
                    <label className="flex items-center gap-2 mt-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={q.orChoice || false}
                        onChange={e => updateQuestion(i, 'orChoice', e.target.checked)}
                        className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                      />
                      <span className="text-xs text-muted-foreground">Or Choice (1a/1b, 2a/2b — answer only one)</span>
                    </label>
                  )}
                </div>
                {questions.length > 1 && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => removeQuestionType(i)}
                    className="shrink-0 text-destructive hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            ))}
            <Button variant="outline" onClick={addQuestionType} className="w-full gap-2">
              <Plus className="h-4 w-4" /> Add Question Type
            </Button>
          </div>
        )}

        {/* Total Marks */}
        <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 text-center">
          <p className="text-sm text-muted-foreground">Total</p>
          <p className="text-2xl font-bold gradient-text">
            {totalQuestions} Questions • {totalMarks} Marks
          </p>
        </div>

        {/* Time */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground flex items-center gap-2">
            <Clock className="h-4 w-4 text-primary" />
            Time Limit
          </label>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="text-xs text-muted-foreground">Hours</label>
              <input
                type="number"
                min={0}
                max={5}
                value={timeHours}
                onChange={e => setTimeHours(parseInt(e.target.value) || 0)}
                className="w-full rounded-lg border border-border bg-secondary/50 px-3 py-2 text-sm text-foreground focus:border-primary/50 focus:outline-none"
              />
            </div>
            <div className="flex-1">
              <label className="text-xs text-muted-foreground">Minutes</label>
              <input
                type="number"
                min={0}
                max={59}
                value={timeMinutes}
                onChange={e => setTimeMinutes(parseInt(e.target.value) || 0)}
                className="w-full rounded-lg border border-border bg-secondary/50 px-3 py-2 text-sm text-foreground focus:border-primary/50 focus:outline-none"
              />
            </div>
          </div>
        </div>

        {/* Mode */}
        <div className="space-y-3">
          <label className="text-sm font-medium text-foreground">Mode</label>
          <div className="flex gap-3">
            <button
              onClick={() => setMode('normal')}
              className={cn(
                "flex-1 rounded-xl border p-4 text-left transition-all",
                mode === 'normal'
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border bg-secondary/30 text-muted-foreground hover:border-primary/30"
              )}
            >
              <p className="font-medium text-sm">Normal Mode</p>
              <p className="text-xs mt-1 opacity-70">Copy & paste allowed</p>
            </button>
            <button
              onClick={() => setMode('real')}
              className={cn(
                "flex-1 rounded-xl border p-4 text-left transition-all",
                mode === 'real'
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border bg-secondary/30 text-muted-foreground hover:border-primary/30"
              )}
            >
              <p className="font-medium text-sm">Real Mode</p>
              <p className="text-xs mt-1 opacity-70">No copy & paste</p>
            </button>
          </div>
        </div>

        {/* Start Button */}
        <Button
          onClick={handleStart}
          disabled={
            isLoading ||
            (chatQuestion ? false : (!subject.trim() && !attachedFile)) ||
            (timeHours === 0 && timeMinutes === 0)
          }
          className="w-full h-12 text-base font-semibold rounded-xl bg-primary text-primary-foreground hover:bg-primary/90"
        >
          {isLoading ? (
            <span className="flex items-center gap-2">
              <div className="h-4 w-4 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin" />
              Generating Questions...
            </span>
          ) : (
            'Confirm & Start Test'
          )}
        </Button>
      </div>
    </div>
  );
};

export default QuizSetup;