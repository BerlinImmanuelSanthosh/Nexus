import os
import re
import io
import json
import asyncio
import base64
import tempfile
import requests
from concurrent.futures import ThreadPoolExecutor
from fastapi import FastAPI, HTTPException, UploadFile, File, Form, BackgroundTasks
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional, Tuple
from groq import Groq
from dotenv import load_dotenv
from functools import lru_cache
from collections import OrderedDict
import threading
import time
from contextlib import asynccontextmanager

# Optional imports
try:
    from googletrans import Translator
    TRANSLATOR_AVAILABLE = True
    print("✓ googletrans loaded successfully")
except ImportError:
    TRANSLATOR_AVAILABLE = False
    print("✗ googletrans not installed")

try:
    import fitz  # PyMuPDF
    PYMUPDF_AVAILABLE = True
    print("✓ PyMuPDF loaded successfully")
except ImportError:
    PYMUPDF_AVAILABLE = False
    print("✗ PyMuPDF not installed")

try:
    from langchain_community.document_loaders import PyPDFLoader, PDFPlumberLoader
    from langchain.text_splitter import RecursiveCharacterTextSplitter
    LANGCHAIN_AVAILABLE = True
    print("✓ LangChain PDF loaders loaded successfully")
except ImportError:
    LANGCHAIN_AVAILABLE = False
    print("✗ LangChain not installed")

try:
    import pytesseract
    from PIL import Image
    PYTESSERACT_AVAILABLE = True
    print("✓ Pytesseract loaded successfully")
except ImportError:
    PYTESSERACT_AVAILABLE = False
    print("✗ Pytesseract not installed - install with: pip install pytesseract pillow")

load_dotenv()
GROQ_API_KEY = os.getenv("GROQ_API_KEY")
if not GROQ_API_KEY:
    raise RuntimeError("Missing GROQ_API_KEY in .env")

GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY", "")
GOOGLE_CX      = os.getenv("GOOGLE_CX", "")

@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        yield
    except asyncio.CancelledError:
        pass

app = FastAPI(lifespan=lifespan, title="NexusAI Chatbot")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:8080", "http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Global file context with thread safety ---
_file_context_lock = threading.Lock()
_file_context: dict = {
    "text":       "",
    "filename":   "",
    "type":       "",
    "processing": False,
    "ready":      False,
    "error":      "",
}

_executor = ThreadPoolExecutor(max_workers=20, thread_name_prefix="nexus_worker")

# --- Pydantic models ---
class ChatRequest(BaseModel):
    messages: List[dict]

class SimpleTeachRequest(BaseModel):
    topic: str
    language: str = "en"
    previous_response: str = ""
    questions: Optional[List[str]] = None

class ChildTeachRequest(BaseModel):
    topic: str
    language: str = "en"
    questions: Optional[List[str]] = None

class QuizGenerateRequest(BaseModel):
    topic: str
    num_questions: int = 5
    marks_per_question: int = 2
    difficulty: str = "medium"
    use_file_context: bool = False

class QuizAnswerItem(BaseModel):
    question_id: str
    question: str
    student_answer: str
    max_marks: int
    expected_keywords: Optional[List[str]] = None

class QuizEvaluateRequest(BaseModel):
    answers: List[QuizAnswerItem]

class RoadmapRequest(BaseModel):
    subject: str

# --- Groq client with connection pool management ---
_groq_client_lock = threading.Lock()
_groq_client_instances = []
_MAX_CLIENT_INSTANCES = 3

def get_groq_client():
    """Get or create a Groq client with proper timeout configuration."""
    with _groq_client_lock:
        _groq_client_instances[:] = [c for c in _groq_client_instances if c is not None]
        if _groq_client_instances:
            return _groq_client_instances[0]
        if len(_groq_client_instances) < _MAX_CLIENT_INSTANCES:
            client = Groq(
                api_key=GROQ_API_KEY,
                timeout=30.0,
                max_retries=2
            )
            _groq_client_instances.append(client)
            return client
        else:
            return _groq_client_instances[0]

def chat_completion(messages: list, temperature: float = 0.25,
                    max_tokens: int = 16000, top_p: float = 0.92,
                    timeout: float = 30.0) -> str:
    """FIX: Added timeout parameter and retry logic with exponential backoff."""
    for attempt in range(3):
        for model in ["openai/gpt-oss-20b", "openai/gpt-oss-safeguard-20b"]:
            try:
                client = get_groq_client()
                comp = client.chat.completions.create(
                    model=model,
                    messages=messages,
                    temperature=temperature,
                    max_tokens=max_tokens,
                    top_p=top_p,
                    timeout=timeout,
                )
                if model != "openai/gpt-oss-20b":
                    print(f"✅ Fallback model '{model}' succeeded")
                return comp.choices[0].message.content.strip()
            except Exception as e:
                err_str = str(e)
                is_rate_limit = '429' in err_str or 'rate_limit' in err_str.lower()
                is_timeout = 'timeout' in err_str.lower() or '504' in err_str
                is_connection = 'connection' in err_str.lower() or '503' in err_str
                if is_rate_limit and model == "openai/gpt-oss-20b":
                    print(f"⚠ Rate limited on primary — switching to fallback")
                    continue
                elif is_timeout or is_connection:
                    print(f"⚠ Attempt {attempt+1}: {err_str[:100]} — retrying...")
                    time.sleep(0.5 * (attempt + 1))
                    continue
                else:
                    raise
    raise RuntimeError("All models and retries failed")

# --- Helper functions ---
def clean_llm_response(text: str) -> str:
    text = re.sub(r'!\[[^\]]*\]\([^\)]*\)', '', text)
    text = re.sub(r'^#{1,6}\s+(.+)$', lambda m: f"\n{m.group(1).strip()}\n", text, flags=re.MULTILINE)
    text = re.sub(r'\*\*(.+?)\*\*', lambda m: m.group(1), text)
    return text.strip()

def clean_to_plain_text(text: str) -> str:
    text = re.sub(r'<[^>]+>', ' ', text)
    text = re.sub(r'\*\*(.+?)\*\*', r'\1', text)
    text = re.sub(r'\*(.+?)\*', r'\1', text)
    text = re.sub(r'!\[[^\]]*\]\([^\)]*\)', '', text)
    text = re.sub(r'\[[^\]]*\]\([^\)]*\)', '', text)
    text = re.sub(r'^#{1,6}\s+', '', text, flags=re.MULTILINE)
    text = re.sub(r'\n{3,}', '\n', text)
    text = re.sub(r'[ \t]+', ' ', text)
    return text.strip()

def clean_pdf_content_for_quiz(content: str) -> str:
    """Clean PDF content for quiz generation."""
    if not content:
        return ""
    content = re.sub(r'\n\s*\n', '\n\n', content)
    content = content.replace('\\', '\\\\').replace('"', '\\"')
    return content[:50000]

# ============================================
# === CODING QUESTION DETECTION & FORMATTING ===
# ============================================

CODING_KEYWORDS = [
    'code', 'coding', 'program', 'programming', 'function', 'method', 'class',
    'variable', 'loop', 'array', 'list', 'dictionary', 'object', 'algorithm',
    'python', 'java', 'javascript', 'cpp', 'c++', 'c#', 'ruby', 'go', 'rust',
    'sql', 'html', 'css', 'react', 'node', 'django', 'flask', 'spring',
    'write code', 'show code', 'example code', 'code example', 'snippet',
    'implement', 'create function', 'define function', 'make a program',
    'script', 'debug', 'error', 'exception', 'compile', 'run', 'execute',
    'output', 'print', 'return value', 'input', 'parameter', 'argument',
    'recursion', 'iteration', 'data structure', 'api', 'rest', 'json',
    'database', 'query', 'select', 'insert', 'update', 'delete',
    'frontend', 'backend', 'full stack', 'devops', 'git', 'version control'
]

CODING_PATTERNS = [
    r'\b(write|show|give|create|make|build|develop)\s+(a\s+)?(code|program|function|script)\b',
    r'\b(how to|how do i|can you)\s+(code|program|implement|create)\b',
    r'\b(example|sample)\s+(code|program|function)\b',
    r'\b(what does|explain)\s+(this|the)\s+code\b',
    r'\b(fix|debug|solve)\s+(this|the)\s+(error|bug|problem)\b',
    r'\b(print|output|result)\s+(of|for)\b',
    r'^\s*(def|class|function|public|private|import|from|include)\b',
]

def is_coding_question(text: str) -> bool:
    """Detect if the question is coding-related."""
    text_lower = text.lower()
    
    keyword_count = sum(1 for kw in CODING_KEYWORDS if kw in text_lower)
    if keyword_count >= 2:
        return True
    
    for pattern in CODING_PATTERNS:
        if re.search(pattern, text_lower):
            return True
    
    if re.search(r'[\{\}\[\]\(\);:]', text) and re.search(r'\b(def|function|class|var|let|const|int|String|void)\b', text):
        return True
    
    return False

def format_coding_response(code: str, explanation: str, output: str, language: str = "python") -> str:
    """Format coding response with code, explanation, and output."""
    escaped_code = code.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
    escaped_output = output.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
    
    html = f'''
    <div style="font-family:'Segoe UI',Arial,sans-serif;color:white;">
        <div style="margin:0 0 16px 0;background:#1e1e1e;border-radius:8px;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,0.3);">
            <div style="background:#2d2d2d;padding:8px 14px;border-bottom:1px solid #404040;display:flex;justify-content:space-between;align-items:center;">
                <span style="color:#61dafb;font-size:12px;font-weight:600;text-transform:uppercase;">{language.upper()} Code</span>
                <span style="color:#888;font-size:11px;">📝</span>
            </div>
            <pre style="margin:0;padding:14px;overflow-x:auto;font-family:'Consolas','Monaco','Courier New',monospace;font-size:13px;line-height:1.6;color:#d4d4d4;"><code>{escaped_code}</code></pre>
        </div>
        <div style="margin:0 0 16px 0;background:rgba(99,102,241,0.1);border-left:4px solid #6366f1;border-radius:6px;padding:14px;">
            <div style="color:#a5b4fc;font-size:13px;font-weight:600;margin-bottom:8px;">💡 Explanation</div>
            <div style="color:#e0e0e0;font-size:14px;line-height:1.7;white-space:pre-wrap;">{explanation}</div>
        </div>
        <div style="margin:0 0 16px 0;background:#0d1117;border-radius:8px;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,0.3);">
            <div style="background:#161b22;padding:8px 14px;border-bottom:1px solid #30363d;display:flex;justify-content:space-between;align-items:center;">
                <span style="color:#3fb950;font-size:12px;font-weight:600;text-transform:uppercase;">Output</span>
                <span style="color:#888;font-size:11px;">▶️</span>
            </div>
            <pre style="margin:0;padding:14px;overflow-x:auto;font-family:'Consolas','Monaco','Courier New',monospace;font-size:13px;line-height:1.6;color:#3fb950;"><code>{escaped_output}</code></pre>
        </div>
    </div>
    '''
    return html.strip()

def build_coding_system_prompt(language: str = "python") -> str:
    return f"""You are NexusAI Coding Assistant. You provide COMPLETE, WORKING code with explanations.

RULES FOR CODING QUESTIONS:
1. ALWAYS provide complete, runnable code - no placeholders or incomplete snippets
2. Include proper imports, error handling, and comments
3. Code must be production-ready with best practices
4. After code, explain how it works in simple terms
5. Show expected output with sample values
6. Use {language.upper()} unless user specifies otherwise

RESPONSE FORMAT (JSON):
{{
    "code": "complete working code here",
    "explanation": "clear explanation of how the code works",
    "output": "expected output when running the code",
    "language": "{language}"
}}

Return ONLY valid JSON. No markdown, no extra text."""

def detect_language_from_question(text: str) -> str:
    text_lower = text.lower()
    language_map = {
        'python': ['python', 'py', 'django', 'flask', 'pandas', 'numpy'],
        'javascript': ['javascript', 'js', 'node', 'react', 'vue', 'angular', 'express'],
        'java': ['java', 'spring', 'android'],
        'cpp': ['c++', 'cpp', 'qt'],
        'c': ['c language', 'embedded c'],
        'csharp': ['c#', 'csharp', '.net', 'dotnet'],
        'sql': ['sql', 'mysql', 'postgresql', 'database query'],
        'html': ['html', 'html5'],
        'css': ['css', 'css3', 'styling'],
        'go': ['golang', 'go language'],
        'rust': ['rust', 'rustlang'],
        'ruby': ['ruby', 'rails'],
    }
    for lang, keywords in language_map.items():
        if any(kw in text_lower for kw in keywords):
            return lang
    return 'python'

# ============================================
# === END: CODING QUESTION FEATURE ===
# ============================================

