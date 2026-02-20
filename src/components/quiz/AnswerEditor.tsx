import {
  useRef, useState, useEffect, useCallback, forwardRef, useImperativeHandle,
} from 'react';
import { cn } from '@/lib/utils';
import {
  Pen, Square, Circle, Minus, Eraser, Trash2,
  ChevronDown, Triangle, Type, PlusCircle,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

type DrawTool = 'pen' | 'rect' | 'ellipse' | 'line' | 'triangle' | 'eraser' | null;

interface DrawStroke {
  type: 'pen' | 'rect' | 'ellipse' | 'line' | 'triangle';
  points?: { x: number; y: number }[];
  x?: number; y?: number; w?: number; h?: number;
  x1?: number; y1?: number; x2?: number; y2?: number;
  color: string;
  lineWidth: number;
  id: string;
}

type Block =
  | { id: string; kind: 'text'; content: string }
  | { id: string; kind: 'drawing'; strokes: DrawStroke[]; height: number };

export interface AnswerEditorRef {
  getExportData: () => { text: string; canvasData: string };
}

interface AnswerEditorProps {
  placeholder?: string;
  minWords?: number;
  readOnly?: boolean;
  onCopy?: (e: React.ClipboardEvent) => void;
  onPaste?: (e: React.ClipboardEvent) => void;
  className?: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const COLORS = ['#a78bfa', '#f472b6', '#34d399', '#60a5fa', '#fbbf24', '#f87171', '#e2e8f0', '#94a3b8'];
const uid = () => Math.random().toString(36).slice(2, 10);
const CANVAS_H = 220;

// ─── Drawing canvas block ─────────────────────────────────────────────────────

interface DrawBlockProps {
  block: Extract<Block, { kind: 'drawing' }>;
  activeTool: DrawTool;
  color: string;
  lineWidth: number;
  readOnly: boolean;
  onStrokesChange: (id: string, strokes: DrawStroke[]) => void;
  onDelete: (id: string) => void;
}

const DrawBlock = ({
  block, activeTool, color, lineWidth, readOnly,
  onStrokesChange, onDelete,
}: DrawBlockProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDrawing = useRef(false);
  const currentStroke = useRef<DrawStroke | null>(null);
  const startPt = useRef<{ x: number; y: number } | null>(null);
  const strokesRef = useRef<DrawStroke[]>(block.strokes);

  useEffect(() => { strokesRef.current = block.strokes; }, [block.strokes]);

  const getPos = (e: React.MouseEvent | React.TouchEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    if ('touches' in e) {
      const t = e.touches[0];
      return { x: t.clientX - rect.left, y: t.clientY - rect.top };
    }
    return { x: (e as React.MouseEvent).clientX - rect.left, y: (e as React.MouseEvent).clientY - rect.top };
  };

  const drawAll = useCallback((ctx: CanvasRenderingContext2D, strokes: DrawStroke[], preview?: DrawStroke) => {
    const canvas = canvasRef.current!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const all = preview ? [...strokes, preview] : strokes;
    all.forEach(s => {
      ctx.strokeStyle = s.color;
      ctx.lineWidth = s.lineWidth;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      if (s.type === 'pen' && s.points && s.points.length > 1) {
        ctx.beginPath();
        ctx.moveTo(s.points[0].x, s.points[0].y);
        s.points.slice(1).forEach(p => ctx.lineTo(p.x, p.y));
        ctx.stroke();
      } else if (s.type === 'rect' && s.w !== undefined) {
        ctx.strokeRect(s.x!, s.y!, s.w, s.h!);
      } else if (s.type === 'ellipse' && s.w !== undefined) {
        ctx.beginPath();
        ctx.ellipse(s.x! + s.w / 2, s.y! + s.h! / 2, Math.abs(s.w / 2), Math.abs(s.h! / 2), 0, 0, Math.PI * 2);
        ctx.stroke();
      } else if (s.type === 'line') {
        ctx.beginPath(); ctx.moveTo(s.x1!, s.y1!); ctx.lineTo(s.x2!, s.y2!); ctx.stroke();
      } else if (s.type === 'triangle' && s.w !== undefined) {
        ctx.beginPath();
        ctx.moveTo(s.x! + s.w / 2, s.y!);
        ctx.lineTo(s.x!, s.y! + s.h!);
        ctx.lineTo(s.x! + s.w, s.y! + s.h!);
        ctx.closePath(); ctx.stroke();
      }
    });
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    drawAll(ctx, block.strokes);
  }, [block.strokes, drawAll]);

  const onDown = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (!activeTool || readOnly) return;
    e.preventDefault();
    const pos = getPos(e);

    if (activeTool === 'eraser') {
      const filtered = strokesRef.current.filter(s => {
        if (s.type === 'pen' && s.points)
          return !s.points.some(p => Math.hypot(p.x - pos.x, p.y - pos.y) < 18);
        return true;
      });
      onStrokesChange(block.id, filtered);
      return;
    }

    isDrawing.current = true;
    startPt.current = pos;
    currentStroke.current = activeTool === 'line'
      ? { type: 'line', x1: pos.x, y1: pos.y, x2: pos.x, y2: pos.y, color, lineWidth, id: uid() }
      : activeTool === 'pen'
        ? { type: 'pen', points: [pos], color, lineWidth, id: uid() }
        : { type: activeTool as DrawStroke['type'], x: pos.x, y: pos.y, w: 0, h: 0, color, lineWidth, id: uid() };
  }, [activeTool, color, lineWidth, readOnly, block.id, onStrokesChange]);

  const onMove = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing.current || !currentStroke.current) return;
    e.preventDefault();
    const pos = getPos(e);
    const cs = currentStroke.current;
    if (cs.type === 'pen') cs.points!.push(pos);
    else if (cs.type === 'line') { cs.x2 = pos.x; cs.y2 = pos.y; }
    else {
      const sp = startPt.current!;
      cs.x = Math.min(sp.x, pos.x); cs.y = Math.min(sp.y, pos.y);
      cs.w = Math.abs(pos.x - sp.x); cs.h = Math.abs(pos.y - sp.y);
    }
    const ctx = canvasRef.current?.getContext('2d');
    if (ctx) drawAll(ctx, strokesRef.current, currentStroke.current);
  }, [drawAll]);

  const onUp = useCallback(() => {
    if (!isDrawing.current || !currentStroke.current) return;
    isDrawing.current = false;
    const newStrokes = [...strokesRef.current, currentStroke.current];
    onStrokesChange(block.id, newStrokes);
    currentStroke.current = null;
  }, [block.id, onStrokesChange]);

  const canvasActive = !!activeTool;

  return (
    <div className="relative group/drawblock border border-border rounded-lg overflow-hidden bg-background/60">
      <canvas
        ref={canvasRef}
        width={800}
        height={CANVAS_H}
        className={cn(
          "w-full block",
          canvasActive && !readOnly
            ? activeTool === 'eraser' ? 'cursor-cell' : 'cursor-crosshair'
            : 'cursor-default'
        )}
        style={{ height: CANVAS_H }}
        onMouseDown={onDown}
        onMouseMove={onMove}
        onMouseUp={onUp}
        onMouseLeave={onUp}
        onTouchStart={onDown}
        onTouchMove={onMove}
        onTouchEnd={onUp}
      />
      {block.strokes.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <p className="text-xs text-muted-foreground opacity-40">
            {canvasActive ? 'Draw here…' : 'Select a draw tool above, then draw here'}
          </p>
        </div>
      )}
      {!readOnly && (
        <button
          onClick={() => onDelete(block.id)}
          className="absolute top-2 right-2 opacity-0 group-hover/drawblock:opacity-100 transition-opacity p-1 rounded-md bg-background/80 text-destructive hover:bg-destructive/10"
          title="Remove this drawing"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
};

// ─── Main AnswerEditor ────────────────────────────────────────────────────────

const AnswerEditor = forwardRef<AnswerEditorRef, AnswerEditorProps>(({
  placeholder = 'Type your answer here… add a drawing block below if needed.',
  minWords = 0,
  readOnly = false,
  onCopy,
  onPaste,
  className,
}, ref) => {
  const [blocks, setBlocks] = useState<Block[]>([
    { id: uid(), kind: 'text', content: '' },
  ]);
  const [activeTool, setActiveTool] = useState<DrawTool>(null);
  const [color, setColor] = useState('#a78bfa');
  const [lineWidth, setLineWidth] = useState(3);
  const [showColors, setShowColors] = useState(false);

  // Gather all text for word count
  const allText = blocks
    .filter((b): b is Extract<Block, { kind: 'text' }> => b.kind === 'text')
    .map(b => b.content)
    .join(' ');
  const wordCount = allText.split(/\s+/).filter(Boolean).length;

  const updateTextBlock = useCallback((id: string, content: string) => {
    setBlocks(prev => prev.map(b => b.id === id && b.kind === 'text' ? { ...b, content } : b));
  }, []);

  const updateDrawingStrokes = useCallback((id: string, strokes: DrawStroke[]) => {
    setBlocks(prev => prev.map(b => b.id === id && b.kind === 'drawing' ? { ...b, strokes } : b));
  }, []);

  const insertDrawingAfter = useCallback((afterId: string) => {
    setBlocks(prev => {
      const idx = prev.findIndex(b => b.id === afterId);
      const newDrawing: Block = { id: uid(), kind: 'drawing', strokes: [], height: CANVAS_H };
      const newText: Block = { id: uid(), kind: 'text', content: '' };
      const next = [...prev];
      next.splice(idx + 1, 0, newDrawing, newText);
      return next;
    });
    // Auto-activate pen when inserting a drawing
    setActiveTool('pen');
  }, []);

  const deleteBlock = useCallback((id: string) => {
    setBlocks(prev => {
      const filtered = prev.filter(b => b.id !== id);
      // Always keep at least one text block
      return filtered.length === 0 ? [{ id: uid(), kind: 'text', content: '' }] : filtered;
    });
  }, []);

  // Export: combine all text blocks and canvas snapshots
  useImperativeHandle(ref, () => ({
    getExportData: () => {
      const text = blocks
        .filter((b): b is Extract<Block, { kind: 'text' }> => b.kind === 'text')
        .map(b => b.content)
        .join('\n\n');
      // We capture the first drawing's data URL if any
      // Full multi-block export would need refs per canvas — simplified to text here
      return { text, canvasData: '' };
    },
  }));

  const toolButtons: { id: DrawTool; icon: React.ReactNode; label: string }[] = [
    { id: 'pen', icon: <Pen className="h-3.5 w-3.5" />, label: 'Pen' },
    { id: 'rect', icon: <Square className="h-3.5 w-3.5" />, label: 'Rectangle' },
    { id: 'ellipse', icon: <Circle className="h-3.5 w-3.5" />, label: 'Ellipse' },
    { id: 'triangle', icon: <Triangle className="h-3.5 w-3.5" />, label: 'Triangle' },
    { id: 'line', icon: <Minus className="h-3.5 w-3.5" />, label: 'Line' },
    { id: 'eraser', icon: <Eraser className="h-3.5 w-3.5" />, label: 'Eraser' },
  ];

  return (
    <div className={cn("flex flex-col rounded-xl border border-border overflow-hidden bg-background", className)}>
      {/* Unified toolbar */}
      <div className="flex items-center gap-1 flex-wrap px-2 py-1.5 border-b border-border bg-secondary/40">
        {/* Text mode toggle */}
        <button
          onClick={() => setActiveTool(null)}
          title="Text mode (click to type)"
          className={cn(
            "flex items-center gap-1 px-2 py-1.5 rounded-md text-xs font-medium transition-all",
            activeTool === null
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-secondary hover:text-foreground"
          )}
        >
          <Type className="h-3.5 w-3.5" /> Type
        </button>

        <div className="h-5 w-px bg-border mx-0.5" />

        {/* Draw tools */}
        {toolButtons.map(btn => (
          <button
            key={btn.id}
            onClick={() => setActiveTool(prev => prev === btn.id ? null : btn.id)}
            title={btn.label}
            className={cn(
              "p-1.5 rounded-md transition-all",
              activeTool === btn.id
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-secondary hover:text-foreground"
            )}
          >
            {btn.icon}
          </button>
        ))}

        <div className="h-5 w-px bg-border mx-0.5" />

        {/* Color picker */}
        <div className="relative">
          <button
            onClick={() => setShowColors(p => !p)}
            className="flex items-center gap-1 rounded-md px-1.5 py-1 hover:bg-secondary transition-all"
            title="Color"
          >
            <span className="h-4 w-4 rounded-full border border-border" style={{ background: color }} />
            <ChevronDown className="h-3 w-3 text-muted-foreground" />
          </button>
          {showColors && (
            <div className="absolute top-full left-0 mt-1 z-50 flex gap-1 p-2 rounded-xl border border-border bg-background shadow-xl">
              {COLORS.map(c => (
                <button
                  key={c}
                  onClick={() => { setColor(c); setShowColors(false); }}
                  className={cn(
                    "h-5 w-5 rounded-full border-2 transition-all hover:scale-110",
                    color === c ? "border-foreground scale-110" : "border-transparent"
                  )}
                  style={{ background: c }}
                />
              ))}
              <input
                type="color"
                value={color}
                onChange={e => setColor(e.target.value)}
                className="h-5 w-5 rounded-full cursor-pointer border border-border bg-transparent"
                title="Custom color"
              />
            </div>
          )}
        </div>

        {/* Stroke width */}
        {[2, 4, 7].map(w => (
          <button
            key={w}
            onClick={() => setLineWidth(w)}
            title={`Stroke ${w}px`}
            className={cn(
              "flex items-center justify-center rounded-md p-1.5 transition-all",
              lineWidth === w ? "bg-primary/20" : "hover:bg-secondary"
            )}
          >
            <span className="block rounded-full" style={{ width: w * 2.5 + 4, height: w, background: color }} />
          </button>
        ))}
      </div>

      {/* Blocks */}
      <div className="flex flex-col gap-0">
        {blocks.map((block, idx) => {
          if (block.kind === 'text') {
            const isFirst = idx === 0;
            return (
              <div key={block.id} className="relative group/textblock">
                <textarea
                  value={block.content}
                  onChange={e => updateTextBlock(block.id, e.target.value)}
                  placeholder={isFirst ? placeholder : 'Continue writing…'}
                  readOnly={readOnly || !!activeTool}
                  onCopy={onCopy}
                  onPaste={onPaste}
                  onClick={() => { if (activeTool) setActiveTool(null); }}
                  className={cn(
                    "w-full resize-none bg-transparent px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none min-h-[80px]",
                    activeTool ? "cursor-default opacity-70" : "cursor-text"
                  )}
                  rows={3}
                  onInput={e => {
                    const t = e.currentTarget;
                    t.style.height = 'auto';
                    t.style.height = t.scrollHeight + 'px';
                  }}
                />
                {/* Insert drawing button — shown between/after text blocks */}
                {!readOnly && (
                  <div className="flex justify-center opacity-0 group-hover/textblock:opacity-100 transition-opacity py-0.5">
                    <button
                      onClick={() => insertDrawingAfter(block.id)}
                      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors px-3 py-1 rounded-full border border-dashed border-border hover:border-primary/50"
                    >
                      <PlusCircle className="h-3 w-3" /> Insert drawing here
                    </button>
                  </div>
                )}
              </div>
            );
          }

          if (block.kind === 'drawing') {
            return (
              <div key={block.id} className="px-3 py-2">
                <DrawBlock
                  block={block}
                  activeTool={activeTool}
                  color={color}
                  lineWidth={lineWidth}
                  readOnly={readOnly}
                  onStrokesChange={updateDrawingStrokes}
                  onDelete={deleteBlock}
                />
              </div>
            );
          }

          return null;
        })}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-4 py-1.5 border-t border-border bg-secondary/20">
        <p className="text-xs text-muted-foreground">
          {wordCount} words{minWords > 0 ? ` / ${minWords} min` : ''}
          {activeTool && <span className="ml-2 text-primary">● Draw mode: {activeTool}</span>}
        </p>
        {minWords > 0 && wordCount >= minWords && (
          <p className="text-xs text-primary">✓ Word count met</p>
        )}
      </div>
    </div>
  );
});

AnswerEditor.displayName = 'AnswerEditor';
export default AnswerEditor;
