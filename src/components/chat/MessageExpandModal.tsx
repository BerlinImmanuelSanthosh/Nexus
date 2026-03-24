import { memo, useState, useCallback, useMemo } from 'react';
import { Message } from '@/types/chat';
import { Sparkles, User } from 'lucide-react';
import { cn } from '@/lib/utils';

interface MessageExpandModalProps {
  message: Message;
  onClose: () => void;
}

const PARA_EMOJIS = ['🌟', '💡', '🎯', '🚀', '✨', '🎉', '🔑', '💫', '🌈', '🏆'];

// ── Helper: strip any leading lines that have zero alphabetic characters ──────
// This catches standalone emoji titles ("🌟", "✨ Python!") that the LLM
// sometimes generates despite prompt instructions.
// A line is kept if it is blank (paragraph separator) OR contains at least
// one alphabetic character.
function stripLeadingEmojiLines(text: string): string {
  const lines = text.split('\n');
  let start = 0;
  // Skip leading non-alphabetic lines (emoji titles, blank lines at top)
  while (start < lines.length && lines[start].trim() !== '' && !/[a-zA-Z]/.test(lines[start])) {
    start++;
  }
  return lines.slice(start).join('\n').trim();
}

// ── Helper: check whether a string has meaningful text content ───────────────
function hasMeaningfulText(s: string): boolean {
  return /[a-zA-Z]{3,}/.test(s); // at least 3 consecutive letters
}