def extract_text_with_ocr(image_bytes: bytes, page_num: int) -> str:
    if not PYTESSERACT_AVAILABLE:
        return ""
    try:
        img = Image.open(io.BytesIO(image_bytes))
        try:
            text = pytesseract.image_to_string(img, lang='eng', timeout=3)
        except Exception as timeout_e:
            print(f"    ⚠️ OCR timeout for page {page_num + 1} (slow to process)")
            return ""
        text = text.strip()
        if text and len(text) > 10:
            return text
        else:
            return ""
    except pytesseract.TesseractNotFoundError:
        print(f"    ❌ Tesseract not installed")
        return ""
    except Exception as e:
        return ""

def extract_text_with_langchain(pdf_bytes: bytes) -> str:
    if not LANGCHAIN_AVAILABLE:
        return ""
    try:
        import tempfile
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
            tmp.write(pdf_bytes)
            tmp_path = tmp.name
        try:
            loader = PDFPlumberLoader(tmp_path)
            docs = loader.load()
            text = "\n".join([doc.page_content for doc in docs])
            return text
        finally:
            try:
                os.unlink(tmp_path)
            except:
                pass
    except Exception as e:
        print(f"  ⚠️ LangChain extraction error: {e}")
        return ""

def extract_text_from_pdf_bytes(pdf_bytes: bytes) -> str:
    if LANGCHAIN_AVAILABLE:
        try:
            langchain_result = extract_text_with_langchain(pdf_bytes)
            if langchain_result and len(langchain_result) > 500:
                print(f"✅ LangChain extraction successful: {len(langchain_result):,} chars (instant)")
                return langchain_result
        except:
            pass
    if not PYMUPDF_AVAILABLE:
        return ""
    try:
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        total_pages = len(doc)
        print(f"📄 PDF has {total_pages} pages (scanned), extracting key pages with OCR...")
        pages_to_ocr = []
        pages_to_ocr.extend(range(0, min(15, total_pages)))
        for i in range(0, total_pages, 10):
            if i not in pages_to_ocr:
                pages_to_ocr.append(i)
        pages_to_ocr.extend(range(max(total_pages-10, 0), total_pages))
        pages_to_ocr = sorted(set(pages_to_ocr))
        print(f"  🎯 Sampling {len(pages_to_ocr)} pages: first 15 + every 10th + last 10")
        print(f"  ⚡ Using parallel OCR processing...")
        all_text_parts = {}
        def process_page_ocr(page_num: int) -> tuple:
            try:
                page = doc[page_num]
                page_text = page.get_text().strip()
                if len(page_text) > 100:
                    return (page_num, page_text)
                pix = page.get_pixmap(matrix=fitz.Matrix(0.75, 0.75), alpha=False)
                image_bytes = pix.tobytes(output="png")
                if len(image_bytes) > 3 * 1024 * 1024:
                    return (page_num, page_text)
                ocr_text = extract_text_with_ocr(image_bytes, page_num)
                combined = (page_text + "\n" + ocr_text).strip() if page_text else ocr_text
                if ocr_text:
                    print(f"  ✅ Page {page_num + 1}: {len(ocr_text)} chars")
                return (page_num, combined)
            except Exception as e:
                return (page_num, "")
        with ThreadPoolExecutor(max_workers=4) as executor:
            results = list(executor.map(process_page_ocr, pages_to_ocr))
        for page_num, text in results:
            if text:
                all_text_parts[page_num] = text
        result_text = []
        for page_num in sorted(all_text_parts.keys()):
            result_text.append(all_text_parts[page_num])
        doc.close()
        result = "\n".join(result_text).strip()
        if result and len(result) > 100:
            print(f"✅ PDF extraction complete: {len(result):,} chars from {len(pages_to_ocr)} sampled pages")
            return result
        else:
            print(f"⚠️ PDF extraction resulted in minimal text")
            return ""
    except Exception as e:
        print(f"⚠️ PDF extraction error: {e}")
        return ""

def describe_image_with_groq(image_bytes: bytes, mime_type: str) -> str:
    try:
        b64 = base64.b64encode(image_bytes).decode("utf-8")
        comp = get_groq_client().chat.completions.create(
            model="openai/gpt-oss-safeguard-20b",
            messages=[{
                "role": "user",
                "content": [
                    {"type": "image_url", "image_url": {"url": f"{mime_type};base64,{b64}"}},
                    {"type": "text", "text": (
                        "Describe this image in full detail. "
                        "Extract any visible text, labels, diagrams, tables, or data. "
                        "Be thorough so this description can be used to answer user questions."
                    )}
                ]
            }],
            temperature=0.1,
            max_tokens=1500,
            timeout=30.0,
        )
        return comp.choices[0].message.content.strip()
    except Exception as e:
        print(f"⚠ Image description error: {e}")
        return ""

def answer_from_file_context(user_question: str, file_text: str, filename: str) -> Optional[str]:
    if not file_text or len(file_text.strip()) < 20:
        return None
    question_lower = user_question.lower()
    keywords = []
    words = re.findall(r'\b\w{4,}\b', question_lower)
    keywords = [w for w in words if w not in ['what', 'when', 'where', 'which', 'from', 'with', 'that', 'this', 'have', 'does', 'explain', 'describe', 'tell', 'about', 'please']]
    relevant_sections = []
    text_lower = file_text.lower()
    for keyword in keywords[:3]:
        start = 0
        while True:
            pos = text_lower.find(keyword, start)
            if pos == -1:
                break
            context_start = max(0, pos - 500)
            context_end = min(len(file_text), pos + 500)
            section = file_text[context_start:context_end]
            if section not in relevant_sections:
                relevant_sections.append(section)
            start = pos + 1
    if not relevant_sections:
        relevant_sections = [file_text[:20000]]
    combined_text = '\n'.join(relevant_sections)
    if len(combined_text) > 15000:
        combined_text = combined_text[:15000] + '...'
    system_prompt = (
        "You are NexusAI File Analyst. "
        "Answer the user's question using the FILE CONTENT provided. "
        "Reply with the answer from the file. "
        "If not found in file, reply: NOT_IN_FILE"
    )
    user_msg = f"FILE: {filename}\nCONTENT:\n{combined_text}\n---\nQUESTION: {user_question}\nAnswer from file:"
    try:
        answer = chat_completion(
            messages=[{"role": "system", "content": system_prompt}, {"role": "user", "content": user_msg}],
            temperature=0.1,
            max_tokens=1000,
            timeout=20.0,
        )
        if answer.upper().startswith("NOT_IN_FILE") or len(answer.strip()) < 5:
            return None
        return clean_llm_response(answer)
    except Exception as e:
        print(f"⚠ file-context answer error: {e}")
        return None

# --- Background PDF processing ---
def _background_process_pdf(pdf_bytes: bytes, filename: str):
    global _file_context
    with _file_context_lock:
        _file_context["processing"] = True
        _file_context["ready"]      = False
        _file_context["error"]      = ""
    try:
        extracted_text = extract_text_from_pdf_bytes(pdf_bytes)
        if not extracted_text:
            with _file_context_lock:
                _file_context["error"]      = "Could not extract text from PDF."
                _file_context["processing"] = False
                _file_context["ready"]      = False
            return
        with _file_context_lock:
            _file_context["text"]       = extracted_text
            _file_context["ready"]      = True
            _file_context["processing"] = False
        print(f"✅ Background PDF done: {len(extracted_text)} chars for '{filename}'")
    except Exception as e:
        import traceback; traceback.print_exc()
        with _file_context_lock:
            _file_context["error"]      = str(e)
            _file_context["processing"] = False
            _file_context["ready"]      = False

# --- File upload endpoint ---
@app.post("/api/upload-file")
async def upload_file(background_tasks: BackgroundTasks, file: UploadFile = File(...)):
    global _file_context
    try:
        content_type = file.content_type or ""
        filename     = file.filename or "uploaded_file"
        print(f"\n📁 Upload started: {filename} | content_type={content_type}")
        MAX_BYTES = 100 * 1024 * 1024
        chunks = []; total = 0
        while True:
            chunk = await file.read(1024 * 256)
            if not chunk: break
            total += len(chunk)
            if total > MAX_BYTES:
                raise HTTPException(status_code=413, detail="File too large. Maximum size is 100 MB.")
            chunks.append(chunk)
        file_bytes  = b"".join(chunks)
        print(f"📁 Upload received: {filename} ({len(file_bytes):,} bytes / {len(file_bytes) / (1024*1024):.1f} MB)")
        fname_lower = filename.lower()
        is_pdf   = ("pdf" in content_type) or fname_lower.endswith(".pdf")
        is_image = (content_type.startswith("image/")) or fname_lower.endswith((".png",".jpg",".jpeg",".gif",".webp",".bmp"))
        if is_pdf:
            with _file_context_lock:
                _file_context.update({"text":"","filename":filename,"type":"pdf","processing":True,"ready":False,"error":""})
            background_tasks.add_task(_background_process_pdf, file_bytes, filename)
            file_size_mb = len(file_bytes) / (1024*1024)
            processing_time_est = f"{int(file_size_mb * 0.5)}-{int(file_size_mb * 1.5)} seconds" if file_size_mb > 10 else "30-60 seconds"
            return {"success":True,"filename":filename,"file_type":"pdf","processing":True,
                    "message":f"✅ '{filename}' ({file_size_mb:.1f} MB) received! Indexing in the background ({processing_time_est})..."}
        elif is_image:
            with _file_context_lock:
                _file_context.update({"text":"","filename":filename,"type":"image","processing":True,"ready":False,"error":""})
            loop = asyncio.get_event_loop()
            extracted_text = await asyncio.wait_for(
                loop.run_in_executor(_executor, describe_image_with_groq, file_bytes, content_type or "image/png"),
                timeout=45.0
            )
            if not extracted_text:
                return {"success":False,"message":"Could not analyse the image.","chars_extracted":0}
            with _file_context_lock:
                _file_context.update({"text":extracted_text,"processing":False,"ready":True})
            preview = extracted_text[:200].replace("\n"," ")
            return {"success":True,"filename":filename,"file_type":"image","chars_extracted":len(extracted_text),
                    "preview":preview,"processing":False,"message":f"✅ Image '{filename}' analysed. Ask away!"}
        else:
            raise HTTPException(status_code=400, detail="Unsupported file type. Upload a PDF or image.")
    except HTTPException: raise
    except asyncio.TimeoutError:
        with _file_context_lock:
            _file_context["error"] = "Processing timed out. Try a smaller file."
            _file_context["processing"] = False
        raise HTTPException(status_code=504, detail="File processing timed out")
    except Exception as e:
        import traceback; print(traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"File processing failed: {str(e)}")

@app.get("/api/upload-status")
async def upload_status():
    with _file_context_lock:
        return {"ready":_file_context.get("ready",False),"processing":_file_context.get("processing",False),
                "error":_file_context.get("error",""),"filename":_file_context.get("filename",""),
                "chars_extracted":len(_file_context.get("text",""))}

@app.post("/api/clear-file")
async def clear_file():
    global _file_context
    with _file_context_lock:
        _file_context = {"text":"","filename":"","type":"","processing":False,"ready":False,"error":""}
    return {"success":True,"message":"File context cleared."}

# --- SVG diagram generation (cached with thread safety) ---
_svg_cache: OrderedDict = OrderedDict()
_SVG_CACHE_MAX = 60
_svg_cache_lock = threading.Lock()

def _cache_svg(key: str, value: str):
    with _svg_cache_lock:
        if key in _svg_cache: _svg_cache.move_to_end(key)
        _svg_cache[key] = value
        while len(_svg_cache) > _SVG_CACHE_MAX: _svg_cache.popitem(last=False)

def generate_svg_diagram(user_message: str) -> Tuple[str, str]:
    msg_lower = user_message.lower().strip()
    skip_patterns = ['who is','who was','who are','actor','actress','singer','politician','celebrity','what is your name','how are you','thank you','thanks']
    for pat in skip_patterns:
        if msg_lower.startswith(pat) or msg_lower == pat: return "", ""
    if len(msg_lower) < 3: return "", ""
    cache_key = user_message[:120].strip()
    with _svg_cache_lock:
        if cache_key in _svg_cache:
            return _svg_cache[cache_key], ""
    svg_system = """You are an SVG diagram code generator. You output ONLY valid SVG code.
ABSOLUTE RULES:
1. Output ONLY raw SVG. Zero explanation. Zero markdown. Zero fences.
2. Must start with: <svg width="860" height="480" viewBox="0 0 860 480" xmlns="http://www.w3.org/2000/svg">
3. Must end with: </svg>
4. Always include: <rect width="860" height="480" fill="white"/> as first child
5. Always include arrowhead marker in <defs>
6. Colors for boxes: #4A90D9 blue, #5CB85C green, #E8A838 orange, #9B59B6 purple
7. Text inside boxes: fill="white" font-size="13" font-family="Arial,sans-serif"
8. Title: font-size="18" font-weight="bold" fill="#222" at top center (y="38")
9. Draw the REAL components of the topic — never a generic placeholder"""
    user_prompt = f"""Generate SVG diagram for: "{user_message}"
Draw the ACTUAL, SPECIFIC diagram for this exact topic.
Now output ONLY the SVG for: "{user_message}"
Start immediately with <svg"""
    svg = _make_fallback_svg(user_message)
    try:
        print(f"🎨 Generating SVG for: '{user_message[:60]}'")
        comp = get_groq_client().chat.completions.create(
            model="openai/gpt-oss-safeguard-20b",
            messages=[{"role":"system","content":svg_system},{"role":"user","content":user_prompt}],
            temperature=0.15,
            max_tokens=3000,
            timeout=25.0,
        )
        raw = comp.choices[0].message.content.strip()
        raw = re.sub(r'^```[a-zA-Z]*\s*','',raw).strip()
        raw = re.sub(r'\s*```\s*$','',raw).strip()
        svg_start = raw.find('<svg'); svg_end = raw.rfind('</svg>')
        if svg_start != -1 and svg_end != -1:
            llm_svg = raw[svg_start:svg_end+6]
            if len(llm_svg) >= 300 and any(tag in llm_svg for tag in ['<rect','<circle','<text','<path']):
                svg = llm_svg
                print(f"✅ LLM SVG ready ({len(svg)} chars)")
            else: print("⚠ LLM SVG too thin, using topic fallback")
        else: print("⚠ No valid SVG in LLM output, using topic fallback")
    except Exception as e:
        print(f"⚠ SVG LLM error: {e} — using topic fallback")
    data_url = "data:image/svg+xml;base64," + base64.b64encode(svg.encode('utf-8')).decode('utf-8')
    _cache_svg(cache_key, data_url)
    return data_url, user_message[:50]

