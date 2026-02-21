import {
  useRef, useState, useEffect, useCallback, forwardRef, useImperativeHandle,
} from 'react';
import { cn } from '@/lib/utils';
import {
  Pen, Square, Circle, Minus, Eraser, Trash2,
  ChevronDown, Triangle, Type, PlusCircle, MousePointer,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

type DrawTool = 'pen' | 'rect' | 'ellipse' | 'line' | 'triangle' | 'eraser' | 'select' | 'text' | null;

interface DrawStroke {
  type: 'pen' | 'rect' | 'ellipse' | 'line' | 'triangle' | 'text';
  points?: { x: number; y: number }[];
  x?: number; y?: number; w?: number; h?: number;
  x1?: number; y1?: number; x2?: number; y2?: number;
  color: string;
  lineWidth: number;
  id: string;
  textContent?: string;
  fontSize?: number;
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
const CANVAS_H = 260;
const HANDLE_SIZE = 8;

// ─── Hit-test helpers ─────────────────────────────────────────────────────────

function getBounds(s: DrawStroke): { x: number; y: number; w: number; h: number } | null {
  if (s.type === 'pen' && s.points && s.points.length > 0) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    s.points.forEach(p => { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); });
    return { x: minX - 4, y: minY - 4, w: maxX - minX + 8, h: maxY - minY + 8 };
  }
  if (s.type === 'line') {
    const x = Math.min(s.x1!, s.x2!);
    const y = Math.min(s.y1!, s.y2!);
    return { x: x - 4, y: y - 4, w: Math.abs(s.x2! - s.x1!) + 8, h: Math.abs(s.y2! - s.y1!) + 8 };
  }
  if ((s.type === 'rect' || s.type === 'ellipse' || s.type === 'triangle' || s.type === 'text') && s.w !== undefined) {
    return { x: s.x!, y: s.y!, w: s.w, h: s.h! };
  }
  return null;
}

function hitTest(s: DrawStroke, px: number, py: number): boolean {
  const b = getBounds(s);
  if (!b) return false;
  return px >= b.x - 6 && px <= b.x + b.w + 6 && py >= b.y - 6 && py <= b.y + b.h + 6;
}

type ResizeHandle = 'nw' | 'ne' | 'sw' | 'se';

function getHandles(b: { x: number; y: number; w: number; h: number }): Record<ResizeHandle, { x: number; y: number }> {
  return {
    nw: { x: b.x, y: b.y },
    ne: { x: b.x + b.w, y: b.y },
    sw: { x: b.x, y: b.y + b.h },
    se: { x: b.x + b.w, y: b.y + b.h },
  };
}

function hitHandle(b: { x: number; y: number; w: number; h: number }, px: number, py: number): ResizeHandle | null {
  const handles = getHandles(b);
  for (const [key, pt] of Object.entries(handles)) {
    if (Math.abs(px - pt.x) < HANDLE_SIZE && Math.abs(py - pt.y) < HANDLE_SIZE) return key as ResizeHandle;
  }
  return null;
}

// ─── Resize a stroke ──────────────────────────────────────────────────────────

function resizeStroke(s: DrawStroke, origBounds: { x: number; y: number; w: number; h: number }, newBounds: { x: number; y: number; w: number; h: number }): DrawStroke {
  const sx = origBounds.w !== 0 ? newBounds.w / origBounds.w : 1;
  const sy = origBounds.h !== 0 ? newBounds.h / origBounds.h : 1;
  const ox = origBounds.x, oy = origBounds.y;
  const nx = newBounds.x, ny = newBounds.y;

  if (s.type === 'pen' && s.points) {
    return { ...s, points: s.points.map(p => ({ x: nx + (p.x - ox) * sx, y: ny + (p.y - oy) * sy })) };
  }
  if (s.type === 'line') {
    return { ...s, x1: nx + (s.x1! - ox) * sx, y1: ny + (s.y1! - oy) * sy, x2: nx + (s.x2! - ox) * sx, y2: ny + (s.y2! - oy) * sy };
  }
  return { ...s, x: newBounds.x, y: newBounds.y, w: newBounds.w, h: newBounds.h };
}

// ─── Move a stroke ────────────────────────────────────────────────────────────

