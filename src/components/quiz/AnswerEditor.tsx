import { useRef, useState, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react';
import { cn } from '@/lib/utils';
import {
  Pen, Type, Square, Circle, Minus, Eraser, Trash2,
  MousePointer2, ChevronDown, Triangle
} from 'lucide-react';

type Tool = 'select' | 'pen' | 'text' | 'rect' | 'ellipse' | 'line' | 'triangle' | 'eraser';

interface DrawPath {
  type: 'pen' | 'rect' | 'ellipse' | 'line' | 'triangle';
  points?: { x: number; y: number }[];
  x?: number; y?: number; w?: number; h?: number;
  x1?: number; y1?: number; x2?: number; y2?: number;
  color: string;
  lineWidth: number;
  id: string;
}

interface TextBlock {
  id: string;
  x: number;
  y: number;
  text: string;
  color: string;
  fontSize: number;
}

export interface AnswerEditorRef {
  getExportData: () => { text: string; canvasData: string };
  loadData: (text: string, canvasData: string) => void;
}

interface AnswerEditorProps {
  placeholder?: string;
  minWords?: number;
  readOnly?: boolean;
  onCopy?: (e: React.ClipboardEvent) => void;
  onPaste?: (e: React.ClipboardEvent) => void;
  className?: string;
}

const COLORS = ['#a78bfa', '#f472b6', '#34d399', '#60a5fa', '#fbbf24', '#f87171', '#e2e8f0', '#1e293b'];

const uid = () => Math.random().toString(36).slice(2, 10);

const AnswerEditor = forwardRef<AnswerEditorRef, AnswerEditorProps>(({
  placeholder = 'Type your answer here, or switch to Draw mode...',
  minWords = 0,
  readOnly = false,
  onCopy,
  onPaste,
  className,
}, ref) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Shared state
  const [mode, setMode] = useState<'text' | 'draw'>('text');
  const [typedText, setTypedText] = useState('');

  // Draw state
  const [tool, setTool] = useState<Tool>('pen');
  const [color, setColor] = useState('#a78bfa');
  const [lineWidth, setLineWidth] = useState(3);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [paths, setPaths] = useState<DrawPath[]>([]);
  const [textBlocks, setTextBlocks] = useState<TextBlock[]>([]);

  // Drawing refs (avoid stale closures)
  const isDrawing = useRef(false);
  const currentPath = useRef<DrawPath | null>(null);
  const startPoint = useRef<{ x: number; y: number } | null>(null);
  const pathsRef = useRef<DrawPath[]>([]);
  const textBlocksRef = useRef<TextBlock[]>([]);

  // Editing text block
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState('');
  const editInputRef = useRef<HTMLInputElement>(null);

  // Canvas size
  const [canvasSize, setCanvasSize] = useState({ w: 600, h: 340 });

  useEffect(() => { pathsRef.current = paths; }, [paths]);
  useEffect(() => { textBlocksRef.current = textBlocks; }, [textBlocks]);

  // Resize observer
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      const entry = entries[0];
      const w = Math.floor(entry.contentRect.width);
      if (w > 0) {
        setCanvasSize(prev => {
          if (prev.w === w) return prev;
          return { w, h: prev.h };
        });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Redraw canvas
  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const drawPath = (p: DrawPath) => {
      ctx.strokeStyle = p.color;
      ctx.lineWidth = p.lineWidth;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      if (p.type === 'pen' && p.points && p.points.length > 1) {
        ctx.beginPath();
        ctx.moveTo(p.points[0].x, p.points[0].y);
        for (let i = 1; i < p.points.length; i++) {
          ctx.lineTo(p.points[i].x, p.points[i].y);
        }
        ctx.stroke();
      } else if (p.type === 'rect' && p.w !== undefined && p.h !== undefined) {
        ctx.beginPath();
        ctx.strokeRect(p.x!, p.y!, p.w, p.h);
      } else if (p.type === 'ellipse' && p.w !== undefined && p.h !== undefined) {
        ctx.beginPath();
        ctx.ellipse(p.x! + p.w / 2, p.y! + p.h / 2, Math.abs(p.w / 2), Math.abs(p.h / 2), 0, 0, Math.PI * 2);
        ctx.stroke();
      } else if (p.type === 'line') {
        ctx.beginPath();
        ctx.moveTo(p.x1!, p.y1!);
        ctx.lineTo(p.x2!, p.y2!);
        ctx.stroke();
      } else if (p.type === 'triangle' && p.w !== undefined && p.h !== undefined) {
        ctx.beginPath();
        ctx.moveTo(p.x! + p.w / 2, p.y!);
        ctx.lineTo(p.x!, p.y! + p.h);
        ctx.lineTo(p.x! + p.w, p.y! + p.h);
        ctx.closePath();
        ctx.stroke();
      }
    };

    pathsRef.current.forEach(drawPath);

    // Draw text blocks
    textBlocksRef.current.forEach(tb => {
      ctx.font = `${tb.fontSize}px sans-serif`;
      ctx.fillStyle = tb.color;
      ctx.fillText(tb.text, tb.x, tb.y);
    });
  }, []);

  useEffect(() => { redraw(); }, [paths, textBlocks, redraw, canvasSize]);

  const getPos = (e: React.MouseEvent | React.TouchEvent): { x: number; y: number } => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    if ('touches' in e) {
      const t = (e as React.TouchEvent).touches[0];
      return { x: t.clientX - rect.left, y: t.clientY - rect.top };
    }
    return { x: (e as React.MouseEvent).clientX - rect.left, y: (e as React.MouseEvent).clientY - rect.top };
  };

  const handlePointerDown = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (readOnly || tool === 'select') return;
    e.preventDefault();
    const pos = getPos(e);

    if (tool === 'text') {
      // Create a new text block
      const id = uid();
      setEditingTextId(id);
      setEditingValue('');
      setTextBlocks(prev => [...prev, { id, x: pos.x, y: pos.y, text: '', color, fontSize: 16 }]);
      setTimeout(() => editInputRef.current?.focus(), 50);
      return;
    }

    if (tool === 'eraser') {
      // Erase paths near point
      setPaths(prev => prev.filter(p => {
        if (p.type === 'pen' && p.points) {
          return !p.points.some(pt => Math.hypot(pt.x - pos.x, pt.y - pos.y) < 16);
        }
        return true;
      }));
      setTextBlocks(prev => prev.filter(tb => {
        return !(Math.abs(tb.x - pos.x) < 60 && Math.abs(tb.y - pos.y) < 20);
      }));
      return;
    }

    isDrawing.current = true;
    startPoint.current = pos;

    if (tool === 'pen') {
      const newPath: DrawPath = { type: 'pen', points: [pos], color, lineWidth, id: uid() };
      currentPath.current = newPath;
    } else {
      const shapeType = tool as DrawPath['type'];
      if (shapeType === 'line') {
        currentPath.current = { type: 'line', x1: pos.x, y1: pos.y, x2: pos.x, y2: pos.y, color, lineWidth, id: uid() };
      } else {
        currentPath.current = { type: shapeType, x: pos.x, y: pos.y, w: 0, h: 0, color, lineWidth, id: uid() };
      }
    }
  }, [tool, color, lineWidth, readOnly]);

  const handlePointerMove = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing.current || !currentPath.current || readOnly) return;
    e.preventDefault();
    const pos = getPos(e);

    if (currentPath.current.type === 'pen') {
      currentPath.current.points!.push(pos);
    } else if (currentPath.current.type === 'line') {
      currentPath.current.x2 = pos.x;
      currentPath.current.y2 = pos.y;
    } else {
      const sp = startPoint.current!;
      currentPath.current.x = Math.min(sp.x, pos.x);
      currentPath.current.y = Math.min(sp.y, pos.y);
      currentPath.current.w = Math.abs(pos.x - sp.x);
      currentPath.current.h = Math.abs(pos.y - sp.y);
    }

    // Live preview
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // Redraw all committed
    pathsRef.current.forEach(p => {
      ctx.strokeStyle = p.color;
      ctx.lineWidth = p.lineWidth;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      if (p.type === 'pen' && p.points && p.points.length > 1) {
        ctx.beginPath();
        ctx.moveTo(p.points[0].x, p.points[0].y);
        p.points.slice(1).forEach(pt => ctx.lineTo(pt.x, pt.y));
        ctx.stroke();
      } else if (p.type === 'rect' && p.w !== undefined) {
        ctx.strokeRect(p.x!, p.y!, p.w, p.h!);
      } else if (p.type === 'ellipse' && p.w !== undefined) {
        ctx.beginPath();
        ctx.ellipse(p.x! + p.w / 2, p.y! + p.h! / 2, Math.abs(p.w / 2), Math.abs(p.h! / 2), 0, 0, Math.PI * 2);
        ctx.stroke();
      } else if (p.type === 'line') {
        ctx.beginPath(); ctx.moveTo(p.x1!, p.y1!); ctx.lineTo(p.x2!, p.y2!); ctx.stroke();
      } else if (p.type === 'triangle' && p.w !== undefined) {
        ctx.beginPath();
        ctx.moveTo(p.x! + p.w / 2, p.y!);
        ctx.lineTo(p.x!, p.y! + p.h!);
        ctx.lineTo(p.x! + p.w, p.y! + p.h!);
        ctx.closePath(); ctx.stroke();
      }
    });
    textBlocksRef.current.forEach(tb => {
      ctx.font = `${tb.fontSize}px sans-serif`;
      ctx.fillStyle = tb.color;
      ctx.fillText(tb.text, tb.x, tb.y);
    });
    // Preview current
    const cp = currentPath.current;
    ctx.strokeStyle = cp.color;
    ctx.lineWidth = cp.lineWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (cp.type === 'pen' && cp.points && cp.points.length > 1) {
      ctx.beginPath();
      ctx.moveTo(cp.points[0].x, cp.points[0].y);
      cp.points.slice(1).forEach(pt => ctx.lineTo(pt.x, pt.y));
      ctx.stroke();
    } else if (cp.type === 'rect' && cp.w !== undefined) {
      ctx.strokeRect(cp.x!, cp.y!, cp.w, cp.h!);
    } else if (cp.type === 'ellipse' && cp.w !== undefined) {
      ctx.beginPath();
      ctx.ellipse(cp.x! + cp.w / 2, cp.y! + cp.h! / 2, Math.abs(cp.w / 2), Math.abs(cp.h! / 2), 0, 0, Math.PI * 2);
      ctx.stroke();
    } else if (cp.type === 'line') {
      ctx.beginPath(); ctx.moveTo(cp.x1!, cp.y1!); ctx.lineTo(cp.x2!, cp.y2!); ctx.stroke();
    } else if (cp.type === 'triangle' && cp.w !== undefined) {
      ctx.beginPath();
      ctx.moveTo(cp.x! + cp.w / 2, cp.y!);
      ctx.lineTo(cp.x!, cp.y! + cp.h!);
      ctx.lineTo(cp.x! + cp.w, cp.y! + cp.h!);
      ctx.closePath(); ctx.stroke();
    }
  }, [readOnly]);

  const handlePointerUp = useCallback(() => {
    if (!isDrawing.current || !currentPath.current) return;
    isDrawing.current = false;
    setPaths(prev => [...prev, currentPath.current!]);
    currentPath.current = null;
    startPoint.current = null;
  }, []);

  const clearCanvas = useCallback(() => {
    setPaths([]);
    setTextBlocks([]);
    setEditingTextId(null);
  }, []);

  const finishTextEdit = useCallback(() => {
    if (editingTextId) {
      setTextBlocks(prev => prev.map(tb =>
        tb.id === editingTextId ? { ...tb, text: editingValue } : tb
      ).filter(tb => tb.text.trim() !== ''));
      setEditingTextId(null);
      setEditingValue('');
    }
  }, [editingTextId, editingValue]);

  // Export/import
  useImperativeHandle(ref, () => ({
    getExportData: () => {
      const canvas = canvasRef.current;
      const canvasData = canvas ? canvas.toDataURL('image/png') : '';
      return { text: typedText, canvasData };
    },
    loadData: (text: string, _canvasData: string) => {
      setTypedText(text);
      // Canvas data loading would require Image decode — omitted for simplicity
    },
  }));

  const wordCount = typedText.split(/\s+/).filter(Boolean).length;
  const hasDrawing = paths.length > 0 || textBlocks.length > 0;

  const toolButtons: { id: Tool; icon: React.ReactNode; label: string }[] = [
    { id: 'select', icon: <MousePointer2 className="h-3.5 w-3.5" />, label: 'Select' },
    { id: 'pen', icon: <Pen className="h-3.5 w-3.5" />, label: 'Pen' },
    { id: 'text', icon: <Type className="h-3.5 w-3.5" />, label: 'Text' },
    { id: 'rect', icon: <Square className="h-3.5 w-3.5" />, label: 'Rect' },
    { id: 'ellipse', icon: <Circle className="h-3.5 w-3.5" />, label: 'Ellipse' },
    { id: 'triangle', icon: <Triangle className="h-3.5 w-3.5" />, label: 'Triangle' },
    { id: 'line', icon: <Minus className="h-3.5 w-3.5" />, label: 'Line' },
    { id: 'eraser', icon: <Eraser className="h-3.5 w-3.5" />, label: 'Eraser' },
  ];

  return (
    <div className={cn("flex flex-col gap-0 rounded-xl border border-border overflow-hidden", className)}>
      {/* Mode tabs */}
      <div className="flex items-center gap-0 border-b border-border bg-secondary/40">
        <button
          onClick={() => setMode('text')}
          className={cn(
            "flex items-center gap-1.5 px-4 py-2 text-xs font-medium transition-all",
            mode === 'text'
              ? "bg-background text-foreground border-b-2 border-primary"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          <Type className="h-3.5 w-3.5" /> Type
        </button>
        <button
          onClick={() => setMode('draw')}
          className={cn(
            "flex items-center gap-1.5 px-4 py-2 text-xs font-medium transition-all",
            mode === 'draw'
              ? "bg-background text-foreground border-b-2 border-primary"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          <Pen className="h-3.5 w-3.5" /> Draw
          {hasDrawing && <span className="ml-1 h-1.5 w-1.5 rounded-full bg-primary" />}
        </button>
      </div>

      {/* Text mode */}
      {mode === 'text' && (
        <div className="relative">
          <textarea
            value={typedText}
            onChange={e => setTypedText(e.target.value)}
            placeholder={placeholder}
            readOnly={readOnly}
            onCopy={onCopy}
            onPaste={onPaste}
            className="w-full min-h-[180px] resize-y bg-background px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
          <div className="flex items-center justify-between px-4 py-2 border-t border-border bg-secondary/20">
            <p className="text-xs text-muted-foreground">
              {wordCount} words{minWords > 0 && ` / ${minWords} min`}
            </p>
            {minWords > 0 && wordCount >= minWords && (
              <p className="text-xs text-primary">✓ Word count met</p>
            )}
          </div>
        </div>
      )}

      {/* Draw mode */}
      {mode === 'draw' && (
        <div className="flex flex-col">
          {/* Draw toolbar */}
          <div className="flex items-center gap-1 flex-wrap px-2 py-1.5 border-b border-border bg-secondary/40">
            {/* Tool buttons */}
            <div className="flex items-center gap-0.5">
              {toolButtons.map(btn => (
                <button
                  key={btn.id}
                  onClick={() => setTool(btn.id)}
                  title={btn.label}
                  className={cn(
                    "p-1.5 rounded-md transition-all",
                    tool === btn.id
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                  )}
                >
                  {btn.icon}
                </button>
              ))}
            </div>

            <div className="h-5 w-px bg-border mx-1" />

            {/* Color picker */}
            <div className="relative">
              <button
                onClick={() => setShowColorPicker(p => !p)}
                className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-secondary transition-all"
              >
                <span
                  className="h-4 w-4 rounded-full border border-border"
                  style={{ background: color }}
                />
                <ChevronDown className="h-3 w-3" />
              </button>
              {showColorPicker && (
                <div className="absolute top-full left-0 mt-1 z-50 flex gap-1 p-2 rounded-xl border border-border bg-background shadow-xl">
                  {COLORS.map(c => (
                    <button
                      key={c}
                      onClick={() => { setColor(c); setShowColorPicker(false); }}
                      className={cn(
                        "h-6 w-6 rounded-full border-2 transition-all hover:scale-110",
                        color === c ? "border-foreground scale-110" : "border-transparent"
                      )}
                      style={{ background: c }}
                    />
                  ))}
                  {/* Custom color */}
                  <input
                    type="color"
                    value={color}
                    onChange={e => setColor(e.target.value)}
                    className="h-6 w-6 rounded-full cursor-pointer border border-border bg-transparent"
                    title="Custom color"
                  />
                </div>
              )}
            </div>

            {/* Line width */}
            <div className="flex items-center gap-1 ml-1">
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
                  <span
                    className="block rounded-full"
                    style={{ width: w * 2.5 + 4, height: w, background: color }}
                  />
                </button>
              ))}
            </div>

            <div className="ml-auto">
              <button
                onClick={clearCanvas}
                className="flex items-center gap-1 px-2 py-1 rounded-md text-xs text-destructive hover:bg-destructive/10 transition-all"
              >
                <Trash2 className="h-3.5 w-3.5" /> Clear
              </button>
            </div>
          </div>

          {/* Canvas area */}
          <div
            ref={containerRef}
            className="relative bg-background select-none"
            style={{ height: canvasSize.h }}
          >
            <canvas
              ref={canvasRef}
              width={canvasSize.w}
              height={canvasSize.h}
              className={cn(
                "absolute inset-0",
                tool === 'pen' ? 'cursor-crosshair' :
                tool === 'eraser' ? 'cursor-cell' :
                tool === 'text' ? 'cursor-text' :
                tool === 'select' ? 'cursor-default' : 'cursor-crosshair'
              )}
              onMouseDown={handlePointerDown}
              onMouseMove={handlePointerMove}
              onMouseUp={handlePointerUp}
              onMouseLeave={handlePointerUp}
              onTouchStart={handlePointerDown}
              onTouchMove={handlePointerMove}
              onTouchEnd={handlePointerUp}
            />

            {/* Floating text inputs for text blocks */}
            {textBlocks.map(tb => (
              tb.id === editingTextId ? (
                <input
                  key={tb.id}
                  ref={editInputRef}
                  value={editingValue}
                  onChange={e => setEditingValue(e.target.value)}
                  onBlur={finishTextEdit}
                  onKeyDown={e => { if (e.key === 'Enter') finishTextEdit(); }}
                  className="absolute bg-transparent border-b border-primary outline-none text-sm"
                  style={{ left: tb.x, top: tb.y - 16, color: tb.color, fontSize: tb.fontSize, minWidth: 80 }}
                  placeholder="Type here..."
                />
              ) : null
            ))}

            {/* Empty state hint */}
            {paths.length === 0 && textBlocks.length === 0 && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <p className="text-xs text-muted-foreground opacity-50">
                  {tool === 'text' ? 'Click anywhere to add text' : 'Draw your answer on the canvas'}
                </p>
              </div>
            )}
          </div>

          {/* Text note below canvas */}
          <div className="border-t border-border bg-secondary/20 px-4 py-2 text-xs text-muted-foreground">
            💡 Switch to <strong>Type</strong> tab to add typed text below your drawing
          </div>
        </div>
      )}
    </div>
  );
});

AnswerEditor.displayName = 'AnswerEditor';
export default AnswerEditor;