def _make_fallback_svg(user_message: str) -> str:
    msg = user_message.lower(); title = user_message.title()[:45]
    if any(w in msg for w in ['python','java','javascript','compiler','interpreter']):
        steps = [("Source Code","#4A90D9"),("Lexer","#5CB85C"),("Parser","#E8A838"),("AST","#9B59B6"),("Bytecode","#4A90D9"),("Runtime","#5CB85C")]
    elif any(w in msg for w in ['neural','deep learn','machine learn','cnn','rnn']):
        steps = [("Input Layer","#4A90D9"),("Hidden Layer 1","#5CB85C"),("Hidden Layer 2","#E8A838"),("Output Layer","#9B59B6")]
    elif any(w in msg for w in ['tcp','ip','network','osi','http','protocol']):
        steps = [("Application","#4A90D9"),("Transport","#5CB85C"),("Internet","#E8A838"),("Network Access","#9B59B6")]
    elif any(w in msg for w in ['sort','search','algorithm','binary']):
        steps = [("Input","#4A90D9"),("Compare","#5CB85C"),("Swap/Select","#E8A838"),("Output","#9B59B6")]
    elif any(w in msg for w in ['os','operating system','kernel','process']):
        steps = [("User Apps","#4A90D9"),("System Calls","#5CB85C"),("Kernel","#E8A838"),("Hardware","#9B59B6")]
    elif any(w in msg for w in ['database','sql','nosql','mongodb']):
        steps = [("Application","#4A90D9"),("Query Layer","#5CB85C"),("Storage Engine","#E8A838"),("Disk","#9B59B6")]
    elif any(w in msg for w in ['cloud','aws','azure','docker','kubernetes']):
        steps = [("Client","#4A90D9"),("Load Balancer","#5CB85C"),("Services","#E8A838"),("Storage","#9B59B6")]
    else:
        steps = [("Input","#4A90D9"),("Process","#5CB85C"),("Logic","#E8A838"),("Output","#9B59B6")]
    n=len(steps); box_w,box_h,gap=110,54,30
    total_w=n*box_w+(n-1)*gap; start_x=(860-total_w)//2; y=210
    boxes_svg=""; arrows_svg=""
    for i,(label,color) in enumerate(steps):
        x=start_x+i*(box_w+gap); cx,cy=x+box_w//2,y+box_h//2
        boxes_svg+=f'<rect x="{x}" y="{y}" width="{box_w}" height="{box_h}" rx="8" fill="{color}"/>\n'
        boxes_svg+=f'<text x="{cx}" y="{cy+5}" text-anchor="middle" font-family="Arial,sans-serif" font-size="12" fill="white" font-weight="bold">{label}</text>\n'
        if i<n-1:
            ax1=x+box_w; ax2=x+box_w+gap; ay=y+box_h//2
            arrows_svg+=f'<line x1="{ax1}" y1="{ay}" x2="{ax2-8}" y2="{ay}" stroke="#555" stroke-width="2" marker-end="url(#arr)"/>\n'
    return f"""<svg width="860" height="480" viewBox="0 0 860 480" xmlns="http://www.w3.org/2000/svg">
<defs>
<marker id="arr" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
<polygon points="0 0,10 3.5,0 7" fill="#555"/>
</marker>
</defs>
<rect width="860" height="480" fill="white"/>
<text x="430" y="50" text-anchor="middle" font-family="Arial,sans-serif" font-size="18" font-weight="bold" fill="#222">{title}</text>
{boxes_svg}{arrows_svg}
</svg>"""

def get_image_for_topic(user_message: str) -> str:
    data_url, _ = generate_svg_diagram(user_message)
    return data_url

def create_html_with_image(text_response: str, image_url: str, topic: str) -> str:
    if not image_url: return text_response
    if 'data:image/svg+xml;base64' in text_response: return text_response
    image_html = f'''<div style="margin:0 0 20px 0;background:white;border-radius:12px;padding:14px;box-shadow:0 4px 20px rgba(0,0,0,0.25);">
<img src="{image_url}" alt="{topic} diagram" style="width:100%;height:auto;border-radius:6px;display:block;">
<p style="color:#666;font-size:11px;margin:6px 0 0 0;text-align:center;">📊 {topic.title()[:60]} — Diagram</p>
</div>'''
    content_style = 'style="white-space:pre-wrap;word-wrap:break-word;overflow-wrap:break-word;line-height:1.7;"'
    return f'''<div style="font-family:'Segoe UI',Arial,sans-serif;color:white;">
{image_html}
<div {content_style}>{text_response}</div>
</div>'''

# --- Language & mixed language detection ---
def extract_user_context(user_message: str) -> str:
    msg_lower = user_message.lower()
    wants_notes = bool(re.search(r'\bnotes?\b|\bsummary\b|\bsummaries\b|\boverview\b|\bguide\b|\btutorial\b', msg_lower))
    context_match = re.search(r'\b(?:for|as per|according to|based on|per|following)\b\s*(.{3,60})', msg_lower)
    context_phrase = ""
    if context_match:
        raw = context_match.group(1).strip()
        raw = re.sub(r'\b(exam|exams|test|notes?|summary|the)\b','',raw).strip()
        raw = re.sub(r'\s+',' ',raw).strip().title()
        if len(raw) > 2: context_phrase = raw
    parts = []
    if context_phrase:
        parts.append(f"The user is asking about the topic above in the context of {context_phrase}. "
                    f"Answer ONLY about the topic — do NOT explain or describe {context_phrase} itself. "
                    f"Match the depth, terminology, and syllabus coverage expected at {context_phrase} for this specific subject.")
    if wants_notes:
        parts.append("Format as structured notes: use numbered points and sub-points, short crisp sentences, key terms in Title Case — not long paragraphs.")
    return "\n".join(parts)

LANG_NAME_MAP = {
    'ta':'Tamil','hi':'Hindi','te':'Telugu','ml':'Malayalam','kn':'Kannada',
    'bn':'Bengali','mr':'Marathi','gu':'Gujarati','pa':'Punjabi','ur':'Urdu',
    'ar':'Arabic','fr':'French','de':'German','es':'Spanish','it':'Italian',
    'pt':'Portuguese','ru':'Russian','zh-cn':'Chinese','ja':'Japanese','ko':'Korean',
    'nl':'Dutch','sv':'Swedish','tr':'Turkish','pl':'Polish','en':'English',
}

def detect_language(text: str) -> str:
    try:
        if re.search(r'[\u0B80-\u0BFF]',text): return 'ta'
        if re.search(r'[\u0900-\u097F]',text): return 'hi'
        if re.search(r'[\u0600-\u06FF]',text): return 'ar'
        if re.search(r'[\u4E00-\u9FFF]',text): return 'zh-CN'
        if re.search(r'[\u3040-\u309F\u30A0-\u30FF]',text): return 'ja'
        if re.search(r'[\uAC00-\uD7AF]',text): return 'ko'
        if re.search(r'[\u0400-\u04FF]',text): return 'ru'
        if re.search(r'[\u0C00-\u0C7F]',text): return 'te'
        if re.search(r'[\u0D00-\u0D7F]',text): return 'ml'
        if re.search(r'[\u0980-\u09FF]',text): return 'bn'
        return 'en'
    except: return 'en'

MIXED_LANG_PATTERNS: List[Tuple] = [
    (re.compile(r'\b(sollu|solli|soll|kudu|theriyuma|puriyuma|pannunga|pannu|da|di|bro|machan|seri|illa|ama|romba)\b',re.IGNORECASE),
     "Tanglish (Tamil-English mix — reply naturally in Tanglish, mixing Tamil words and English)","tanglish"),
    (re.compile(r'\b(bolna|bolo|bata|batao|bol|kya|kaise|kyun|samjhao|yaar|bhai|mujhe|sikhao|padha)\b',re.IGNORECASE),
     "Hinglish (Hindi-English mix — reply naturally in Hinglish, mixing Hindi words and English)","hinglish"),
    (re.compile(r'\b(para|parayan|enthaa|ningal|njan|onnum|ille)\b',re.IGNORECASE),
     "Manglish (Malayalam-English mix — reply naturally in Manglish)","manglish"),
    (re.compile(r'\b(heli|helri|hegide|yaake|yaaru|enu|illi|gottilla|nodri)\b',re.IGNORECASE),
     "Kanglish (Kannada-English mix — reply naturally in Kanglish)","kanglish"),
]

_ALL_MIXED_TRIGGERS = re.compile(
    r'\b(sollu|solli|soll|kudu|theriyuma|puriyuma|pannunga|pannu|da|di|bro|machan|seri|illa|ama|romba|'
    r'bolna|bolo|bata|batao|bol|kya|kaise|kyun|samjhao|yaar|bhai|mujhe|sikhao|padha|'
    r'para|parayan|enthaa|ningal|njan|onnum|ille|heli|helri|nodri)\b',
    re.IGNORECASE
)

def detect_mixed_language(text: str) -> Optional[Tuple[str,str]]:
    for pattern,lang_label,lang_code in MIXED_LANG_PATTERNS:
        if pattern.search(text):
            print(f"🌐 Mixed language detected: {lang_code}")
            return lang_label,lang_code
    return None

def extract_core_topic_from_mixed(text: str) -> str:
    cleaned = _ALL_MIXED_TRIGGERS.sub(' ',text)
    cleaned = re.sub(r'\s+',' ',cleaned).strip()
    cleaned = re.sub(r'^[?!.,\s]+|[?!.,\s]+$','',cleaned).strip()
    return cleaned if len(cleaned)>=2 else text

async def process_user_input(text: str) -> tuple:
    mixed = detect_mixed_language(text)
    if mixed:
        lang_label,lang_code = mixed
        core_topic = extract_core_topic_from_mixed(text)
        print(f"🌐 Mixed '{lang_code}': '{text}' → core='{core_topic}'")
        return core_topic,lang_label
    lang_code = detect_language(text)
    if lang_code != 'en' and TRANSLATOR_AVAILABLE:
        def translate():
            try:
                translator = Translator()
                translated = translator.translate(text, src=lang_code, dest='en')
                if translated and translated.text:
                    return translated.text.strip()
            except Exception as e:
                print(f"⚠ Translation error: {e}")
                return None
        loop = asyncio.get_event_loop()
        translated = await loop.run_in_executor(_executor, translate)
        if translated:
            print(f"🌐 Native script → '{translated}'")
            return translated, lang_code
    return text, lang_code

def build_language_instruction(detected_lang: str) -> str:
    if len(detected_lang) > 10:
        return f"Respond in {detected_lang}."
    return f"Respond in {LANG_NAME_MAP.get(detected_lang.lower(),'English')} language."

async def translate_headings(lang_code: str) -> dict:
    fallback = {'intro':'INTRODUCTION','concepts':'CORE CONCEPTS','fundamental':'FUNDAMENTAL CONCEPTS',
                'detailed':'DETAILED EXPLANATION','example':'EXAMPLE','examples':'REAL-WORLD EXAMPLES',
                'applications':'APPLICATIONS','advantages':'ADVANTAGES','limitations':'LIMITATIONS',
                'conclusion':'CONCLUSION','insights':'KEY INSIGHTS'}
    if lang_code in ('tanglish','hinglish','manglish','kanglish','en') or not TRANSLATOR_AVAILABLE:
        return fallback
    def translate_headings_sync():
        try:
            translator = Translator()
            english = {'intro':'introduction','concepts':'core concepts','fundamental':'fundamental concepts',
                       'detailed':'detailed explanation','example':'example','examples':'real world examples',
                       'applications':'applications','advantages':'advantages','limitations':'limitations',
                       'conclusion':'conclusion','insights':'key insights'}
            out = {}
            for key,eng in english.items():
                try:
                    result = translator.translate(eng,src='en',dest=lang_code)
                    out[key] = result.text.upper() if result and result.text else fallback[key]
                except: out[key] = fallback[key]
            return out
        except: return fallback
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(_executor, translate_headings_sync)

