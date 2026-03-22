import { Message } from '@/types/chat';
import { User, Sparkles, Copy, Check, ClipboardList, X, Map, FileDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useMemo, memo, useState, useCallback } from 'react';
import jsPDF from 'jspdf';

interface MessageBubbleProps {
  message: Message;
  onExpand?: (message: Message) => void;
  onTakeTest?: (question: string) => void;
  onRoadmap?: (subject: string) => void;
}

const MessageBubble = memo(({ message, onExpand, onTakeTest, onRoadmap }: MessageBubbleProps) => {
  const isUser = message.role === 'user';
  const [copied, setCopied]               = useState(false);
  const [enlargedImage, setEnlargedImage] = useState<string | null>(null);

  const formattedContent = useMemo(() => {
    return message.content
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>');
  }, [message.content]);

  const contentHasImage = useMemo(() => {
    return message.content.includes('<img') || message.content.includes('data:image');
  }, [message.content]);

  const handleCopy = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!message.content) return;
    const div = document.createElement('div');
    div.innerHTML = formattedContent;
    const plain = div.innerText.replace(/Here is a .*study schedule[\s\S]*/i, '').trim();
    await navigator.clipboard.writeText(plain);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [formattedContent, message.content]);

  const isGreeting = useMemo(() => {
    const greetings = [
      'hello', 'hi', 'hey', 'good morning', 'good afternoon',
      'good evening', 'howdy', 'greetings', 'how can i help',
      'how may i help', 'welcome', 'what can i do', 'how are you',
    ];
    const lower = message.content.toLowerCase().trim();
    return (
      (greetings.some(g => lower.startsWith(g)) && lower.length < 150) ||
      lower.includes('how can i help') ||
      lower.includes('how may i assist')
    );
  }, [message.content]);

  const handleBubbleClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('[data-image-container="true"]')) return;
    const imgEl = target.tagName === 'IMG'
      ? (target as HTMLImageElement)
      : (target.closest('img') as HTMLImageElement | null);
    if (imgEl?.src) { setEnlargedImage(imgEl.src); return; }
    if (isGreeting) return;
    onExpand?.(message);
  }, [message, onExpand, isGreeting]);

  const handleImageClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setEnlargedImage(message.imageUrl!);
  }, [message.imageUrl]);

  const handleTakeTest = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onTakeTest?.(message.content);
  }, [message.content, onTakeTest]);

  const handleRoadmap = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const plain = message.content.replace(/<[^>]*>/g, '').replace(/\*\*/g, '');
    const topic = plain.split(/[.\n]/)[0]?.trim().slice(0, 60) || 'Topic';
    onRoadmap?.(topic);
  }, [message.content, onRoadmap]);

  // ── PDF GENERATION ────────────────────────────────────────────────────────
  const handleConvertToPdf = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();

    const doc   = new jsPDF({ unit: 'mm', format: 'a4' });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const margin = 20;
    const maxW   = pageW - margin * 2;
    const lineH  = 6;
    let   y      = margin;

    const checkPage = () => {
      if (y + lineH > pageH - margin) { doc.addPage(); y = margin; }
    };

    const toPlain = (html: string): string => {
      return html
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(?:p|div|li|h[1-6]|tr|blockquote|pre)>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\*\*(.*?)\*\*/g, '$1')
        .replace(/\*(.*?)\*/g, '$1')
        .replace(/^#{1,6}\s+/gm, '')
        .replace(/[\u2018\u2019\u0060\u00B4]/g, "'")
        .replace(/[\u201C\u201D\u00AB\u00BB]/g, '"')
        .replace(/[\u2013\u2014\u2015]/g, '-')
        .replace(/\u2026/g, '...')
        .replace(/\u2022|\u2023|\u25E6|\u2043/g, '-')
        .replace(/\u00A0/g, ' ')
        .replace(/[^\x00-\xFF]/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .replace(/[ \t]+/g, ' ')
        .trim();
    };

    if (message.imageUrl) {
      try {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        await new Promise<void>((res, rej) => {
          img.onload  = () => res();
          img.onerror = () => rej();
          img.src = message.imageUrl!;
        });
        const canvas = document.createElement('canvas');
        canvas.width  = img.naturalWidth;
        canvas.height = img.naturalHeight;
        canvas.getContext('2d')!.drawImage(img, 0, 0);
        const imgH     = (img.naturalHeight / img.naturalWidth) * maxW;
        const clampedH = Math.min(imgH, 80);
        doc.addImage(canvas.toDataURL('image/jpeg', 0.85), 'JPEG', margin, y, maxW, clampedH);
        y += clampedH + 6;
      } catch { /* skip image silently */ }
    }

    const rawText = toPlain(message.content);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    doc.setTextColor(0);

    const paragraphs = rawText.split(/\n/);
    for (const para of paragraphs) {
      const trimmed = para.trim();
      if (!trimmed) {
        y += lineH * 0.5;
        continue;
      }
      const lines: string[] = doc.splitTextToSize(trimmed, maxW);
      for (const line of lines) {
        checkPage();
        doc.text(line, margin, y);
        y += lineH;
      }
    }

    const total = doc.getNumberOfPages();
    for (let i = 1; i <= total; i++) {
      doc.setPage(i);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(150);
      doc.text('Generated by NexusAI', margin, pageH - 8);
      doc.text(`Page ${i} of ${total}`, pageW - margin - 22, pageH - 8);
      doc.setTextColor(0);
    }

    doc.save('nexusai-response.pdf');
  }, [message.imageUrl, message.content]);

  // ── Detect SVG data URL so we can render it at full natural size ──────────
  const isSvgImage = message.imageUrl?.startsWith('data:image/svg+xml');

  return (
    <>
      {enlargedImage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm animate-fade-in"
          onClick={() => setEnlargedImage(null)}
        >
          <button
            className="absolute top-4 right-4 text-white/80 hover:text-white z-10 bg-black/30 rounded-full p-1"
            onClick={(e) => { e.stopPropagation(); setEnlargedImage(null); }}
          >
            <X className="h-6 w-6" />
          </button>
          <img
            src={enlargedImage}
            alt=""
            className="max-w-[92vw] max-h-[92vh] rounded-xl object-contain shadow-2xl animate-scale-in"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}

      <div className={cn("flex flex-col gap-1", isUser ? "items-end" : "items-start")}>
        <div className={cn("flex gap-4 animate-fade-in", isUser ? "justify-end" : "justify-start")}>
          {!isUser && (
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/20">
              <Sparkles className="h-4 w-4 text-primary" />
            </div>
          )}

          <div
            className={cn(
              "max-w-[70%] rounded-2xl px-4 py-3 text-sm leading-relaxed",
              "transition-all duration-200 hover:shadow-lg hover:shadow-primary/5",
              isUser
                ? "bg-chat-user text-foreground rounded-br-md cursor-default"
                : "bg-chat-ai text-foreground rounded-bl-md",
              !isGreeting && !isUser ? "cursor-pointer" : "cursor-default",
            )}
            onClick={handleBubbleClick}
          >
            {message.imageUrl && !isUser && !contentHasImage && (
              <div
                data-image-container="true"
                className="mb-3 overflow-hidden rounded-xl cursor-zoom-in relative group/img"
                onClick={handleImageClick}
              >
                {/* ── ONLY CHANGE: SVG gets w-full h-auto (natural size);    */}
                {/*   regular images keep the original h-40 object-cover.     */}
                <img
                  src={message.imageUrl}
                  alt=""
                  className={
                    isSvgImage
                      ? "w-full h-auto hover:opacity-90 transition-opacity"
                      : "w-full h-40 object-cover hover:opacity-90 transition-opacity"
                  }
                  loading="lazy"
                  draggable={false}
                />
                <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover/img:opacity-100 transition-opacity bg-black/20 rounded-xl pointer-events-none">
                  <span className="text-white text-xs font-medium bg-black/50 px-2 py-1 rounded-full">
                    Click to enlarge
                  </span>
                </div>
              </div>
            )}
            <div
              className="whitespace-pre-wrap"
              dangerouslySetInnerHTML={{ __html: formattedContent }}
            />
          </div>

          {isUser && (
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary">
              <User className="h-4 w-4 text-secondary-foreground" />
            </div>
          )}
        </div>

        <div className={cn("flex items-center gap-3 px-12", isUser ? "self-end" : "self-start")}>
          <button onClick={handleCopy} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors py-1">
            {copied
              ? <><Check className="h-3 w-3 text-primary" /><span className="text-primary">Copied!</span></>
              : <><Copy className="h-3 w-3" /><span>Copy</span></>}
          </button>

          {!isUser && !isGreeting && onTakeTest && (
            <button onClick={handleTakeTest} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors py-1">
              <ClipboardList className="h-3 w-3" /><span>Take Test</span>
            </button>
          )}

          {!isUser && !isGreeting && (
            <button onClick={handleConvertToPdf} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors py-1">
              <FileDown className="h-3 w-3" /><span>Save as PDF</span>
            </button>
          )}
        </div>

        {!isUser && !isGreeting && onRoadmap && (
          <div className={cn("px-12", "self-start")}>
            <button
              onClick={handleRoadmap}
              className="flex items-center gap-2 mt-1 px-4 py-2 text-xs font-medium rounded-xl bg-primary/10 text-primary hover:bg-primary/20 border border-primary/20 hover:border-primary/40 transition-all"
            >
              <Map className="h-3.5 w-3.5" /><span>Build Your Roadmap</span>
            </button>
          </div>
        )}
      </div>
    </>
  );
});

MessageBubble.displayName = 'MessageBubble';
export default MessageBubble;