function moveStroke(s: DrawStroke, dx: number, dy: number): DrawStroke {
  if (s.type === 'pen' && s.points) {
    return { ...s, points: s.points.map(p => ({ x: p.x + dx, y: p.y + dy })) };
  }
  if (s.type === 'line') {
    return { ...s, x1: s.x1! + dx, y1: s.y1! + dy, x2: s.x2! + dx, y2: s.y2! + dy };
  }
  return { ...s, x: (s.x ?? 0) + dx, y: (s.y ?? 0) + dy };
}

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

  // Selection state
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const editingTextIdRef = useRef<string | null>(null);
  const dragState = useRef<{ mode: 'move' | 'resize'; handle?: ResizeHandle; origBounds: { x: number; y: number; w: number; h: number }; origStroke: DrawStroke; startX: number; startY: number } | null>(null);

  // Keep ref in sync for use in drawAll
  useEffect(() => { editingTextIdRef.current = editingTextId; }, [editingTextId]);

  useEffect(() => { strokesRef.current = block.strokes; }, [block.strokes]);

  // Deselect when tool changes away from select
  useEffect(() => {
    if (activeTool !== 'select') {
      setSelectedId(null);
      setEditingTextId(null);
    }
  }, [activeTool]);

  const getPos = (e: React.MouseEvent | React.TouchEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const scaleX = 800 / rect.width;
    const scaleY = CANVAS_H / rect.height;
    if ('touches' in e) {
      const t = e.touches[0];
      return { x: (t.clientX - rect.left) * scaleX, y: (t.clientY - rect.top) * scaleY };
    }
    return { x: ((e as React.MouseEvent).clientX - rect.left) * scaleX, y: ((e as React.MouseEvent).clientY - rect.top) * scaleY };
  };

  const drawAll = useCallback((ctx: CanvasRenderingContext2D, strokes: DrawStroke[], preview?: DrawStroke, selId?: string | null) => {
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
      } else if (s.type === 'text' && s.w !== undefined) {
        ctx.fillStyle = s.color;
        ctx.font = `${s.fontSize || 16}px sans-serif`;
        ctx.textBaseline = 'top';
        // Draw text box border
        ctx.strokeStyle = s.color + '40';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.strokeRect(s.x!, s.y!, s.w, s.h!);
        ctx.setLineDash([]);
        // Draw text content
        // Only render text on canvas if NOT currently editing this stroke (prevents mirror/double text)
        if (s.textContent && s.id !== editingTextIdRef.current) {
          const words = s.textContent.split('\n');
          const fs = s.fontSize || 16;
          words.forEach((line, i) => {
            ctx.fillText(line, s.x! + 4, s.y! + 4 + i * (fs + 2), s.w! - 8);
          });
        }
      }

      // Skip rendering text content on canvas if currently editing it (prevents mirror effect)
      // Selection box
      if (selId === s.id) {
        const b = getBounds(s);
        if (b) {
          ctx.strokeStyle = '#60a5fa';
          ctx.lineWidth = 1.5;
          ctx.setLineDash([5, 3]);
          ctx.strokeRect(b.x, b.y, b.w, b.h);
          ctx.setLineDash([]);
          // Resize handles
          const handles = getHandles(b);
          ctx.fillStyle = '#60a5fa';
          Object.values(handles).forEach(h => {
            ctx.fillRect(h.x - HANDLE_SIZE / 2, h.y - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
          });
        }
      }
    });
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    drawAll(ctx, block.strokes, undefined, selectedId);
  }, [block.strokes, drawAll, selectedId]);

  const onDown = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (readOnly) return;
    e.preventDefault();
    const pos = getPos(e);

    // ── Select tool ──
    if (activeTool === 'select') {
      // Check if clicking a resize handle on already selected
      if (selectedId) {
        const sel = strokesRef.current.find(s => s.id === selectedId);
        if (sel) {
          const b = getBounds(sel);
          if (b) {
            const handle = hitHandle(b, pos.x, pos.y);
            if (handle) {
              dragState.current = { mode: 'resize', handle, origBounds: { ...b }, origStroke: JSON.parse(JSON.stringify(sel)), startX: pos.x, startY: pos.y };
              isDrawing.current = true;
              return;
            }
          }
        }
      }
      // Check hit on any stroke (reverse for top-most first)
      for (let i = strokesRef.current.length - 1; i >= 0; i--) {
        if (hitTest(strokesRef.current[i], pos.x, pos.y)) {
          const s = strokesRef.current[i];
          setSelectedId(s.id);
          setEditingTextId(null);
          const b = getBounds(s);
          if (b) {
            dragState.current = { mode: 'move', origBounds: { ...b }, origStroke: JSON.parse(JSON.stringify(s)), startX: pos.x, startY: pos.y };
            isDrawing.current = true;
          }
          return;
        }
      }
      setSelectedId(null);
      setEditingTextId(null);
      return;
    }

    // ── Text tool ──
    if (activeTool === 'text') {
      const newStroke: DrawStroke = {
        type: 'text', x: pos.x, y: pos.y, w: 160, h: 40,
        color, lineWidth: 1, id: uid(), textContent: '', fontSize: 16,
      };
      const newStrokes = [...strokesRef.current, newStroke];
      onStrokesChange(block.id, newStrokes);
      setSelectedId(newStroke.id);
      setEditingTextId(newStroke.id);
      return;
    }

    if (!activeTool) return;

    if (activeTool === 'eraser') {
      const filtered = strokesRef.current.filter(s => !hitTest(s, pos.x, pos.y));
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
  }, [activeTool, color, lineWidth, readOnly, block.id, onStrokesChange, selectedId]);

  const onMove = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing.current) return;
    e.preventDefault();
    const pos = getPos(e);

    // ── Drag/resize in select mode ──
    if (activeTool === 'select' && dragState.current) {
      const ds = dragState.current;
      const dx = pos.x - ds.startX;
      const dy = pos.y - ds.startY;

      if (ds.mode === 'move') {
        const moved = moveStroke(ds.origStroke, dx, dy);
        const updated = strokesRef.current.map(s => s.id === moved.id ? moved : s);
        onStrokesChange(block.id, updated);
      } else if (ds.mode === 'resize' && ds.handle) {
        const ob = ds.origBounds;
        let nx = ob.x, ny = ob.y, nw = ob.w, nh = ob.h;
        if (ds.handle.includes('e')) nw = ob.w + dx;
        if (ds.handle.includes('w')) { nx = ob.x + dx; nw = ob.w - dx; }
        if (ds.handle.includes('s')) nh = ob.h + dy;
        if (ds.handle.includes('n')) { ny = ob.y + dy; nh = ob.h - dy; }
        if (nw < 10) nw = 10;
        if (nh < 10) nh = 10;
        const resized = resizeStroke(ds.origStroke, ob, { x: nx, y: ny, w: nw, h: nh });
        const updated = strokesRef.current.map(s => s.id === resized.id ? resized : s);
        onStrokesChange(block.id, updated);
      }
      return;
    }

    if (!currentStroke.current) return;
    const cs = currentStroke.current;
    if (cs.type === 'pen') cs.points!.push(pos);
    else if (cs.type === 'line') { cs.x2 = pos.x; cs.y2 = pos.y; }
    else {
      const sp = startPt.current!;
      cs.x = Math.min(sp.x, pos.x); cs.y = Math.min(sp.y, pos.y);
      cs.w = Math.abs(pos.x - sp.x); cs.h = Math.abs(pos.y - sp.y);
    }
    const ctx = canvasRef.current?.getContext('2d');
    if (ctx) drawAll(ctx, strokesRef.current, currentStroke.current, selectedId);
  }, [drawAll, activeTool, block.id, onStrokesChange, selectedId]);

  const onUp = useCallback(() => {
    if (!isDrawing.current) return;
    isDrawing.current = false;

    if (activeTool === 'select') {
      dragState.current = null;
      return;
    }

    if (currentStroke.current) {
      const newStrokes = [...strokesRef.current, currentStroke.current];
      onStrokesChange(block.id, newStrokes);
      currentStroke.current = null;
    }
  }, [block.id, onStrokesChange, activeTool]);

  const deleteSelected = useCallback(() => {
    if (!selectedId) return;
    const filtered = strokesRef.current.filter(s => s.id !== selectedId);
    onStrokesChange(block.id, filtered);
    setSelectedId(null);
    setEditingTextId(null);
  }, [selectedId, block.id, onStrokesChange]);

  // Handle keyboard for delete and text editing
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (selectedId && (e.key === 'Delete' || e.key === 'Backspace') && !editingTextId) {
        e.preventDefault();
        deleteSelected();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selectedId, editingTextId, deleteSelected]);

  const cursorClass = (() => {
    if (readOnly) return 'cursor-default';
    if (activeTool === 'select') return 'cursor-default';
    if (activeTool === 'eraser') return 'cursor-cell';
    if (activeTool === 'text') return 'cursor-text';
    if (activeTool) return 'cursor-crosshair';
    return 'cursor-default';
  })();

  // Editing text overlay
  const editingStroke = editingTextId ? block.strokes.find(s => s.id === editingTextId) : null;

  return (
    <div className="relative group/drawblock border border-border rounded-lg overflow-hidden bg-background/60">
      <canvas
        ref={canvasRef}
        width={800}
        height={CANVAS_H}
        className={cn("w-full block", cursorClass)}
        style={{ height: CANVAS_H }}
        onMouseDown={onDown}
        onMouseMove={onMove}
        onMouseUp={onUp}
        onMouseLeave={onUp}
        onTouchStart={onDown}
        onTouchMove={onMove}
        onTouchEnd={onUp}
      />
      {/* Text editing overlay */}
      {editingStroke && editingStroke.type === 'text' && canvasRef.current && (() => {
        const rect = canvasRef.current!.getBoundingClientRect();
        const scaleX = rect.width / 800;
        const scaleY = rect.height / CANVAS_H;
        return (
          <textarea
            autoFocus
            value={editingStroke.textContent || ''}
            onChange={e => {
              const val = e.target.value;
              const updated = strokesRef.current.map(s => s.id === editingTextId ? { ...s, textContent: val } : s);
              onStrokesChange(block.id, updated);
            }}
            onBlur={() => setEditingTextId(null)}
            onKeyDown={e => { if (e.key === 'Escape') setEditingTextId(null); }}
            className="absolute bg-transparent text-foreground border-2 border-primary/50 outline-none resize-none p-1 text-sm"
            style={{
              left: editingStroke.x! * scaleX,
              top: editingStroke.y! * scaleY,
              width: editingStroke.w! * scaleX,
              height: editingStroke.h! * scaleY,
              fontSize: (editingStroke.fontSize || 16) * scaleY,
              color: editingStroke.color,
            }}
          />
        );
      })()}
      {block.strokes.length === 0 && !editingTextId && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <p className="text-xs text-muted-foreground opacity-40">
            {activeTool ? 'Draw here…' : 'Select a tool above, then draw here'}
          </p>
        </div>
      )}
      {/* Delete selected button */}
      {selectedId && !readOnly && (
        <button
          onClick={deleteSelected}
          className="absolute top-2 left-2 p-1.5 rounded-md bg-destructive/90 text-destructive-foreground hover:bg-destructive transition-colors shadow-md"
          title="Delete selected shape"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}
      {!readOnly && (
        <button
          onClick={() => onDelete(block.id)}
          className="absolute top-2 right-2 opacity-0 group-hover/drawblock:opacity-100 transition-opacity p-1 rounded-md bg-background/80 text-destructive hover:bg-destructive/10"
          title="Remove this drawing block"
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
    setActiveTool('pen');
  }, []);

  const deleteBlock = useCallback((id: string) => {
    setBlocks(prev => {
      const filtered = prev.filter(b => b.id !== id);
      return filtered.length === 0 ? [{ id: uid(), kind: 'text', content: '' }] : filtered;
    });
  }, []);

  useImperativeHandle(ref, () => ({
    getExportData: () => {
      const text = blocks
        .filter((b): b is Extract<Block, { kind: 'text' }> => b.kind === 'text')
        .map(b => b.content)
        .join('\n\n');
      return { text, canvasData: '' };
    },
  }));

  const toolButtons: { id: DrawTool; icon: React.ReactNode; label: string }[] = [
    { id: 'select', icon: <MousePointer className="h-3.5 w-3.5" />, label: 'Select / Move / Resize' },
    { id: 'pen', icon: <Pen className="h-3.5 w-3.5" />, label: 'Pen' },
    { id: 'rect', icon: <Square className="h-3.5 w-3.5" />, label: 'Rectangle' },
    { id: 'ellipse', icon: <Circle className="h-3.5 w-3.5" />, label: 'Ellipse' },
    { id: 'triangle', icon: <Triangle className="h-3.5 w-3.5" />, label: 'Triangle' },
    { id: 'line', icon: <Minus className="h-3.5 w-3.5" />, label: 'Line' },
    { id: 'text', icon: <Type className="h-3.5 w-3.5" />, label: 'Text Box' },
    { id: 'eraser', icon: <Eraser className="h-3.5 w-3.5" />, label: 'Eraser' },
  ];

  return (
    <div className={cn("flex flex-col rounded-xl border border-border overflow-hidden bg-background", className)}>
      {/* Toolbar */}
      <div className="flex items-center gap-1 flex-wrap px-2 py-1.5 border-b border-border bg-secondary/40">
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
                  readOnly={readOnly || (!!activeTool && activeTool !== 'select')}
                  onCopy={onCopy}
                  onPaste={onPaste}
                  onClick={() => { if (activeTool && activeTool !== 'select') setActiveTool(null); }}
                  className={cn(
                    "w-full resize-none bg-transparent px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none min-h-[80px]",
                    activeTool && activeTool !== 'select' ? "cursor-default opacity-70" : "cursor-text"
                  )}
                  rows={3}
                  onInput={e => {
                    const t = e.currentTarget;
                    t.style.height = 'auto';
                    t.style.height = t.scrollHeight + 'px';
                  }}
                />
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
          {activeTool && <span className="ml-2 text-primary">● {activeTool === 'select' ? 'Select' : activeTool === 'text' ? 'Text box' : `Draw: ${activeTool}`}</span>}
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