async def get_section_headings(lang_code: str) -> dict:
    return await translate_headings(lang_code)

# --- Pattern definitions ---
GREETING_PATTERN    = re.compile(r'^\s*(hello|hi|hey|greetings|good morning|good afternoon|good evening|what\'s up|howdy|hiya)\b',re.IGNORECASE)
PAGE_PATTERN        = re.compile(r'(\d+)\s*pages?\b',re.IGNORECASE)
MARK_PATTERN        = re.compile(r'(\d+)\s*(?:mark|marks)\b',re.IGNORECASE)
POINT_PATTERN       = re.compile(r'(\d+)\s*(?:point|points)\b',re.IGNORECASE)
GIVE_POINTS_PATTERN = re.compile(r'give\s+(\d+)\s+points?\b',re.IGNORECASE)
NOTES_PATTERN       = re.compile(r'\bnotes?\b|\bsummary\b|\bsummaries\b|\boverview\b',re.IGNORECASE)
WORD_COUNT_PATTERN  = re.compile(r'(\d+)\s*(?:words?|word count)\b', re.IGNORECASE)
CHAR_COUNT_PATTERN  = re.compile(r'(\d+)\s*(?:chars?|characters?)\b', re.IGNORECASE)
MULTI_QUESTION_KEYWORDS = ['questions', 'question', 'each', 'all', 'every', 'following', 'below', 'these']

def detect_multiple_questions(text: str) -> bool:
    lines = [l.strip() for l in text.split('\n') if l.strip() and len(l) > 5]
    numbered_lines = [l for l in lines if re.match(r'^\d+\.?\s+', l)]
    if len(numbered_lines) >= 2:
        return True
    question_marks = text.count('?')
    if question_marks < 2:
        return False
    text_lower = text.lower()
    has_multi_keyword = any(kw in text_lower for kw in MULTI_QUESTION_KEYWORDS)
    if has_multi_keyword and question_marks >= 2:
        return True
    return False

def calculate_points_from_marks(marks: int, user_points: Optional[int] = None) -> int:
    if user_points is not None and user_points > 0:
        return user_points
    if marks <= 0:
        return 0
    if marks == 2:
        return 2
    return marks * 3

def extract_marks_and_points_flexible(msg_lower: str) -> Tuple[Optional[int], Optional[int]]:
    marks = None
    points = None
    combined_pattern = re.compile(r'(\d+)\s*(?:mark|marks)\s+(\d+)\s*(?:point|points)', re.IGNORECASE)
    combined_match = combined_pattern.search(msg_lower)
    if combined_match:
        marks = int(combined_match.group(1))
        points = int(combined_match.group(2))
        return marks, points
    mark_match = MARK_PATTERN.search(msg_lower)
    if mark_match:
        marks = int(mark_match.group(1))
    point_match = POINT_PATTERN.search(msg_lower)
    if point_match:
        points = int(point_match.group(1))
    give_points_match = GIVE_POINTS_PATTERN.search(msg_lower)
    if give_points_match:
        points = int(give_points_match.group(1))
    return marks, points

@lru_cache(maxsize=128)
def is_greeting_cached(msg: str) -> bool:
    return bool(GREETING_PATTERN.search(msg))

def is_greeting(msg: str) -> bool:
    return is_greeting_cached(msg.strip())

@lru_cache(maxsize=64)
def extract_questions_comprehensive_cached(text: str) -> tuple:
    questions,seen,unique=[],set(),[]
    lines = text.split('\n')
    for line in lines:
        line=line.strip()
        if not line or len(line)>400: continue
        numbered_match = re.match(r'^(\d+)\.?\s+(.+)$', line)
        if numbered_match:
            q = numbered_match.group(2).strip()
            if q and 5<len(q)<350:
                if not q.endswith('?'):
                    q=q+'?' if any(w in q.lower() for w in ['define','list','what','explain','state','name','how','why','when','where']) else q
                questions.append(q)
    for line in lines:
        line=line.strip()
        if not line or len(line)>400: continue
        if line.endswith('?') and 10<len(line)<350:
            if not any(q.lower() in line.lower() for q in questions):
                questions.append(line)
    for q in questions:
        k=re.sub(r'[^\w\s]','',q.lower())
        if k not in seen and k not in ['introduction','key features','applications','conclusion','references']:
            unique.append(q)
            seen.add(k)
    return tuple(unique)

def extract_questions_comprehensive(text: str) -> list:
    return list(extract_questions_comprehensive_cached(text))

def calculate_word_count_from_pages(pages: int) -> int: return pages*250
def calculate_word_count_from_marks(marks: int) -> int: return marks*50

def detect_mode_from_message(msg_lower: str) -> Tuple[str,int]:
    if any(t in msg_lower for t in ["explain in detail","detailed explanation","comprehensive","in depth"]): return "detailed_no_schedule",2
    if any(t in msg_lower for t in ["teach me","explain like","for beginners","simple"]): return "teaching",2
    if NOTES_PATTERN.search(msg_lower): return "notes",0
    if "point" in msg_lower or "mark" in msg_lower:
        gm=GIVE_POINTS_PATTERN.search(msg_lower)
        if gm: return "points",int(gm.group(1))
        gn=POINT_PATTERN.search(msg_lower) or MARK_PATTERN.search(msg_lower)
        if gn: return "points",int(gn.group(1))
    return "detailed",2

def extract_length_constraint(msg_lower: str) -> Optional[dict]:
    word_match = WORD_COUNT_PATTERN.search(msg_lower)
    if word_match:
        return {'count': int(word_match.group(1)), 'type': 'words'}
    char_match = CHAR_COUNT_PATTERN.search(msg_lower)
    if char_match:
        return {'count': int(char_match.group(1)), 'type': 'chars'}
    return None

def build_system_prompt(mode, point_count, user_context, detected_lang, headings, page_match=None, mark_match=None,
                        length_constraint=None, multiple_questions=False, marks_for_multi=None, points_for_multi=None) -> Tuple[str,int]:
    lang_instr=build_language_instruction(detected_lang)
    default_max_tok = 16000
    prompt_parts = [f"You are NexusAI.", user_context]
    if multiple_questions and marks_for_multi is not None:
        calculated_points = calculate_points_from_marks(marks_for_multi, points_for_multi)
        prompt_parts.append(f"MULTIPLE QUESTIONS MODE: Answer EACH question with EXACTLY {calculated_points} points.")
        prompt_parts.append(f"Each point must be EXACTLY ONE sentence only. No more, no less.")
        prompt_parts.append(f"IMPORTANT: Each question gets {calculated_points} points independently. Do NOT share points across questions.")
        prompt_parts.append(f"Format: For each question, number the points clearly (1., 2., 3., etc.)")
        prompt_parts.append(f"NO diagrams, NO images, NO lengthy explanations.")
        prompt_parts.append(f"Keep answers concise and focused. {lang_instr}")
        return ("\n".join(prompt_parts), 16000)
    if page_match:
        pages=int(page_match.group(1)); wc=calculate_word_count_from_pages(pages)
        prompt_parts.append(f"Provide a comprehensive ~{wc}-word explanation.")
        prompt_parts.append("STRUCTURE: INTRODUCTION, CORE CONCEPTS, CONCRETE EXAMPLE, TECHNICAL DETAILS, REAL-WORLD APPLICATIONS, CHALLENGES/TRADE-OFFS, CONCLUSION.")
        prompt_parts.append(f"Use clear section headings (no ## symbols, no ALL-CAPS). {lang_instr} NO schedule.")
        return ("\n".join(prompt_parts), min(wc*2, 16000))
    if mark_match:
        marks=int(mark_match.group(1)); wc=calculate_word_count_from_marks(marks)
        prompt_parts.append(f"Answer this {marks}-mark question as a continuous ~{wc}-word essay.")
        prompt_parts.append("Cover: Introduction, Motivation, Components, Working, Features, Advantages, Limitations, Applications, Conclusion.")
        prompt_parts.append(f"Continuous essay, NOT Q&A. Clear headings (no ## symbols). {lang_instr} NO schedule.")
        return ("\n".join(prompt_parts), min(wc*2, 16000))
    if length_constraint:
        count = length_constraint['count']
        ctype = length_constraint['type']
        prompt_parts.append(f"STRICT LENGTH CONSTRAINT: Your response must NOT exceed {count} {ctype}.")
        prompt_parts.append("Keep your answer concise and within this limit.")
        if ctype == 'words':
            estimated_tokens = int(count * 1.3 * 1.2)
        else:
            estimated_tokens = int((count / 4) * 1.2)
            estimated_tokens = max(estimated_tokens, 500)
            estimated_tokens = min(estimated_tokens, default_max_tok)
        default_max_tok = estimated_tokens
    if mode=="notes":
        prompt_parts.append("Generate comprehensive structured NOTES on the topic.")
        prompt_parts.append("Use numbered points and sub-points. Short crisp sentences. Include: Definition, Key Concepts, Types, Working, Advantages, Disadvantages, Applications.")
        prompt_parts.append(f"{lang_instr} NO schedule. NO ## symbols.")
        return ("\n".join(prompt_parts), 16000)
    if mode=="detailed_no_schedule":
        prompt_parts.append("Provide a COMPREHENSIVE 2000-word explanation.")
        prompt_parts.append(lang_instr)
        prompt_parts.append(f"Use clear section headings (no ## symbols, no ALL-CAPS):")
        prompt_parts.append(f"  {headings['intro']}, {headings['fundamental']}, {headings['detailed']},")
        prompt_parts.append(f"  {headings['examples']}, {headings['applications']},")
        prompt_parts.append(f"  {headings['advantages']}, {headings['limitations']}, {headings['conclusion']}")
        prompt_parts.append("NO timetable. NO image tags.")
        return ("\n".join(prompt_parts), 16000)
    if mode=="teaching":
        prompt_parts.append("Simple language and analogies. NO ## symbols.")
        return ("\n".join(prompt_parts), 8000)
    prompt_parts.append("Provide a detailed ~1500-word explanation of the topic.")
    prompt_parts.append(lang_instr)
    prompt_parts.append("EXPLANATION STRUCTURE — clear section headings (no ## symbols, no ALL-CAPS):")
    prompt_parts.append(f"  {headings['intro']}")
    prompt_parts.append(f"{headings['concepts']}")
    prompt_parts.append(f"{headings['example']}")
    prompt_parts.append(f"  {headings['applications']}")
    prompt_parts.append(f"{headings['insights']}")
    prompt_parts.append("NO timetable. NO study schedule. NO markdown image tags.")
    return ("\n".join(prompt_parts), 16000)

# ============================================
# === TEACH ENDPOINTS ===
# ============================================
@app.post("/api/teach-simple")
async def teach_simple(request: SimpleTeachRequest):
    try:
        topic = request.topic
        language = request.language
        previous_response = request.previous_response.strip()
        questions = request.questions or []
        is_multiple = len(questions) >= 2
        loop = asyncio.get_event_loop()
        def _run_teach():
            if is_multiple:
                all_simplified = []
                for i, q in enumerate(questions[:10]):
                    system_prompt = (
                        f"You are NexusAI. Explain '{q}' simply in 150-200 words (1 paragraph).\n"
                        f"RULES: Simple language, clear explanation, no jargon. "
                        f"NO schedule. NO ## symbols. NO image tags. Respond in '{language}'.\n"
                        f"Answer ONLY this question: {q}"
                    )
                    user_msg = f"Explain '{q}' simply in one paragraph."
                    try:
                        simplified = clean_llm_response(chat_completion(
                            messages=[{"role":"system","content":system_prompt},{"role":"user","content":user_msg}],
                            temperature=0.3, max_tokens=1000, top_p=0.9, timeout=25.0
                        ))
                        all_simplified.append(f"**Question {i+1}:** {q}\n{simplified}\n")
                    except Exception as e:
                        all_simplified.append(f"**Question {i+1}:** {q}\n[Could not simplify this question]\n")
                return "\n---\n".join(all_simplified)
            else:
                if previous_response:
                    plain_prev = re.sub(r'<[^>]+>', ' ', previous_response)[:3000].strip()
                    system_prompt = (
                        f"You are NexusAI. Rewrite the explanation about '{topic}' as a SHORT SIMPLE SUMMARY of 300-400 words.\n"
                        f"RULES: Clear section labels: WHAT IS IT / HOW IT WORKS / REAL EXAMPLE / WHY IT MATTERS. "
                        f"NO schedule. NO ## symbols. NO image tags. Respond in '{language}'.\n"
                        f"EXPLANATION:\n{plain_prev}"
                    )
                    user_msg = f"Short simple version about {topic}."
                else:
                    system_prompt = (
                        f"You are NexusAI. Explain '{topic}' simply in 300-400 words.\n"
                        f"Clear section labels: WHAT IS IT / HOW IT WORKS / REAL EXAMPLE / WHY IT MATTERS. "
                        f"NO schedule. NO ## symbols. NO image tags. Respond in '{language}'."
                    )
                    user_msg = f"Explain {topic} simply in 300-400 words."
                return clean_llm_response(chat_completion(
                    messages=[{"role":"system","content":system_prompt},{"role":"user","content":user_msg}],
                    temperature=0.3, max_tokens=2000, top_p=0.9, timeout=25.0
                ))
        response_text = await asyncio.wait_for(
            loop.run_in_executor(_executor, _run_teach),
            timeout=60.0 if is_multiple else 30.0
        )
        return {
            "response": f'<div style="white-space:pre-wrap;word-wrap:break-word;overflow-wrap:break-word;font-family:\'Segoe UI\',Arial,sans-serif;color:white;line-height:1.7;">{response_text}</div>',
            "is_multiple": is_multiple,
            "question_count": len(questions) if is_multiple else 1
        }
    except Exception as e:
        import traceback; print(traceback.format_exc())
        raise HTTPException(status_code=500, detail="An error occurred. Please try again.")