const MessageExpandModal = memo(({ message, onClose }: MessageExpandModalProps) => {
  const [showRobotDialog, setShowRobotDialog] = useState(true);
  const [showReExplain, setShowReExplain]     = useState(false);
  const [paragraphs, setParagraphs]           = useState<string[]>([]);
  const [loading, setLoading]                 = useState(false);

  const isUser = message.role === 'user';

  const cleanedContent = useMemo(() => {
    if (!message.content) return '';
    return message.content
      .replace(/(Here is a .*study schedule[\s\S]*|Study Plan:[\s\S]*)/i, '')
      .trim();
  }, [message.content]);

  // ── Extract the actual TOPIC from the message content ────────────────────
  const plainTopic = useMemo(() => {
    let text = message.content || '';
    // Strip base64, HTML, markdown
    text = text.replace(/data:image\/[^;]+;base64,[A-Za-z0-9+/=]+/g, '');
    text = text.replace(/<[^>]+>/g, ' ');
    text = text.replace(/\*\*(.*?)\*\*/g, '$1').replace(/\*(.*?)\*/g, '$1');
    text = text.replace(/\s+/g, ' ').trim();

    const lines = text.split(/\n/).map((l: string) => l.trim()).filter(Boolean);

    // Skip ALL-CAPS section headings (like "WHAT IS IT", "HOW IT WORKS")
    // Find first line that has lowercase letters and at least 3 words
    const contentLine = lines.find(
      (l: string) => /[a-z]/.test(l) && l.split(' ').length >= 3
    );
    if (!contentLine) return 'this topic';

    // Extract the subject: "Python is a high-level..." → "Python"
    // Match word(s) before "is a/an/the" or "are"
    const subjectMatch = contentLine.match(/^([A-Z][a-zA-Z0-9\s\-]{0,30}?)\s+(?:is|are)\s+/);
    if (subjectMatch) {
      return subjectMatch[1].trim().slice(0, 40);
    }

    // Fallback: first 3 words of the content line
    return contentLine.split(' ').slice(0, 3).join(' ').slice(0, 40);
  }, [message.content]);

  const handleYes = useCallback(() => onClose(), [onClose]);

  const handleNo = useCallback(async () => {
    setShowRobotDialog(false);
    setLoading(true);

    try {
      const res = await fetch('http://localhost:8000/api/explain-like-child', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic: plainTopic, language: 'en' }),
      });

      if (!res.ok) throw new Error(`API error: ${res.status}`);
      const data = await res.json();

      // ── Backend returns PLAIN TEXT ───────────────────────────────────────
      // Do NOT put through div.innerHTML — it collapses newlines.
      const rawResponse: string = (data.response || '').trim();

      // ── Safety: strip any leading lines that are emoji-only ──────────────
      // Even if the backend is old/unpatched and still returns "🌟\n\ntext..."
      // this removes the emoji-only title before we split into paragraphs.
      const raw = stripLeadingEmojiLines(rawResponse);

      // ── If response is empty after stripping, show error ─────────────────
      if (!raw || !hasMeaningfulText(raw)) {
        setParagraphs(['Hmm, something went wrong getting a simple explanation. Please close and try again!']);
        setShowReExplain(true);
        return;
      }

      // ── Strategy 1: split on blank lines (backend-intended separator) ─────
      const byBlankLine = raw
        .split(/\n\s*\n/)
        .map((p: string) => p.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim())
        .filter((p: string) => p.length > 4 && hasMeaningfulText(p));

      if (byBlankLine.length >= 2) {
        setParagraphs(byBlankLine);
        setShowReExplain(true);
        return;
      }

      // ── Strategy 2: split on single newlines ─────────────────────────────
      const bySingleLine = raw
        .split(/\n/)
        .map((p: string) => p.trim())
        .filter((p: string) => p.length > 4 && hasMeaningfulText(p));

      if (bySingleLine.length >= 2) {
        setParagraphs(bySingleLine);
        setShowReExplain(true);
        return;
      }

      // ── Strategy 3: group every 2 sentences ──────────────────────────────
      const sentences = raw.match(/[^.!?]+[.!?]+/g) || [];
      if (sentences.length >= 2) {
        const chunks: string[] = [];
        for (let i = 0; i < sentences.length; i += 2) {
          const chunk = [sentences[i], sentences[i + 1]]
            .filter(Boolean)
            .join(' ')
            .trim();
          if (chunk && hasMeaningfulText(chunk)) chunks.push(chunk);
        }
        if (chunks.length > 0) {
          setParagraphs(chunks);
          setShowReExplain(true);
          return;
        }
      }

      // ── Strategy 4: whole response as one paragraph (last resort) ─────────
      // Only use if it actually has readable text — never fall back to [raw]
      // when raw is empty/emoji-only (that was the original bug: paragraphs=[""]
      // rendered only the PARA_EMOJIS[0] star with nothing after it).
      if (hasMeaningfulText(raw)) {
        setParagraphs([raw]);
      } else {
        setParagraphs(['Could not simplify this. Please close and try again!']);
      }
      setShowReExplain(true);

    } catch {
      setParagraphs(['Something went wrong. Please close and try again.']);
      setShowReExplain(true);
    } finally {
      setLoading(false);
    }
  }, [plainTopic]);

  return (
    <div
      className="fixed inset-0 z-50 bg-background/70 backdrop-blur-md animate-fade-in"
      onClick={onClose}
    >
      <div className="absolute inset-0 flex justify-center py-16 px-6">
        {/* Main content box */}
        <div
          className="flex-1 max-w-3xl rounded-2xl px-8 py-6 text-base leading-relaxed shadow-2xl border border-border/50 animate-scale-in max-h-[85vh] overflow-y-auto bg-chat-ai text-foreground"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center gap-3 mb-4">
            {isUser ? (
              <>
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-secondary">
                  <User className="h-4 w-4 text-secondary-foreground" />
                </div>
                <span className="text-sm font-medium text-muted-foreground">You</span>
              </>
            ) : (
              <>
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/20">
                  <Sparkles className="h-4 w-4 text-primary" />
                </div>
                <span className="text-sm font-medium text-muted-foreground">
                  {showReExplain ? 'NexusAI — Simple Version 🧒' : 'NexusAI'}
                </span>
              </>
            )}
          </div>

          {showReExplain ? (
            <div className="space-y-4">
              {paragraphs.map((para, i) => (
                  <p key={i} className="text-base leading-8 text-foreground">
                  <span className="mr-2">{PARA_EMOJIS[i % PARA_EMOJIS.length]}</span>
                  {para}
                </p>
              ))}
            </div>
          ) : (
            <div
              className="whitespace-pre-wrap text-lg"
              dangerouslySetInnerHTML={{ __html: cleanedContent }}
            />
          )}
        </div>

        {/* Robot panel - fixed position so it stays visible during scroll */}
        <div
          className="fixed right-8 top-20 flex flex-col items-center gap-3 z-[51]"
          onClick={(e) => e.stopPropagation()}
        >
          <RobotFace />

          {showRobotDialog && !showReExplain && !loading && (
            <div className="bg-card border border-border rounded-xl p-4 shadow-xl min-w-[180px] text-center">
              <p className="text-sm font-medium text-foreground mb-3">Do you understand?</p>
              <div className="flex gap-2">
                <button
                  onClick={handleYes}
                  className="flex-1 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
                >
                  Yes
                </button>
                <button
                  onClick={handleNo}
                  className="flex-1 px-3 py-1.5 rounded-lg bg-secondary text-secondary-foreground text-sm font-medium hover:bg-secondary/80 transition-colors"
                >
                  No
                </button>
              </div>
            </div>
          )}

          {loading && (
            <div className="bg-card border border-border rounded-xl p-4 shadow-xl min-w-[180px] text-center space-y-2">
              <div className="flex justify-center">
                <div className="h-5 w-5 rounded-full border-2 border-primary border-t-transparent animate-spin" />
              </div>
              <p className="text-sm font-medium text-foreground">Simplifying...</p>
            </div>
          )}

          {showReExplain && !loading && (
            <div className="bg-card border border-border rounded-xl p-4 shadow-xl min-w-[180px] text-center space-y-3">
              <p className="text-sm font-semibold text-foreground">Hope this helps! 🌟</p>
              <button
                onClick={onClose}
                className="w-full px-3 py-1.5 rounded-lg bg-secondary text-secondary-foreground text-xs font-medium hover:bg-secondary/80 border border-border transition-colors"
              >
                Close
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="pointer-events-none absolute bottom-6 left-1/2 -translate-x-1/2">
        <div className="px-4 py-2 rounded-full bg-card/80 backdrop-blur-sm border border-border text-xs text-muted-foreground shadow-lg">
          Click blank space to close
        </div>
      </div>
    </div>
  );
});

const RobotFace = memo(() => (
  <div className="relative">
    <div className="absolute -inset-2 rounded-full bg-primary/15 blur-lg animate-pulse" />
    <div className="relative h-16 w-16 rounded-2xl bg-gradient-to-br from-primary/30 via-primary/20 to-primary/10 border border-primary/40 shadow-lg overflow-hidden flex flex-col items-center justify-center">
      <div className="flex gap-2 mb-1.5">
        <div className="h-3 w-3 rounded-full bg-background/80 border border-primary/50 flex items-center justify-center">
          <div className="h-1.5 w-1.5 rounded-full bg-primary" />
        </div>
        <div className="h-3 w-3 rounded-full bg-background/80 border border-primary/50 flex items-center justify-center">
          <div className="h-1.5 w-1.5 rounded-full bg-primary" />
        </div>
      </div>
      <div className="w-4 h-2 border-b-2 border-primary/60 rounded-b-full" />
    </div>
  </div>
));

RobotFace.displayName = 'RobotFace';
MessageExpandModal.displayName = 'MessageExpandModal';
export default MessageExpandModal;