@app.post("/api/explain-like-child")
async def explain_like_child(request: ChildTeachRequest):
    try:
        topic = request.topic
        language = request.language
        questions = request.questions or []
        is_multiple = len(questions) >= 2
        loop = asyncio.get_event_loop()
        def _run_child():
            if is_multiple:
                all_explained = []
                for i, q in enumerate(questions[:5]):
                    def build_child_prompt(strict=False):
                        base = (
                            f"You are a friendly teacher explaining '{q}' to a 5-year-old child.\n"
                            f"Write EXACTLY 3 paragraphs (shorter for multiple questions). Each paragraph MUST be 3-4 simple sentences long.\n"
                            f"Do NOT stop early. You MUST complete all 3 paragraphs fully before stopping.\n"
                            f"Use simple everyday words only. Fun analogies with toys, food, or animals.\n"
                            f"NO emoji anywhere in the response.\n"
                            f"NO bullet points. NO numbered lists. NO ## symbols.\n"
                            f"NO HTML tags. NO markdown. NO title line. NO heading.\n"
                            f"NO greeting opener like 'Sure!', 'Of course!', 'Great question!' etc.\n"
                            f"Start your VERY FIRST word with the actual explanation — jump straight in.\n"
                            f"Separate paragraphs with one blank line.\n"
                            f"End the last paragraph with one fun fact about '{q}'.\n"
                            f"Plain text only. Language: {language}."
                        )
                        if strict:
                            base += f"\nCRITICAL: Begin explaining '{q}' immediately with a real word. Write all 3 paragraphs without stopping."
                        return base
                    def strip_response(raw):
                        plain = clean_to_plain_text(raw)
                        lines = plain.splitlines()
                        while lines and not any(c.isalpha() for c in lines[0]):
                            lines.pop(0)
                        return "\n".join(lines).strip()
                    try:
                        raw1 = chat_completion(
                            messages=[{"role":"system","content":build_child_prompt()},
                                    {"role":"user","content":f"Explain {q} like I'm 5 years old! Write all 3 paragraphs completely."}],
                            temperature=0.4, max_tokens=1500, top_p=0.9, timeout=25.0
                        )
                        plain = strip_response(raw1)
                        if not plain or not any(c.isalpha() for c in plain):
                            raw2 = chat_completion(
                                messages=[{"role":"system","content":build_child_prompt(True)},
                                        {"role":"user","content":f"Explain {q} to a young child in 3 paragraphs. Write all 3 fully."}],
                                temperature=0.2, max_tokens=1200, top_p=0.85, timeout=25.0
                            )
                            plain = strip_response(raw2)
                        if not plain or not any(c.isalpha() for c in plain):
                            plain = (
                                f"{q} is something really interesting!\n"
                                f"Think of it like a puzzle with lots of small pieces that fit together to make something big and useful.\n"
                                f"People use this every day to solve problems and make life easier.\n"
                                f"Fun fact: You probably see it every single day without even knowing it!"
                            )
                        all_explained.append(f"**Question {i+1}:** {q}\n{plain}\n")
                    except Exception as e:
                        all_explained.append(f"**Question {i+1}:** {q}\n[Could not explain this question simply]\n")
                return "\n---\n".join(all_explained)
            else:
                def build_prompt(strict=False):
                    base = (
                        f"You are a friendly teacher explaining '{topic}' to a 5-year-old child.\n"
                        f"Write EXACTLY 7 paragraphs. Each paragraph MUST be 4-5 simple sentences long.\n"
                        f"Do NOT stop early. You MUST complete all 7 paragraphs fully before stopping.\n"
                        f"Use simple everyday words only. Fun analogies with toys, food, or animals.\n"
                        f"NO emoji anywhere in the response.\n"
                        f"NO bullet points. NO numbered lists. NO ## symbols.\n"
                        f"NO HTML tags. NO markdown. NO title line. NO heading.\n"
                        f"NO greeting opener like 'Sure!', 'Of course!', 'Great question!' etc.\n"
                        f"Start your VERY FIRST word with the actual explanation — jump straight in.\n"
                        f"Separate paragraphs with one blank line.\n"
                        f"End the last paragraph with one fun fact about '{topic}'.\n"
                        f"Plain text only. Language: {language}."
                    )
                    if strict:
                        base += f"\nCRITICAL: Begin explaining '{topic}' immediately with a real word. Write all 7 paragraphs without stopping."
                    return base
                def strip_response(raw):
                    plain = clean_to_plain_text(raw)
                    lines = plain.splitlines()
                    while lines and not any(c.isalpha() for c in lines[0]):
                        lines.pop(0)
                    return "\n".join(lines).strip()
                raw1 = chat_completion(
                    messages=[{"role":"system","content":build_prompt()},
                            {"role":"user","content":f"Explain {topic} like I'm 5 years old! Write all 7 paragraphs completely."}],
                    temperature=0.4, max_tokens=3000, top_p=0.9, timeout=25.0
                )
                plain = strip_response(raw1)
                if not plain or not any(c.isalpha() for c in plain):
                    print(f"⚠ explain-like-child: empty after strip, retrying...")
                    raw2 = chat_completion(
                        messages=[{"role":"system","content":build_prompt(True)},
                                {"role":"user","content":f"Explain {topic} to a young child in 7 paragraphs. Write all 7 fully."}],
                        temperature=0.2, max_tokens=2500, top_p=0.85, timeout=25.0
                    )
                    plain = strip_response(raw2)
                if not plain or not any(c.isalpha() for c in plain):
                    plain = (
                        f"{topic} is something really interesting!\n"
                        f"Think of it like a puzzle with lots of small pieces that fit together to make something big and useful.\n"
                        f"People use {topic} every day to solve problems and make life easier.\n"
                        f"Imagine you had a magic box that could do special things — that is a little bit like {topic}.\n"
                        f"When you learn about {topic}, you start to understand how many things around you work.\n"
                        f"Even grown-ups spend years learning about {topic} because there is always something new to discover.\n"
                        f"Fun fact: {topic} is used in so many places that you probably see it every single day without even knowing it!"
                    )
                return plain
        response_text = await asyncio.wait_for(
            loop.run_in_executor(_executor, _run_child),
            timeout=90.0 if is_multiple else 30.0
        )
        return {
            "response": response_text,
            "is_multiple": is_multiple,
            "question_count": len(questions) if is_multiple else 1
        }
    except Exception as e:
        import traceback; print(traceback.format_exc())
        raise HTTPException(status_code=500, detail="An error occurred. Please try again.")

# ============================================
# === CHAT ENDPOINTS ===
# ============================================
@app.post("/api/chat")
async def chat(request: ChatRequest):
    try:
        messages=request.messages
        if not messages: raise HTTPException(status_code=400,detail="No messages provided")
        latest_user_msg=messages[-1]["content"]
        english_query,detected_lang = await process_user_input(latest_user_msg)
        if english_query!=latest_user_msg:
            messages=messages[:-1]+[{"role":"user","content":english_query}]
        msg_lower=english_query.lower()
        MAX_HISTORY_MESSAGES = 6
        if len(messages) > MAX_HISTORY_MESSAGES:
            system_msgs = [m for m in messages if m.get("role") == "system"]
            other_msgs = [m for m in messages if m.get("role") != "system"]
            messages = system_msgs + other_msgs[-MAX_HISTORY_MESSAGES:]
            print(f"📊 Trimmed message history from {len(request.messages)} to {len(messages)} messages")
        headings = await get_section_headings(detected_lang)
        if is_greeting(latest_user_msg):
            return {"response":"Hello! I'm NexusAI, your intelligent assistant. How can I help you today?"}
        
        # ============================================
        # === CHECK FOR CODING QUESTION ===
        # ============================================
        is_coding = is_coding_question(latest_user_msg)
        if is_coding:
            print(f"💻 Coding question detected: {latest_user_msg[:50]}")
            coding_lang = detect_language_from_question(latest_user_msg)
            loop = asyncio.get_event_loop()
            
            def _run_coding_response():
                try:
                    comp = get_groq_client().chat.completions.create(
                        model="openai/gpt-oss-safeguard-20b",
                        messages=[
                            {"role":"system","content":build_coding_system_prompt(coding_lang)},
                            {"role":"user","content":f"Question: {english_query}"}
                        ],
                        temperature=0.2,
                        max_tokens=3000,
                        timeout=30.0,
                    )
                    raw = comp.choices[0].message.content.strip()
                    raw = re.sub(r'^```[a-zA-Z]*\n?','',raw).rstrip("`").strip()
                    start=raw.find('{'); end=raw.rfind('}')
                    if start!=-1 and end!=-1:
                        raw = raw[start:end+1]
                    response_data = json.loads(raw)
                    return format_coding_response(
                        code=response_data.get("code", ""),
                        explanation=response_data.get("explanation", ""),
                        output=response_data.get("output", ""),
                        language=response_data.get("language", coding_lang)
                    )
                except Exception as e:
                    print(f"⚠ Coding response error: {e}")
                    return None
            
            try:
                coding_response = await asyncio.wait_for(
                    loop.run_in_executor(_executor, _run_coding_response),
                    timeout=35.0
                )
                if coding_response:
                    return {"response": coding_response}
            except Exception as e:
                print(f"⚠ Coding response failed, using regular chat: {e}")
        # ============================================
        # === END: CODING QUESTION CHECK ===
        # ============================================
        
        user_context=extract_user_context(latest_user_msg)
        is_multiple_questions = detect_multiple_questions(latest_user_msg)
        marks_extracted, points_extracted = extract_marks_and_points_flexible(msg_lower)
        current_questions = extract_questions_comprehensive(latest_user_msg)
        should_use_multi_with_points = (is_multiple_questions and marks_extracted is not None and len(current_questions) >= 2)
        should_use_multi_no_points = (is_multiple_questions and marks_extracted is None and len(current_questions) >= 2)
        is_default_mode = not should_use_multi_with_points and not should_use_multi_no_points
        print(f"📊 Mode Detection: multi_with_points={should_use_multi_with_points}, multi_no_points={should_use_multi_no_points}, default={is_default_mode}")
        print(f"📝 Questions extracted: {len(current_questions)}")
        skip_image = any(kw in english_query.lower() for kw in ['who','person','famous','actor','actress','singer','politician','celebrity'])
        if should_use_multi_with_points or should_use_multi_no_points:
            skip_image = True
            print(f"🚫 Multiple questions mode - skipping images")
        else:
            print(f"✅ Default mode - images allowed")
        image_url=""
        loop = asyncio.get_event_loop()
        if not skip_image and len(english_query)>=2 and not is_coding:
            try:
                image_url = await asyncio.wait_for(
                    loop.run_in_executor(_executor, get_image_for_topic, english_query),
                    timeout=30.0
                )
                print(f"🖼️ Image generated for: {english_query[:50]}")
            except asyncio.TimeoutError:
                print(f"⚠️ Image generation timed out - continuing without image")
                image_url = ""
        file_prefix=""
        with _file_context_lock:
            fname = _file_context.get("filename")
            processing = _file_context.get("processing")
            ready = _file_context.get("ready")
            ftext = _file_context.get("text")
            if fname:
                if processing:
                    file_prefix=(f'<div style="background:rgba(99,102,241,0.12);border-left:4px solid #6366f1;padding:8px 14px;margin-bottom:14px;border-radius:4px;'
                                f'font-family:\'Segoe UI\',Arial,sans-serif;color:#a5b4fc;font-size:13px;">⏳ Still indexing <strong>{fname}</strong> — answering from general knowledge for now.</div>')
                elif ready and ftext:
                    try:
                        file_answer = await asyncio.wait_for(
                            loop.run_in_executor(_executor, answer_from_file_context, english_query, ftext, fname),
                            timeout=25.0
                        )
                        if file_answer:
                            file_badge=(f'<div style="background:rgba(0,180,100,0.15);border-left:4px solid #00b464;padding:8px 14px;margin-bottom:14px;border-radius:4px;'
                                       f'font-family:\'Segoe UI\',Arial,sans-serif;color:#7fffb8;font-size:13px;">📄 Answer sourced from: <strong>{fname}</strong></div>')
                            return {"response":file_badge+f'<div style="white-space:pre-wrap;word-wrap:break-word;overflow-wrap:break-word;color:white;">{file_answer}</div>'}
                        else:
                            file_prefix=(f'<div style="background:rgba(255,160,0,0.12);border-left:4px solid #ffa000;padding:8px 14px;margin-bottom:14px;border-radius:4px;'
                                        f'font-family:\'Segoe UI\',Arial,sans-serif;color:#ffd580;font-size:13px;">⚠️ Not found in uploaded file ({fname}). Here is the answer from my knowledge:</div>')
                    except asyncio.TimeoutError:
                        print(f"⚠️ File context answer timed out - using general knowledge")
                        file_prefix=(f'<div style="background:rgba(255,160,0,0.12);border-left:4px solid #ffa000;padding:8px 14px;margin-bottom:14px;border-radius:4px;'
                                    f'font-family:\'Segoe UI\',Arial,sans-serif;color:#ffd580;font-size:13px;">⚠️ File search timed out. Here is the answer from my knowledge:</div>')
        length_constraint = extract_length_constraint(msg_lower)
        page_match=PAGE_PATTERN.search(msg_lower); mark_match=MARK_PATTERN.search(msg_lower)
        current_mode,current_point_count=detect_mode_from_message(msg_lower)
        def _run_chat_completion(system_prompt, user_content, temp, max_tok, top_p):
            return clean_llm_response(chat_completion(
                messages=[{"role":"system","content":system_prompt},{"role":"user","content":user_content}],
                temperature=temp,max_tokens=max_tok,top_p=top_p,timeout=25.0))
        if should_use_multi_with_points:
            calculated_points = calculate_points_from_marks(marks_extracted, points_extracted)
            questions_text = "\n---\n".join([f"QUESTION {i+1}: {q}" for i,q in enumerate(current_questions)])
            system_prompt = f"""You are NexusAI. Answer in {LANG_NAME_MAP.get(detected_lang, 'English')}.
MULTIPLE QUESTIONS MODE: Answer EACH question with EXACTLY {calculated_points} points.
Each point must be EXACTLY ONE sentence only.
NO diagrams, NO images, NO lengthy explanations.
Format: QUESTION 1: then 1. 2. 3. etc."""
            response_text = await asyncio.wait_for(
                loop.run_in_executor(_executor, _run_chat_completion, system_prompt,
                                    f"CRITICAL: Answer ALL {len(current_questions)} questions. Do NOT skip any.\n"
                                    f"Each question needs EXACTLY {calculated_points} points. Each point = 1 sentence.\n"
                                    f"Format:\nQUESTION 1:\n1. [point]\n2. [point]\n...\nQUESTION 2:\n...\n"
                                    f"Questions:\n{questions_text}", 0.15, 16000, 0.88),
                timeout=35.0
            )
            return {"response":file_prefix+f'<div style="white-space:pre-wrap;word-wrap:break-word;overflow-wrap:break-word;color:white;">{response_text}</div>'}
        if should_use_multi_no_points:
            questions_text = "\n---\n".join([f"QUESTION {i+1}: {q}" for i,q in enumerate(current_questions)])
            system_prompt = f"""You are NexusAI. Answer in {LANG_NAME_MAP.get(detected_lang, 'English')}.
MULTIPLE QUESTIONS MODE: Answer each question with a full paragraph.
NO diagrams, NO images.
Format: QUESTION 1: then paragraph answer."""
            response_text = await asyncio.wait_for(
                loop.run_in_executor(_executor, _run_chat_completion, system_prompt,
                                    f"CRITICAL: Answer ALL {len(current_questions)} questions. Do NOT skip any.\n"
                                    f"Answer EACH question with a full paragraph (not just 1 sentence).\n"
                                    f"Format:\nQUESTION 1:\n[Paragraph answer]\nQUESTION 2:\n[Paragraph answer]\n"
                                    f"Questions:\n{questions_text}", 0.2, 16000, 0.9),
                timeout=35.0
            )
            return {"response":file_prefix+f'<div style="white-space:pre-wrap;word-wrap:break-word;overflow-wrap:break-word;color:white;">{response_text}</div>'}
        system_prompt,max_tok=build_system_prompt(current_mode,current_point_count,user_context,detected_lang,headings,
                                                  page_match,mark_match, length_constraint=length_constraint,
                                                  multiple_questions=False, marks_for_multi=None, points_for_multi=None)
        response_text = await asyncio.wait_for(
            loop.run_in_executor(_executor, _run_chat_completion, system_prompt, english_query, 0.25, max_tok, 0.92),
            timeout=35.0
        )
        if image_url:
            print(f"✅ Returning response with image for: {english_query[:50]}")
            return {"response":file_prefix+create_html_with_image(response_text,image_url,english_query)}
        print(f"✅ Returning response (no image) for: {english_query[:50]}")
        return {"response":file_prefix+f'<div style="white-space:pre-wrap;word-wrap:break-word;overflow-wrap:break-word;color:white;">{response_text}</div>'}
    except asyncio.TimeoutError:
        print(f"⚠️ Chat request timed out")
        raise HTTPException(status_code=504,detail="Request timed out. Please try again.")
    except Exception as e:
        import traceback; print(traceback.format_exc())
        raise HTTPException(status_code=500,detail="An error occurred. Please try again.")

@app.post("/api/chat/stream")
async def chat_stream(request: ChatRequest):
    messages=request.messages
    if not messages: raise HTTPException(status_code=400,detail="No messages provided")
    latest_user_msg=messages[-1]["content"]
    english_query,detected_lang = await process_user_input(latest_user_msg)
    if english_query!=latest_user_msg:
        messages=messages[:-1]+[{"role":"user","content":english_query}]
    msg_lower=english_query.lower()
    MAX_HISTORY_MESSAGES = 6
    if len(messages) > MAX_HISTORY_MESSAGES:
        system_msgs = [m for m in messages if m.get("role") == "system"]
        other_msgs = [m for m in messages if m.get("role") != "system"]
        messages = system_msgs + other_msgs[-MAX_HISTORY_MESSAGES:]
        print(f"📊 Stream: Trimmed message history from {len(request.messages)} to {len(messages)} messages")
    headings = await get_section_headings(detected_lang)
    user_context=extract_user_context(latest_user_msg)
    if is_greeting(latest_user_msg):
        greeting="Hello! I'm NexusAI, your intelligent assistant. How can I help you today?"
        async def greeting_gen():
            yield f"data: {json.dumps({'type':'token','content':greeting})}\n\n"
            yield f"data: {json.dumps({'type':'done'})}\n\n"
        return StreamingResponse(greeting_gen(),media_type="text/event-stream",headers={"Cache-Control":"no-cache","X-Accel-Buffering":"no"})
    
    # ============================================
    # === CHECK FOR CODING QUESTION (STREAM) ===
    # ============================================
    is_coding = is_coding_question(latest_user_msg)
    if is_coding:
        print(f"💻 Streaming: Coding question detected")
        coding_lang = detect_language_from_question(latest_user_msg)
        
        def sync_coding_stream_gen():
            # --- Handle file context prefix (same as normal chat) ---
            prefix_html = ""
            with _file_context_lock:
                fname = _file_context.get("filename")
                processing = _file_context.get("processing")
                ready = _file_context.get("ready")
                ftext = _file_context.get("text")
                if fname:
                    if processing:
                        prefix_html = ('<div style="background:rgba(99,102,241,0.12);border-left:4px solid #6366f1;'
                                      'padding:8px 14px;margin-bottom:14px;border-radius:4px;color:#a5b4fc;font-size:13px;">'
                                      f'⏳ Still indexing <strong>{fname}</strong> — answering from general knowledge for now.</div>')
                    elif ready and ftext:
                        file_answer = answer_from_file_context(english_query, ftext, fname)
                        if file_answer:
                            badge = ('<div style="background:rgba(0,180,100,0.15);border-left:4px solid #00b464;'
                                    'padding:8px 14px;margin-bottom:14px;border-radius:4px;color:#7fffb8;font-size:13px;">'
                                    f'📄 Answer sourced from: <strong>{fname}</strong></div>')
                            # Send the file answer as a complete response
                            yield f"data: {json.dumps({'type':'token','content':badge + file_answer})}\n\n"
                            yield f"data: {json.dumps({'type':'done'})}\n\n"
                            return
                        else:
                            prefix_html = ('<div style="background:rgba(255,160,0,0.12);border-left:4px solid #ffa000;'
                                          'padding:8px 14px;margin-bottom:14px;border-radius:4px;color:#ffd580;font-size:13px;">'
                                          f'⚠️ Not found in uploaded file ({fname}). Here is the answer from my knowledge:</div>')
            if prefix_html:
                yield f"data: {json.dumps({'type':'token','content':prefix_html})}\n\n"
            
            # --- Generate coding response ---
            try:
                comp = get_groq_client().chat.completions.create(
                    model="openai/gpt-oss-safeguard-20b",
                    messages=[
                        {"role":"system","content":build_coding_system_prompt(coding_lang)},
                        {"role":"user","content":f"Question: {english_query}"}
                    ],
                    temperature=0.2,
                    max_tokens=3000,
                    timeout=30.0,
                )
                raw = comp.choices[0].message.content.strip()
                print(f"📝 Raw coding response received: {len(raw)} chars")
                
                # Extract JSON
                raw = re.sub(r'^```[a-zA-Z]*\n?','',raw).rstrip("`").strip()
                start=raw.find('{'); end=raw.rfind('}')
                if start!=-1 and end!=-1:
                    raw = raw[start:end+1]
                response_data = json.loads(raw)
                print(f"✅ JSON parsed successfully")
                
                # Format HTML
                formatted = format_coding_response(
                    code=response_data.get('code',''),
                    explanation=response_data.get('explanation',''),
                    output=response_data.get('output',''),
                    language=response_data.get('language',coding_lang)
                )
                # Stream the formatted HTML as tokens (split into chunks for smooth streaming)
                chunk_size = 100  # characters per chunk
                for i in range(0, len(formatted), chunk_size):
                    yield f"data: {json.dumps({'type':'token','content':formatted[i:i+chunk_size]})}\n\n"
                yield f"data: {json.dumps({'type':'done'})}\n\n"
                
            except json.JSONDecodeError as e:
                print(f"⚠️ JSON decode error: {e}")
                print(f"Raw response: {raw[:500]}")
                yield f"data: {json.dumps({'type':'error','message':'Failed to parse coding response'})}\n\n"
                yield f"data: {json.dumps({'type':'done'})}\n\n"
            except Exception as e:
                import traceback
                error_trace = traceback.format_exc()
                print(f"⚠️ Coding stream error: {e}")
                print(error_trace)
                yield f"data: {json.dumps({'type':'error','message':str(e)})}\n\n"
                yield f"data: {json.dumps({'type':'done'})}\n\n"
        
        return StreamingResponse(sync_coding_stream_gen(),media_type="text/event-stream",
                                headers={"Cache-Control":"no-cache","X-Accel-Buffering":"no","Connection":"keep-alive"})
    # ============================================
    # === END: CODING QUESTION CHECK (STREAM) ===
    # ============================================
    
    is_multiple_questions = detect_multiple_questions(latest_user_msg)
    marks_extracted, points_extracted = extract_marks_and_points_flexible(msg_lower)
    current_questions = extract_questions_comprehensive(latest_user_msg)
    should_use_multi_with_points = (is_multiple_questions and marks_extracted is not None and len(current_questions) >= 2)
    should_use_multi_no_points = (is_multiple_questions and marks_extracted is None and len(current_questions) >= 2)
    is_default_mode = not should_use_multi_with_points and not should_use_multi_no_points
    print(f"📊 Streaming Mode: multi_with_points={should_use_multi_with_points}, multi_no_points={should_use_multi_no_points}, default={is_default_mode}")
    skip_image = any(kw in english_query.lower() for kw in ['who','person','famous','actor','actress','singer','politician','celebrity'])
    if should_use_multi_with_points or should_use_multi_no_points:
        skip_image = True
        print(f"🚫 Streaming: Multiple questions - skipping images")
    else:
        print(f"✅ Streaming: Default mode - images allowed")
    length_constraint = extract_length_constraint(msg_lower)
    page_match=PAGE_PATTERN.search(msg_lower); mark_match=MARK_PATTERN.search(msg_lower)
    current_mode,current_point_count=detect_mode_from_message(msg_lower)
    if should_use_multi_with_points:
        calculated_points = calculate_points_from_marks(marks_extracted, points_extracted)
        questions_text = "\n---\n".join([f"QUESTION {i+1}: {q}" for i,q in enumerate(current_questions)])
        system_prompt = f"""You are NexusAI. Answer in {LANG_NAME_MAP.get(detected_lang, 'English')}.
MULTIPLE QUESTIONS MODE: Answer EACH question with EXACTLY {calculated_points} points.
Each point = 1 sentence. NO diagrams, NO images."""
        llm_messages=[{"role":"system","content":system_prompt},{"role":"user","content":
                     f"CRITICAL: Answer ALL {len(current_questions)} questions.\nEach question needs {calculated_points} points.\n"
                     f"Format: QUESTION 1:\n1. [point]\n2. [point]\n...\nQuestions:\n{questions_text}"}]
    elif should_use_multi_no_points:
        questions_text = "\n---\n".join([f"QUESTION {i+1}: {q}" for i,q in enumerate(current_questions)])
        system_prompt = f"""You are NexusAI. Answer in {LANG_NAME_MAP.get(detected_lang, 'English')}.
MULTIPLE QUESTIONS MODE: Answer each with a paragraph. NO diagrams, NO images."""
        llm_messages=[{"role":"system","content":system_prompt},{"role":"user","content":
                     f"CRITICAL: Answer ALL {len(current_questions)} questions with paragraphs.\n"
                     f"Format: QUESTION 1:\n[Paragraph]\nQuestions:\n{questions_text}"}]
    else:
        system_prompt,max_tok=build_system_prompt(current_mode,current_point_count,user_context,detected_lang,headings,
                                                  page_match,mark_match, length_constraint=length_constraint,
                                                  multiple_questions=False, marks_for_multi=None, points_for_multi=None)
        llm_messages=[{"role":"system","content":system_prompt},{"role":"user","content":english_query}]
    def sync_stream_gen():
        svg_future = None
        if not skip_image and len(english_query)>=2 and not is_coding:
            svg_future = _executor.submit(get_image_for_topic, english_query)
        with _file_context_lock:
            fname = _file_context.get("filename")
            processing = _file_context.get("processing")
            ready = _file_context.get("ready")
            ftext = _file_context.get("text")
            if fname:
                if processing:
                    _indexing_html=('<div style="background:rgba(99,102,241,0.12);border-left:4px solid #6366f1;'
                                   'padding:8px 14px;margin-bottom:14px;border-radius:4px;color:#a5b4fc;font-size:13px;">'
                                   f'⏳ Still indexing <strong>{fname}</strong> — answering from general knowledge.</div>')
                    yield f"data: {json.dumps({'type':'prefix','content':_indexing_html})}\n\n"
                elif ready and ftext:
                    file_answer=answer_from_file_context(english_query,ftext,fname)
                    if file_answer:
                        badge=('<div style="background:rgba(0,180,100,0.15);border-left:4px solid #00b464;'
                              'padding:8px 14px;margin-bottom:14px;border-radius:4px;color:#7fffb8;font-size:13px;">'
                              f'📄 Answer sourced from: <strong>{fname}</strong></div>')
                        yield f"data: {json.dumps({'type':'prefix','content':badge})}\n\n"
                        yield f"data: {json.dumps({'type':'token','content':file_answer})}\n\n"
                        yield f"data: {json.dumps({'type':'done'})}\n\n"
                        return
                    else:
                        _notfound_html=('<div style="background:rgba(255,160,0,0.12);border-left:4px solid #ffa000;'
                                       'padding:8px 14px;margin-bottom:14px;border-radius:4px;color:#ffd580;font-size:13px;">'
                                       f'⚠️ Not found in uploaded file ({fname}). Here is the answer from my knowledge:</div>')
                        yield f"data: {json.dumps({'type':'prefix','content':_notfound_html})}\n\n"
        yield f"data: {json.dumps({'type':'start'})}\n\n"
        try:
            stream=get_groq_client().chat.completions.create(
                model="openai/gpt-oss-20b",
                messages=llm_messages,
                stream=True,
                temperature=0.25,
                max_tokens=16000,
                top_p=0.92,
                timeout=30.0
            )
            for chunk in stream:
                delta=chunk.choices[0].delta.content
                if delta:
                    yield f"data: {json.dumps({'type':'token','content':delta})}\n\n"
        except Exception as e:
            err=str(e)
            if '429' in err or 'rate_limit' in err.lower():
                try:
                    stream2=get_groq_client().chat.completions.create(
                        model="openai/gpt-oss-safeguard-20b",
                        messages=llm_messages,
                        stream=True,
                        temperature=0.25,
                        max_tokens=16000,
                        top_p=0.92,
                        timeout=30.0
                    )
                    for chunk in stream2:
                        delta=chunk.choices[0].delta.content
                        if delta:
                            yield f"data: {json.dumps({'type':'token','content':delta})}\n\n"
                except Exception:
                    yield f"data: {json.dumps({'type':'error','message':'Failed to generate response'})}\n\n"
            else:
                yield f"data: {json.dumps({'type':'error','message':'Failed to generate response'})}\n\n"
        if svg_future:
            try:
                image_url=svg_future.result(timeout=25)
                if image_url:
                    yield f"data: {json.dumps({'type':'image','url':image_url})}\n\n"
            except Exception:
                pass
        yield f"data: {json.dumps({'type':'done'})}\n\n"
    return StreamingResponse(sync_stream_gen(),media_type="text/event-stream",
                            headers={"Cache-Control":"no-cache","X-Accel-Buffering":"no","Connection":"keep-alive"})

# ============================================
# === QUIZ GENERATE & EVALUATE ENDPOINTS ===
# ============================================
@app.post("/api/quiz/generate")
async def quiz_generate(request: QuizGenerateRequest):
    is_mcq = request.marks_per_question == 1
    loop = asyncio.get_event_loop()
    
    use_file_content = request.use_file_context
    file_content = ""
    filename = ""
    if use_file_content:
        with _file_context_lock:
            ready = _file_context.get("ready", False)
            processing = _file_context.get("processing", False)
            raw_content = _file_context.get("text", "")
            filename = _file_context.get("filename", "uploaded file")
            if not ready:
                if processing:
                    raise HTTPException(
                        status_code=409,
                        detail="File is still processing. Please wait a moment and try again."
                    )
                else:
                    # File not ready and not processing (maybe error)
                    raise HTTPException(
                        status_code=400,
                        detail="No file content available. Please upload a file first or disable 'Use File Context'."
                    )
            if raw_content:
                file_content = clean_pdf_content_for_quiz(raw_content)
                if not file_content:
                    # Content empty after cleaning
                    raise HTTPException(
                        status_code=400,
                        detail="File content is empty. Could not extract text from the file."
                    )
            else:
                # Ready but no text
                raise HTTPException(
                    status_code=400,
                    detail="File content is empty. Could not extract text from the file."
                )
    
    def _run_quiz():
        if is_mcq:
            if use_file_content and file_content:
                mcq_system = (
                    "You are a university exam MCQ generator. "
                    "Generate multiple-choice questions BASED ON THE PROVIDED FILE CONTENT. "
                    "Generate multiple-choice questions with 4 REAL, TOPIC-SPECIFIC answer options. "
                    "NEVER write 'Option 1', 'Option A', 'True', 'False', or any generic placeholder. "
                    "Every option must be a concrete fact or term directly related to the topic. "
                    "Exactly one option must be correct. "
                    "Return ONLY a raw JSON array — no markdown, no backticks, no explanation. "
                    "Each item: id (string), question (string), "
                    "options (array of exactly 4 strings prefixed A) B) C) D)), "
                    "correct_option (string), max_marks (int always 1), "
                    "expected_keywords (array of 3-5 keywords from the answer for grading)."
                )
                mcq_user = (
                    f"FILE: {filename}\nCONTENT:\n{file_content[:30000]}\n---\n"
                    f"Topic: {request.topic}\nCount: {request.num_questions}\nDifficulty: {request.difficulty}\n"
                    f"Generate {request.num_questions} MCQ questions about '{request.topic}' BASED ON THE FILE CONTENT ABOVE. "
                    f"All 4 options must be specific facts/terms about the topic — never generic.\n"
                    f"Example for 'Python':\n"
                    f'[{{"id":"q1","question":"Which keyword defines a function in Python?",'
                    f'"options":["A) func","B) def","C) define","D) function"],'
                    f'"correct_option":"B) def","max_marks":1,"expected_keywords":["def","function","define"]}}]\n'
                    f"Generate {request.num_questions} questions about '{request.topic}'. Start with ["
                )
            else:
                mcq_system = (
                    "You are a university exam MCQ generator. "
                    "Generate multiple-choice questions with 4 REAL, TOPIC-SPECIFIC answer options. "
                    "NEVER write 'Option 1', 'Option A', 'True', 'False', or any generic placeholder. "
                    "Every option must be a concrete fact or term directly related to the topic. "
                    "Exactly one option must be correct. "
                    "Return ONLY a raw JSON array — no markdown, no backticks, no explanation. "
                    "Each item: id (string), question (string), "
                    "options (array of exactly 4 strings prefixed A) B) C) D)), "
                    "correct_option (string), max_marks (int always 1), "
                    "expected_keywords (array of 3-5 keywords from the answer for grading)."
                )
                mcq_user = (
                    f"Topic: {request.topic}\nCount: {request.num_questions}\nDifficulty: {request.difficulty}\n"
                    f"Generate {request.num_questions} MCQ questions about '{request.topic}'. "
                    f"All 4 options must be specific facts/terms about the topic — never generic.\n"
                    f"Example for 'Python':\n"
                    f'[{{"id":"q1","question":"Which keyword defines a function in Python?",'
                    f'"options":["A) func","B) def","C) define","D) function"],'
                    f'"correct_option":"B) def","max_marks":1,"expected_keywords":["def","function","define"]}}]\n'
                    f"Generate {request.num_questions} questions about '{request.topic}'. Start with ["
                )
            
            bad_patterns = ["option 1","option 2","option 3","option 4","option a","option b","option c","option d","placeholder"]
            
            def validate_mcq(questions: list) -> list:
                prefixes = ["A) ","B) ","C) ","D) "]
                valid = []
                for q in questions:
                    opts = q.get("options", [])
                    if len(opts) != 4: continue
                    if any(any(b in str(o).lower() for b in bad_patterns) for o in opts): continue
                    prefixed = []
                    for i, opt in enumerate(opts[:4]):
                        s = str(opt).strip()
                        if not s.upper().startswith(prefixes[i]):
                            s = prefixes[i] + s.lstrip("ABCDabcd) ").strip()
                        prefixed.append(s)
                    q["options"] = prefixed
                    q["max_marks"] = 1
                    if "expected_keywords" not in q or not q["expected_keywords"]:
                        q["expected_keywords"] = []
                    valid.append(q)
                return valid
            
            for attempt in range(2):
                try:
                    comp = get_groq_client().chat.completions.create(
                        model="openai/gpt-oss-safeguard-20b",
                        messages=[{"role":"system","content":mcq_system},{"role":"user","content":mcq_user}],
                        temperature=0.3 if attempt==0 else 0.15,
                        max_tokens=2500,
                        timeout=30.0,
                    )
                    raw = comp.choices[0].message.content.strip()
                    
                    if not raw or not raw.strip():
                        print(f"⚠ MCQ attempt {attempt+1}: empty response")
                        continue
                    
                    raw = re.sub(r"^```[a-zA-Z]*\n?","",raw).rstrip("`").strip()
                    start=raw.find('['); end=raw.rfind(']')
                    if start==-1 or end==-1:
                        print(f"⚠ MCQ attempt {attempt+1}: no JSON array found")
                        continue
                    parsed = json.loads(raw[start:end+1])
                    validated = validate_mcq(parsed)
                    if validated:
                        print(f"✅ MCQ: {len(validated)} valid questions for '{request.topic}'")
                        return {"questions": validated}
                    print(f"⚠ MCQ attempt {attempt+1}: no valid options, retrying...")
                except json.JSONDecodeError as e:
                    print(f"⚠ MCQ attempt {attempt+1}: JSON decode error - {e}")
                    continue
                except Exception as e:
                    print(f"⚠ MCQ attempt {attempt+1}: error - {e}")
                    continue
            raise HTTPException(status_code=500, detail="Could not generate valid MCQ options. Please try again.")
        
        else:
            if use_file_content and file_content:
                system_prompt = (
                    "You are a university exam paper setter. "
                    "Generate REAL, SPECIFIC exam questions BASED ON THE PROVIDED FILE CONTENT. "
                    "Generate REAL, SPECIFIC exam questions — never placeholder text like "
                    "'Question 1', 'Maths question 1', or any generic filler. "
                    "Each question must be a complete, answerable question directly about the topic given. "
                    "Respond ONLY with a valid JSON array, no markdown, no extra text. "
                    "Each object must have: id (string like 'q1'), question (string), max_marks (int), "
                    "expected_keywords (array of 3-5 keywords from the expected answer for grading)."
                )
                user_prompt = (
                    f"FILE: {filename}\nCONTENT:\n{file_content[:30000]}\n---\n"
                    f"Topic: {request.topic}\nNumber of questions: {request.num_questions}\n"
                    f"Marks per question: {request.marks_per_question}\nDifficulty: {request.difficulty}\n"
                    f"Write {request.num_questions} REAL, SPECIFIC exam questions about '{request.topic}' BASED ON THE FILE CONTENT ABOVE. "
                    f"Every question must be directly about '{request.topic}'. "
                    f"For {request.marks_per_question}-mark questions: define/state/list/give one example. "
                    f"Each question is worth exactly {request.marks_per_question} marks. "
                    f"Return ONLY a valid JSON array like: "
                    f'[{{"id":"q1","question":"Define X and state its formula.","max_marks":{request.marks_per_question},"expected_keywords":["X","formula","define"]}}]\n'
                    f"Start with ["
                )
            else:
                system_prompt = (
                    "You are a university exam paper setter. "
                    "Generate REAL, SPECIFIC exam questions — never placeholder text like "
                    "'Question 1', 'Maths question 1', or any generic filler. "
                    "Each question must be a complete, answerable question directly about the topic given. "
                    "Respond ONLY with a valid JSON array, no markdown, no extra text. "
                    "Each object must have: id (string like 'q1'), question (string), max_marks (int), "
                    "expected_keywords (array of 3-5 keywords from the expected answer for grading)."
                )
                user_prompt = (
                    f"Topic: {request.topic}\nNumber of questions: {request.num_questions}\n"
                    f"Marks per question: {request.marks_per_question}\nDifficulty: {request.difficulty}\n"
                    f"Write {request.num_questions} REAL, SPECIFIC exam questions about '{request.topic}'. "
                    f"Every question must be directly about '{request.topic}'. "
                    f"For {request.marks_per_question}-mark questions: define/state/list/give one example. "
                    f"Each question is worth exactly {request.marks_per_question} marks. "
                    f"Return ONLY a valid JSON array like: "
                    f'[{{"id":"q1","question":"Define X and state its formula.","max_marks":{request.marks_per_question},"expected_keywords":["X","formula","define"]}}]\n'
                    f"Start with ["
                )
            
            for attempt in range(2):
                try:
                    raw = chat_completion(
                        messages=[{"role":"system","content":system_prompt},{"role":"user","content":user_prompt}],
                        temperature=0.4 if attempt==0 else 0.2,
                        max_tokens=1500,
                        timeout=30.0,
                    )
                    
                    if not raw or not raw.strip():
                        print(f"⚠ Quiz attempt {attempt+1}: empty response")
                        continue
                    
                    raw = re.sub(r"^```[a-z]*\n?","",raw).rstrip("`").strip()
                    
                    start = raw.find('[')
                    end = raw.rfind(']')
                    if start == -1 or end == -1:
                        print(f"⚠ Quiz attempt {attempt+1}: no JSON array found in response")
                        print(f"Response preview: {raw[:200]}")
                        continue
                    
                    json_str = raw[start:end+1]
                    questions = json.loads(json_str)
                    
                    if not questions or not isinstance(questions, list):
                        print(f"⚠ Quiz attempt {attempt+1}: invalid JSON structure")
                        continue
                    
                    placeholder_patterns = ["question 1","question 2","question 3",f"{request.topic.lower()} question","placeholder","sample question"]
                    valid_questions = []
                    for q in questions:
                        if any(p in q.get("question","").lower() for p in placeholder_patterns):
                            continue
                        if "expected_keywords" not in q or not q["expected_keywords"]:
                            q["expected_keywords"] = []
                        valid_questions.append(q)
                    
                    if valid_questions:
                        print(f"✅ Quiz: {len(valid_questions)} valid questions for '{request.topic}'")
                        return {"questions": valid_questions}
                    
                    print(f"⚠ Quiz attempt {attempt+1}: all questions filtered out")
                    
                except json.JSONDecodeError as e:
                    print(f"⚠ Quiz attempt {attempt+1}: JSON decode error - {e}")
                    print(f"Response: {raw[:500]}")
                    continue
                except Exception as e:
                    print(f"⚠ Quiz attempt {attempt+1}: error - {e}")
                    continue
            
            raise HTTPException(status_code=500, detail="Could not generate valid quiz questions. Please try again.")
    
    try:
        result = await asyncio.wait_for(loop.run_in_executor(_executor, _run_quiz), timeout=35.0)
        return result
    except HTTPException:
        raise
    except Exception as e:
        import traceback; print(traceback.format_exc())
        raise HTTPException(status_code=500, detail="Failed to generate quiz questions.")

@app.post("/api/quiz/evaluate")
async def quiz_evaluate(request: QuizEvaluateRequest):
    try:
        loop = asyncio.get_event_loop()
        def _run_eval():
            question_keyword_info = []
            for a in request.answers:
                keywords = a.expected_keywords if a.expected_keywords else []
                keyword_str = ", ".join(keywords) if keywords else "none specified"
                question_keyword_info.append(
                    f"Question ID: {a.question_id}\n"
                    f"Question: {a.question}\n"
                    f"Max marks: {a.max_marks}\n"
                    f"Student answer: {a.student_answer or '[No answer]'}\n"
                    f"Expected keywords for THIS question: {keyword_str}\n"
                    f"Grade based on: Check if student answer contains the expected keywords for this specific question. "
                    f"Award proportional marks based on keyword coverage."
                )
            items_text = "\n---\n".join(question_keyword_info)
            system_prompt = (
                "You are a strict but fair university examiner. "
                "Award marks honestly. NEVER exceed max_marks for any question. "
                "IMPORTANT: Each question has its OWN specific expected keywords. "
                "Check the expected keywords listed for EACH question individually. "
                "Do NOT use the same keywords for all questions. "
                "Respond ONLY with a valid JSON array. "
                "Each object: question_id, awarded_marks (int 0..max_marks), feedback (1-2 sentences)."
            )
            user_prompt=(f"Evaluate these answers with per-question keyword matching:\n{items_text}\n"
                        f'Return ONLY JSON like: [{{"question_id":"q1","awarded_marks":2,"feedback":"Good answer with key terms."}}]')
            raw = chat_completion(
                messages=[{"role":"system","content":system_prompt},{"role":"user","content":user_prompt}],
                temperature=0.1, max_tokens=2000, timeout=30.0
            )
            raw=re.sub(r"^```[a-z]*\n?","",raw).rstrip("`").strip()
            evaluations=json.loads(raw)
            max_marks_map={a.question_id:a.max_marks for a in request.answers}
            for ev in evaluations:
                cap=max_marks_map.get(ev["question_id"],0)
                ev["awarded_marks"]=max(0,min(int(ev["awarded_marks"]),cap))
                ev["max_marks"]=cap
            return {"evaluations":evaluations,"total_awarded":sum(ev["awarded_marks"] for ev in evaluations),"total_possible":sum(a.max_marks for a in request.answers)}
        result = await asyncio.wait_for(loop.run_in_executor(_executor, _run_eval), timeout=35.0)
        return result
    except Exception as e:
        import traceback; print(traceback.format_exc())
        raise HTTPException(status_code=500,detail="Failed to evaluate answers.")

# ============================================
# === ROADMAP ENDPOINT ===
# ============================================
_RESOURCE_SITES = [
    ("W3Schools",      "w3schools.com",        "https://www.w3schools.com/",                            "tutorial"),
    ("GeeksforGeeks",  "geeksforgeeks.org",     "https://www.geeksforgeeks.org/",                        "article"),
    ("FreeCodeCamp",   "freecodecamp.org",      "https://www.freecodecamp.org/news/",                    "tutorial"),
    ("MDN Web Docs",   "developer.mozilla.org", "https://developer.mozilla.org/en-US/search?q=",         "docs"),
    ("TutorialsPoint", "tutorialspoint.com",    "https://www.tutorialspoint.com/",                       "tutorial"),
    ("YouTube",        None,                    "https://www.youtube.com/results?search_query=",         "video"),
    ("Khan Academy",   None,                    "https://www.khanacademy.org/search?page_search_query=", "video"),
    ("Codecademy",     "codecademy.com",        "https://www.codecademy.com/search?query=",              "tutorial"),
    ("Real Python",    "realpython.com",        "https://realpython.com/search/results/?q=",             "tutorial"),
    ("Coursera",       None,                    "https://www.coursera.org/search?query=",                "tutorial"),
    ("edX",            None,                    "https://www.edx.org/search?q=",                         "tutorial"),
    ("Javatpoint",     "javatpoint.com",        "https://www.javatpoint.com/",                           "tutorial"),
    ("Programiz",      "programiz.com",         "https://www.programiz.com/search?q=",                   "tutorial"),
    ("Dev.to",         "dev.to",                "https://dev.to/search?q=",                              "article"),
    ("Stack Overflow", "stackoverflow.com",     "https://stackoverflow.com/search?q=",                   "docs"),
]

def _make_resource_url(site_domain, native_base, query):
    encoded = requests.utils.quote(query)
    if site_domain:
        return f"https://www.google.com/search?q={encoded}+site%3A{site_domain}"
    return native_base + encoded

def _fallback_resources(lesson_title: str, subject: str) -> list:
    query = f"{subject} {lesson_title}"
    return [{"title":f"{name} — {lesson_title}","url":_make_resource_url(domain,native,query),"type":rtype}
            for name,domain,native,rtype in _RESOURCE_SITES]

def _generate_roadmap_sync(subject: str) -> dict:
    system_prompt = (
        "You are a curriculum designer. Output ONLY a raw JSON array — "
        "no markdown, no backticks, no explanation.\n"
        "Exactly 6 lesson objects. Each lesson:\n"
        '  "title"     : short lesson name (5 words max)\n'
        '  "content"   : 1 short paragraph (3-4 sentences)\n'
        '  "resources" : array of exactly 5 objects, each: {"title","url","type"}\n'
        "resource type: one of article, video, docs, tutorial\n"
        "Use real URLs from: GeeksforGeeks, YouTube, W3Schools, MDN, FreeCodeCamp.\n"
        "Start immediately with [ — no preamble."
    )
    user_prompt = (
        f'Roadmap for "{subject}". 6 lessons beginner→advanced. '
        f'Each lesson: title, 1-paragraph content, 5 resources. Start with ['
    )
    try:
        raw = chat_completion(
            messages=[{"role":"system","content":system_prompt},{"role":"user","content":user_prompt}],
            temperature=0.15, max_tokens=1500, top_p=0.9, timeout=30.0,
        )
        raw   = re.sub(r'^```[a-zA-Z]*\s*','',raw.strip())
        raw   = re.sub(r'\s*```\s*$','',raw.strip())
        start = raw.find('['); end = raw.rfind(']')
        if start==-1 or end==-1: raise ValueError("No JSON array")
        lessons_raw = json.loads(raw[start:end+1])
        lessons_out = []
        for i,lesson in enumerate(lessons_raw[:8]):
            title   = lesson.get("title",    f"Lesson {i+1}")
            content = lesson.get("content",  "")
            llm_res = lesson.get("resources", [])
            cleaned = []
            for r in llm_res:
                url = str(r.get("url","")).strip()
                if url and url!="#" and url.startswith("http"):
                    cleaned.append({"title":str(r.get("title","Resource")),"url":url,
                                   "type":r.get("type","article") if r.get("type") in ("article","video","docs","tutorial") else "article"})
            if len(cleaned)<5:
                fallbacks = _fallback_resources(title,subject)
                existing  = {r["title"].split("—")[0].strip().lower() for r in cleaned}
                for fb in fallbacks:
                    if fb["title"].split("—")[0].strip().lower() not in existing:
                        cleaned.append(fb)
                    if len(cleaned)>=5: break
            lessons_out.append({"title":title,"content":content,"resources":cleaned[:5]})
        if not lessons_out: raise ValueError("No lessons parsed")
        print(f"✅ Roadmap: {len(lessons_out)} lessons for '{subject}'")
        return {"lessons":lessons_out}
    except Exception as e:
        print(f"⚠ Roadmap LLM failed: {e} — using fallback")
        generic = [
            ("Introduction & Basics",   f"Start with {subject}. Learn the foundational concepts and set up your environment."),
            ("Core Concepts",           f"Dive into the core building blocks of {subject}."),
            ("Hands-on Practice",       f"Apply theory with practical exercises in {subject}."),
            ("Intermediate Techniques", f"Level up with intermediate patterns and best practices in {subject}."),
            ("Real-world Projects",     f"Apply {subject} knowledge to real projects."),
            ("Advanced Topics",         f"Tackle advanced areas in {subject}."),
        ]
        return {"lessons":[{"title":t,"content":c,"resources":_fallback_resources(t,subject)[:5]} for t,c in generic]}

@app.post("/api/roadmap")
async def generate_roadmap(request: RoadmapRequest):
    subject = request.subject.strip()
    if not subject:
        raise HTTPException(status_code=400, detail="Subject is required.")
    loop   = asyncio.get_event_loop()
    result = await asyncio.wait_for(loop.run_in_executor(_executor, _generate_roadmap_sync, subject), timeout=35.0)
    return result

@app.on_event("shutdown")
async def shutdown_event():
    _executor.shutdown(wait=False)
    with _groq_client_lock:
        _groq_client_instances.clear()

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        app,
        host="0.0.0.0",
        port=8000,
        limit_concurrency=100,
        timeout_keep_alive=30,
    )