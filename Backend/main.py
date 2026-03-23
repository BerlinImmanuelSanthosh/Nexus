import os
import re
import io
import json
import asyncio
import base64
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

try:
    from googletrans import Translator
    TRANSLATOR_AVAILABLE = True
    print("✓ googletrans loaded successfully")
except ImportError:
    TRANSLATOR_AVAILABLE = False
    print("✗ googletrans not installed. Install with: pip install googletrans==4.0.0rc1")

try:
    import fitz  # PyMuPDF
    PYMUPDF_AVAILABLE = True
    print("✓ PyMuPDF loaded successfully")
except ImportError:
    PYMUPDF_AVAILABLE = False
    print("✗ PyMuPDF not installed. Install with: pip install pymupdf")

load_dotenv()
GROQ_API_KEY = os.getenv("GROQ_API_KEY")
if not GROQ_API_KEY:
    raise RuntimeError("Missing GROQ_API_KEY in .env")

GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY", "")
GOOGLE_CX      = os.getenv("GOOGLE_CX", "")

app = FastAPI(title="NexusAI Chatbot")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:8080", "http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

_file_context: dict = {
    "text":       "",
    "filename":   "",
    "type":       "",
    "processing": False,
    "ready":      False,
    "error":      "",
}
_executor = ThreadPoolExecutor(max_workers=4)


class ChatRequest(BaseModel):
    messages: List[dict]

class SimpleTeachRequest(BaseModel):
    topic: str
    language: str = "en"
    previous_response: str = ""

class ChildTeachRequest(BaseModel):
    topic: str
    language: str = "en"

_groq_client = None
def get_groq_client():
    global _groq_client
    if _groq_client is None:
        _groq_client = Groq(api_key=GROQ_API_KEY)
    return _groq_client

_PRIMARY_MODEL  = "openai/gpt-oss-20b"
_FALLBACK_MODEL = "openai/gpt-oss-120b"

def chat_completion(messages: list, temperature: float = 0.25,
                    max_tokens: int = 8000, top_p: float = 0.92) -> str:
    for model in [_PRIMARY_MODEL, _FALLBACK_MODEL]:
        try:
            comp = get_groq_client().chat.completions.create(
                model=model,
                messages=messages,
                temperature=temperature,
                max_tokens=max_tokens,
                top_p=top_p,
            )
            if model != _PRIMARY_MODEL:
                print(f"✅ Fallback model '{model}' succeeded")
            return comp.choices[0].message.content.strip()
        except Exception as e:
            err_str = str(e)
            is_rate_limit = '429' in err_str or 'rate_limit' in err_str.lower()
            is_too_large  = '413' in err_str or 'too large' in err_str.lower()
            if (is_rate_limit or is_too_large) and model == _PRIMARY_MODEL:
                print(f"⚠ Primary model rate-limited — switching to fallback")
                continue
            else:
                raise
    raise RuntimeError("Both primary and fallback models failed")


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
    text = re.sub(r'\n{3,}', '\n\n', text)
    text = re.sub(r'[ \t]+', ' ', text)
    return text.strip()


def extract_text_from_pdf_bytes(pdf_bytes: bytes) -> str:
    if not PYMUPDF_AVAILABLE:
        return ""
    try:
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        parts = [page.get_text() for page in doc]
        doc.close()
        return "\n".join(parts).strip()
    except Exception as e:
        print(f"⚠ PDF extraction error: {e}")
        return ""

def describe_image_with_groq(image_bytes: bytes, mime_type: str) -> str:
    try:
        b64 = base64.b64encode(image_bytes).decode("utf-8")
        comp = get_groq_client().chat.completions.create(
            model="openai/gpt-oss-120b",
            messages=[{
                "role": "user",
                "content": [
                    {"type": "image_url", "image_url": {"url": f"data:{mime_type};base64,{b64}"}},
                    {"type": "text", "text": (
                        "Describe this image in full detail. "
                        "Extract any visible text, labels, diagrams, tables, or data. "
                        "Be thorough so this description can be used to answer user questions."
                    )}
                ]
            }],
            temperature=0.1, max_tokens=1500,
        )
        return comp.choices[0].message.content.strip()
    except Exception as e:
        print(f"⚠ Image description error: {e}")
        return ""

def answer_from_file_context(user_question: str, file_text: str, filename: str) -> Optional[str]:
    if not file_text or len(file_text.strip()) < 20:
        return None
    trimmed = file_text[:6000]
    system_prompt = (
        "You are NexusAI File Analyst. "
        "Answer the user's question ONLY from the FILE CONTENT provided. "
        "If the answer is present, reply clearly and concisely. "
        "If the answer is NOT present in the file, reply with exactly: NOT_IN_FILE"
    )
    user_msg = f"FILE: {filename}\n\nFILE CONTENT:\n{trimmed}\n\nUSER QUESTION: {user_question}"
    try:
        answer = chat_completion(
            messages=[{"role": "system", "content": system_prompt}, {"role": "user", "content": user_msg}],
            temperature=0.1, max_tokens=800,
        )
        if answer.upper().startswith("NOT_IN_FILE"):
            return None
        return clean_llm_response(answer)
    except Exception as e:
        print(f"⚠ file-context answer error: {e}")
        return None


def _background_process_pdf(pdf_bytes: bytes, filename: str):
    global _file_context
    try:
        _file_context["processing"] = True
        _file_context["ready"]      = False
        _file_context["error"]      = ""
        extracted_text = extract_text_from_pdf_bytes(pdf_bytes)
        if not extracted_text:
            _file_context["error"]      = "Could not extract text from PDF."
            _file_context["processing"] = False
            return
        _file_context["text"]       = extracted_text
        _file_context["ready"]      = True
        _file_context["processing"] = False
        print(f"✅ Background PDF done: {len(extracted_text)} chars for '{filename}'")
    except Exception as e:
        import traceback; traceback.print_exc()
        _file_context["error"]      = str(e)
        _file_context["processing"] = False


@app.post("/api/upload-file")
async def upload_file(background_tasks: BackgroundTasks, file: UploadFile = File(...)):
    global _file_context
    try:
        content_type = file.content_type or ""
        filename     = file.filename or "uploaded_file"
        print(f"\n📁 Upload started: {filename} | content_type={content_type}")
        MAX_BYTES = 50 * 1024 * 1024
        chunks = []; total = 0
        while True:
            chunk = await file.read(1024 * 256)
            if not chunk: break
            total += len(chunk)
            if total > MAX_BYTES:
                raise HTTPException(status_code=413, detail="File too large. Maximum size is 50 MB.")
            chunks.append(chunk)
        file_bytes  = b"".join(chunks)
        print(f"📁 Upload received: {filename} ({len(file_bytes):,} bytes)")
        fname_lower = filename.lower()
        is_pdf   = ("pdf" in content_type) or fname_lower.endswith(".pdf")
        is_image = (content_type.startswith("image/")) or fname_lower.endswith((".png",".jpg",".jpeg",".gif",".webp",".bmp"))
        if is_pdf:
            _file_context.update({"text":"","filename":filename,"type":"pdf","processing":True,"ready":False,"error":""})
            background_tasks.add_task(_background_process_pdf, file_bytes, filename)
            return {"success":True,"filename":filename,"file_type":"pdf","processing":True,
                    "message":f"✅ '{filename}' received! Indexing in the background — you can start asking questions right away."}
        elif is_image:
            _file_context.update({"text":"","filename":filename,"type":"image","processing":True,"ready":False,"error":""})
            extracted_text = describe_image_with_groq(file_bytes, content_type or "image/png")
            if not extracted_text:
                return {"success":False,"message":"Could not analyse the image.","chars_extracted":0}
            _file_context.update({"text":extracted_text,"processing":False,"ready":True})
            preview = extracted_text[:200].replace("\n"," ")
            return {"success":True,"filename":filename,"file_type":"image","chars_extracted":len(extracted_text),
                    "preview":preview,"processing":False,"message":f"✅ Image '{filename}' analysed. Ask away!"}
        else:
            raise HTTPException(status_code=400, detail="Unsupported file type. Upload a PDF or image.")
    except HTTPException: raise
    except Exception as e:
        import traceback; print(traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"File processing failed: {str(e)}")


@app.get("/api/upload-status")
async def upload_status():
    return {"ready":_file_context.get("ready",False),"processing":_file_context.get("processing",False),
            "error":_file_context.get("error",""),"filename":_file_context.get("filename",""),
            "chars_extracted":len(_file_context.get("text",""))}

@app.post("/api/clear-file")
async def clear_file():
    global _file_context
    _file_context = {"text":"","filename":"","type":"","processing":False,"ready":False,"error":""}
    return {"success":True,"message":"File context cleared."}


# ════════════════════════════════════════════════════════════════════════════
#  SVG DIAGRAM GENERATION
# ════════════════════════════════════════════════════════════════════════════

_svg_cache: OrderedDict = OrderedDict()
_SVG_CACHE_MAX = 60

def _cache_svg(key: str, value: str):
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
    if cache_key in _svg_cache: return _svg_cache[cache_key], ""

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
9. Draw the REAL components of the topic — never a generic placeholder
DIAGRAM STYLES:
- Architecture / how X works → horizontal row of boxes with right-arrows
- Layered (OS, network, TCP/IP) → vertical stack of full-width rectangles
- Tree (BST, data structures) → circles with lines connecting parent to children
- Algorithm (sort, search) → flowchart: rectangles + diamond decision nodes + arrows
- Comparison (X vs Y) → two columns side by side
- Neural network → columns of circles (input → hidden → output) with connecting lines
- Any other topic → central box with satellite boxes connected by arrows"""

    user_prompt = f"""Generate SVG diagram for: "{user_message}"
Draw the ACTUAL, SPECIFIC diagram for this exact topic. Examples:
- "python" → pipeline: Source Code→Lexer→Parser→AST→Compiler→Bytecode→PVM
- "deep learning" → 3 columns: Input circles, Hidden circles, Output circles with lines
- "tcp/ip" → 4 stacked rectangles: Application / Transport / Internet / Network Access
- "binary search tree" → tree nodes with values and connections
- "bubble sort" → flowchart: array, compare adjacent, swap if needed, repeat
- "operating system" → layers: Hardware → Kernel → System Calls → User Applications
Now output ONLY the SVG for: "{user_message}"
Start immediately with <svg"""

    svg = _make_fallback_svg(user_message)
    try:
        print(f"🎨 Generating SVG for: '{user_message[:60]}'")
        comp = get_groq_client().chat.completions.create(
            model="openai/gpt-oss-120b",
            messages=[{"role":"system","content":svg_system},{"role":"user","content":user_prompt}],
            temperature=0.15, max_tokens=3000,
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

EXPLICIT_LANG_KEYWORDS = {
    'tamil':'ta','தமிழ்':'ta','hindi':'hi','हिंदी':'hi','telugu':'te','తెలుగు':'te',
    'malayalam':'ml','മലയാളം':'ml','kannada':'kn','ಕನ್ನಡ':'kn','bengali':'bn','বাংলা':'bn',
    'marathi':'mr','मराठी':'mr','gujarati':'gu','ગુજરાતી':'gu','punjabi':'pa','ਪੰਜਾਬੀ':'pa',
    'urdu':'ur','اردو':'ur','arabic':'ar','french':'fr','german':'de','spanish':'es',
    'italian':'it','portuguese':'pt','russian':'ru','chinese':'zh-CN','japanese':'ja',
    'korean':'ko','turkish':'tr','dutch':'nl',
}

MIXED_LANG_PATTERNS: List[Tuple] = [
    (re.compile(
        r'\b(sollu|solli|soll|kudu|sollikudu|sollunga|sollungo|solunga|solludu|'
        r'theriyuma|theriyum|puriyuma|puriyum|pannunga|pannu|panren|panna|'
        r'solren|solringa|kettukonga|ketukonga|solladhe|sollade|vaanga|vaangi|'
        r'da|di|bro|machan|machi|dei|solring|solraan|solraen|neenga|ungaluku|'
        r'enaku|enakku|athu|ithu|avanga|ivanga|avan|aval|correct ah|correct a|'
        r'seri|illa|illai|ama|aama|romba|nalla iruku|nalla irruku)\b',re.IGNORECASE),
     "Tanglish (Tamil-English mix — reply naturally in Tanglish, mixing Tamil words and English)","tanglish"),
    (re.compile(
        r'\b(bolna|bolo|bata|batao|bol|batadena|batade|bolrah|bolraha|bolrahe|'
        r'bolrahahu|kya hai|kaise|kyun|kyunki|matlab|samjha|samjhao|samjhado|'
        r'smjha|smjhao|yaar|yar|dost|bhai|bhen|acha|accha|theek|thik|sahi|'
        r'galat|nahi|nhi|mujhe|meko|mereko|hame|hamein|sikhao|sikha|padha|'
        r'padhao|bata dena|bata do)\b',re.IGNORECASE),
     "Hinglish (Hindi-English mix — reply naturally in Hinglish, mixing Hindi words and English)","hinglish"),
    (re.compile(
        r'\b(para|parayan|paranjaal|enthaa|enthu|enthanu|ningal|njan|njaan|onnum|onum|ille|illel|alle|allel)\b',
        re.IGNORECASE),
     "Manglish (Malayalam-English mix — reply naturally in Manglish)","manglish"),
    (re.compile(
        r'\b(heli|helri|heltheera|heltheeni|hegide|yaake|yaaru|enu|yenu|illi|alli|gottilla|gottillva|gottu|nodri|nodi)\b',
        re.IGNORECASE),
     "Kanglish (Kannada-English mix — reply naturally in Kanglish)","kanglish"),
]
_ALL_MIXED_TRIGGERS = re.compile(
    r'\b(sollu|solli|soll|kudu|sollikudu|sollunga|da|di|bro|machan|machi|'
    r'bolna|bolo|bata|batao|bol|bolrah|bolraha|bolrahe|bolrahahu|kya|kaise|kyun|'
    r'samjhao|samjhado|yaar|yar|dost|bhai|sikhao|sikha|padha|padhao|mujhe|meko|mereko|'
    r'para|parayan|heli|helri|nodri|nodi|solring|solraan|solraen|romba|nalla|seri|illa|ama|'
    r'theriyuma|theriyum|puriyuma|puriyum|pannunga|pannu|neenga|athu|ithu|avan|aval|avanga|ivanga)\b',
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

def process_user_input(text: str) -> tuple:
    mixed = detect_mixed_language(text)
    if mixed:
        lang_label,lang_code = mixed
        core_topic = extract_core_topic_from_mixed(text)
        print(f"🌐 Mixed '{lang_code}': '{text}' → core='{core_topic}'")
        return core_topic,lang_label
    lang_code = detect_language(text)
    if lang_code != 'en' and TRANSLATOR_AVAILABLE:
        try:
            translator = Translator()
            translated = translator.translate(text, src=lang_code, dest='en')
            if translated and translated.text:
                english_query = translated.text.strip()
                print(f"🌐 Native script → '{english_query}'")
                return english_query, lang_code
        except Exception as e:
            print(f"⚠ Translation error: {e}")
        return text, lang_code
    text_lower = text.lower()
    for keyword,code in EXPLICIT_LANG_KEYWORDS.items():
        if keyword in text_lower: return text,code
    return text,'en'

def build_language_instruction(detected_lang: str) -> str:
    if len(detected_lang) > 10: return f"Respond in {detected_lang}."
    return f"Respond in {LANG_NAME_MAP.get(detected_lang.lower(),'English')} language."

def translate_headings(lang_code: str) -> dict:
    fallback = {'intro':'INTRODUCTION','concepts':'CORE CONCEPTS','fundamental':'FUNDAMENTAL CONCEPTS',
                'detailed':'DETAILED EXPLANATION','example':'EXAMPLE','examples':'REAL-WORLD EXAMPLES',
                'applications':'APPLICATIONS','advantages':'ADVANTAGES','limitations':'LIMITATIONS',
                'conclusion':'CONCLUSION','insights':'KEY INSIGHTS'}
    if lang_code in ('tanglish','hinglish','manglish','kanglish','en') or not TRANSLATOR_AVAILABLE:
        return fallback
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

def get_section_headings(lang_code: str) -> dict:
    return translate_headings(lang_code)


GREETING_PATTERN    = re.compile(r'^\s*(hello|hi|hey|greetings|good morning|good afternoon|good evening|what\'s up|howdy|hiya)\b',re.IGNORECASE)
PAGE_PATTERN        = re.compile(r'(\d+)\s*pages?\b',re.IGNORECASE)
MARK_PATTERN        = re.compile(r'(\d+)\s*(?:mark|marks)\b',re.IGNORECASE)
POINT_PATTERN       = re.compile(r'(\d+)\s*(?:point|points)\b',re.IGNORECASE)
GIVE_POINTS_PATTERN = re.compile(r'give\s+(\d+)\s+points?\b',re.IGNORECASE)
NOTES_PATTERN       = re.compile(r'\bnotes?\b|\bsummary\b|\bsummaries\b|\boverview\b',re.IGNORECASE)

@lru_cache(maxsize=128)
def is_greeting_cached(msg: str) -> bool: return bool(GREETING_PATTERN.search(msg))
def is_greeting(msg: str) -> bool: return is_greeting_cached(msg.strip())

@lru_cache(maxsize=64)
def extract_questions_comprehensive_cached(text: str) -> tuple:
    questions,seen,unique=[],set(),[]
    for line in text.split('\n'):
        line=line.strip()
        if not line or len(line)>200: continue
        if (line.lower() in ['introduction','key features','applications','conclusion','references']
                and not any(w in line.lower() for w in ['define','what','list','explain','state','name'])): continue
        if not re.match(r'^\d+\.',line) and any(w in line.lower() for w in ['define','what','list','explain','state','name']):
            if 10<len(line)<150: questions.append(line if line.endswith('?') else line+'?')
        elif re.match(r'^\d+\.',line):
            q=re.sub(r'^\d+\.\s*','',line)
            if q and 5<len(q)<150:
                if not q.endswith('?'):
                    q=q+'?' if any(w in q.lower() for w in ['define','list','what','explain','state','name']) else f"What is {q}?"
                questions.append(q)
    for q in questions:
        k=re.sub(r'[^\w\s]','',q.lower())
        if k not in seen: unique.append(q);seen.add(k)
    return tuple(unique)

def extract_questions_comprehensive(text: str) -> list:
    return list(extract_questions_comprehensive_cached(text))

def get_recent_messages_fast(messages: List[dict], max_messages: int = 6) -> List[dict]:
    if len(messages)<=max_messages: return messages
    recent=messages[-max_messages:]
    if recent[0]["role"]!="user" and messages[-1]["role"]=="user":
        for i in range(len(messages)-2,-1,-1):
            if messages[i]["role"]=="user":
                recent=messages[i:]
                if len(recent)>max_messages: recent=recent[:max_messages]
                break
    return recent

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

# ── FIX: All token limits raised to 8000 to prevent mid-sentence cutoff ──
def build_system_prompt(mode,point_count,user_context,detected_lang,headings,page_match=None,mark_match=None) -> Tuple[str,int]:
    lang_instr=build_language_instruction(detected_lang)
    if page_match:
        pages=int(page_match.group(1)); wc=calculate_word_count_from_pages(pages)
        return (f"You are NexusAI, a university-level academic tutor.\n{user_context}\n\nProvide a comprehensive ~{wc}-word explanation.\n"
                "STRUCTURE: INTRODUCTION, CORE CONCEPTS, CONCRETE EXAMPLE, TECHNICAL DETAILS, REAL-WORLD APPLICATIONS, CHALLENGES/TRADE-OFFS, CONCLUSION.\n"
                f"Use clear section headings (no ## symbols, no ALL-CAPS). {lang_instr} NO schedule.", min(wc*2,8000))
    if mark_match:
        marks=int(mark_match.group(1)); wc=calculate_word_count_from_marks(marks)
        return (f"You are NexusAI.\n{user_context}\n\nAnswer this {marks}-mark question as a continuous ~{wc}-word essay.\n"
                "Cover: Introduction, Motivation, Components, Working, Features, Advantages, Limitations, Applications, Conclusion.\n"
                f"Continuous essay, NOT Q&A. Clear headings (no ## symbols). {lang_instr} NO schedule.", min(wc*2,8000))
    if mode=="notes":
        return (f"You are NexusAI, an expert academic note-maker.\n{user_context}\n\nGenerate comprehensive structured NOTES on the topic.\n"
                f"Use numbered points and sub-points. Short crisp sentences. Include: Definition, Key Concepts, Types, Working, Advantages, Disadvantages, Applications.\n"
                f"{lang_instr} NO schedule. NO ## symbols.", 8000)  # ← was 6000
    if mode=="detailed_no_schedule":
        return (f"You are NexusAI, a university-level academic expert.\n{user_context}\n\nProvide a COMPREHENSIVE 2000-word explanation.\n{lang_instr}\n"
                f"Use clear section headings (no ## symbols, no ALL-CAPS):\n"
                f"  {headings['intro']}, {headings['fundamental']}, {headings['detailed']},\n"
                f"  {headings['examples']}, {headings['applications']},\n"
                f"  {headings['advantages']}, {headings['limitations']}, {headings['conclusion']}\nNO timetable. NO image tags.", 8000)  # ← was 6000
    if mode=="teaching":
        return (f"You are NexusAI, a patient teacher.\n{user_context}\n\n{lang_instr} Simple language and analogies. NO ## symbols.", 4000)  # ← was 2000
    return (f"You are NexusAI.\n{user_context}\n\nProvide a detailed ~1500-word explanation of the topic.\n\n{lang_instr}\n\n"
            f"EXPLANATION STRUCTURE — clear section headings (no ## symbols, no ALL-CAPS):\n"
            f"  {headings['intro']}\n  {headings['concepts']}\n  {headings['example']}\n"
            f"  {headings['applications']}\n  {headings['insights']}\n\n"
            f"NO timetable. NO study schedule. NO markdown image tags.", 8000)  # ← was 4000

def process_detailed_response_without_schedule(user_message,messages):
    user_context=extract_user_context(user_message); msg_lower=user_message.lower()
    page_match=PAGE_PATTERN.search(msg_lower); mark_match=MARK_PATTERN.search(msg_lower)
    system_prompt,max_tok=build_system_prompt("pages_or_marks",0,user_context,"en",{},page_match,mark_match)
    recent=get_recent_messages_fast(messages,4)
    return clean_llm_response(chat_completion(
        messages=[{"role":"system","content":system_prompt}]+recent,temperature=0.2,max_tokens=max_tok,top_p=0.95))


@app.post("/api/teach-simple")
async def teach_simple(request: SimpleTeachRequest):
    try:
        topic=request.topic; language=request.language; previous_response=request.previous_response.strip()
        if previous_response:
            plain_prev=re.sub(r'<[^>]+>',' ',previous_response)[:3000].strip()
            system_prompt=(f"You are NexusAI. Rewrite the explanation about '{topic}' as a SHORT SIMPLE SUMMARY of 300-400 words.\n"
                           f"RULES: Clear section labels: WHAT IS IT / HOW IT WORKS / REAL EXAMPLE / WHY IT MATTERS. "
                           f"NO schedule. NO ## symbols. NO image tags. Respond in '{language}'.\n\nEXPLANATION:\n{plain_prev}")
            user_msg=f"Short simple version about {topic}."
        else:
            system_prompt=(f"You are NexusAI. Explain '{topic}' simply in 300-400 words.\n"
                           f"Clear section labels: WHAT IS IT / HOW IT WORKS / REAL EXAMPLE / WHY IT MATTERS. "
                           f"NO schedule. NO ## symbols. NO image tags. Respond in '{language}'.")
            user_msg=f"Explain {topic} simply in 300-400 words."
        response_text=clean_llm_response(chat_completion(
            messages=[{"role":"system","content":system_prompt},{"role":"user","content":user_msg}],temperature=0.3,max_tokens=2000,top_p=0.9))
        return {"response":f'<div style="white-space:pre-wrap;word-wrap:break-word;overflow-wrap:break-word;font-family:\'Segoe UI\',Arial,sans-serif;color:white;line-height:1.7;">{response_text}</div>'}
    except Exception as e:
        import traceback; print(traceback.format_exc())
        raise HTTPException(status_code=500,detail="An error occurred. Please try again.")


# ── FIX: explain-like-child — max_tokens raised, prompt forces all 7 paragraphs ──
@app.post("/api/explain-like-child")
async def explain_like_child(request: ChildTeachRequest):
    try:
        topic=request.topic; language=request.language
        def build_prompt(strict=False):
            base=(
                f"You are a friendly teacher explaining '{topic}' to a 5-year-old child.\n"
                f"Write EXACTLY 7 paragraphs. Each paragraph MUST be 4-5 simple sentences long.\n"
                f"Do NOT stop early. You MUST complete all 7 paragraphs fully before stopping.\n"
                f"Use simple everyday words only. Fun analogies with toys, food, or animals.\n"
                f"NO emoji anywhere in the response.\nNO bullet points. NO numbered lists. NO ## symbols.\n"
                f"NO HTML tags. NO markdown. NO title line. NO heading.\n"
                f"NO greeting opener like 'Sure!', 'Of course!', 'Great question!' etc.\n"
                f"Start your VERY FIRST word with the actual explanation — jump straight in.\n"
                f"Separate paragraphs with one blank line.\n"
                f"End the last paragraph with one fun fact about '{topic}'.\n"
                f"Plain text only. Language: {language}."
            )
            if strict: base+=f"\n\nCRITICAL: Begin explaining '{topic}' immediately with a real word. Write all 7 paragraphs without stopping."
            return base
        def strip_response(raw):
            plain=clean_to_plain_text(raw); lines=plain.splitlines()
            while lines and not any(c.isalpha() for c in lines[0]): lines.pop(0)
            return "\n".join(lines).strip()
        # ── FIX: max_tokens raised from 2000 → 3000 ──
        raw1=chat_completion(
            messages=[{"role":"system","content":build_prompt()},{"role":"user","content":f"Explain {topic} like I'm 5 years old! Write all 7 paragraphs completely."}],
            temperature=0.4, max_tokens=3000, top_p=0.9
        )
        plain=strip_response(raw1)
        if not plain or not any(c.isalpha() for c in plain):
            print(f"⚠ explain-like-child: empty after strip, retrying...")
            # ── FIX: retry max_tokens raised from 500 → 2500 ──
            raw2=chat_completion(
                messages=[{"role":"system","content":build_prompt(True)},{"role":"user","content":f"Explain {topic} to a young child in 7 paragraphs. Write all 7 fully."}],
                temperature=0.2, max_tokens=2500, top_p=0.85
            )
            plain=strip_response(raw2)
        if not plain or not any(c.isalpha() for c in plain):
            plain=(
                f"{topic} is something really interesting!\n\n"
                f"Think of it like a puzzle with lots of small pieces that fit together to make something big and useful.\n\n"
                f"People use {topic} every day to solve problems and make life easier.\n\n"
                f"Imagine you had a magic box that could do special things — that is a little bit like {topic}.\n\n"
                f"When you learn about {topic}, you start to understand how many things around you work.\n\n"
                f"Even grown-ups spend years learning about {topic} because there is always something new to discover.\n\n"
                f"Fun fact: {topic} is used in so many places that you probably see it every single day without even knowing it!"
            )
        return {"response": plain}
    except Exception as e:
        import traceback; print(traceback.format_exc())
        raise HTTPException(status_code=500,detail="An error occurred. Please try again.")


@app.post("/api/chat")
async def chat(request: ChatRequest):
    try:
        messages=request.messages
        if not messages: raise HTTPException(status_code=400,detail="No messages provided")
        latest_user_msg=messages[-1]["content"]
        english_query,detected_lang=process_user_input(latest_user_msg)
        if english_query!=latest_user_msg:
            messages=messages[:-1]+[{"role":"user","content":english_query}]
        msg_lower=english_query.lower(); headings=get_section_headings(detected_lang)
        if is_greeting(latest_user_msg):
            return {"response":"Hello! I'm NexusAI, your intelligent assistant. How can I help you today?"}
        user_context=extract_user_context(latest_user_msg)
        skip_image=any(kw in english_query.lower() for kw in ['who','person','famous','actor','actress','singer','politician','celebrity'])
        image_url=""
        if not skip_image and len(english_query)>=2: image_url=get_image_for_topic(english_query)
        file_prefix=""
        if _file_context.get("filename"):
            if _file_context.get("processing"):
                file_prefix=(f'<div style="background:rgba(99,102,241,0.12);border-left:4px solid #6366f1;padding:8px 14px;margin-bottom:14px;border-radius:4px;'
                             f'font-family:\'Segoe UI\',Arial,sans-serif;color:#a5b4fc;font-size:13px;">⏳ Still indexing <strong>{_file_context["filename"]}</strong> — answering from general knowledge for now.</div>')
            elif _file_context.get("ready") and _file_context["text"]:
                file_answer=answer_from_file_context(english_query,_file_context["text"],_file_context["filename"])
                if file_answer:
                    file_badge=(f'<div style="background:rgba(0,180,100,0.15);border-left:4px solid #00b464;padding:8px 14px;margin-bottom:14px;border-radius:4px;'
                                f'font-family:\'Segoe UI\',Arial,sans-serif;color:#7fffb8;font-size:13px;">📄 Answer sourced from: <strong>{_file_context["filename"]}</strong></div>')
                    return {"response":file_badge+f'<div style="white-space:pre-wrap;word-wrap:break-word;overflow-wrap:break-word;color:white;">{file_answer}</div>'}
                else:
                    file_prefix=(f'<div style="background:rgba(255,160,0,0.12);border-left:4px solid #ffa000;padding:8px 14px;margin-bottom:14px;border-radius:4px;'
                                 f'font-family:\'Segoe UI\',Arial,sans-serif;color:#ffd580;font-size:13px;">⚠️ Not found in uploaded file ({_file_context["filename"]}). Here is the answer from my knowledge:</div>')
        page_match=PAGE_PATTERN.search(msg_lower); mark_match=MARK_PATTERN.search(msg_lower)
        current_mode,current_point_count=detect_mode_from_message(msg_lower)
        system_prompt,max_tok=build_system_prompt(current_mode,current_point_count,user_context,detected_lang,headings,page_match,mark_match)
        if current_mode=="points":
            current_questions=extract_questions_comprehensive(latest_user_msg)
            if current_questions:
                questions_text="\n".join([f"{i+1}. {q}" for i,q in enumerate(current_questions)])
                response_text=clean_llm_response(chat_completion(
                    messages=[{"role":"system","content":system_prompt},{"role":"user","content":f"{current_point_count} points each:\n{questions_text}"}],temperature=0.1,max_tokens=4000,top_p=0.85))
                if image_url: return {"response":file_prefix+create_html_with_image(response_text,image_url,english_query)}
                return {"response":file_prefix+f'<div style="white-space:pre-wrap;word-wrap:break-word;overflow-wrap:break-word;color:white;">{response_text}</div>'}
        recent=get_recent_messages_fast(messages,6)
        response_text=clean_llm_response(chat_completion(messages=[{"role":"system","content":system_prompt}]+recent,temperature=0.25,max_tokens=max_tok,top_p=0.92))
        if image_url: return {"response":file_prefix+create_html_with_image(response_text,image_url,english_query)}
        return {"response":file_prefix+f'<div style="white-space:pre-wrap;word-wrap:break-word;overflow-wrap:break-word;color:white;">{response_text}</div>'}
    except Exception as e:
        import traceback; print(traceback.format_exc())
        raise HTTPException(status_code=500,detail="An error occurred. Please try again.")


@app.post("/api/chat/stream")
async def chat_stream(request: ChatRequest):
    messages=request.messages
    if not messages: raise HTTPException(status_code=400,detail="No messages provided")
    latest_user_msg=messages[-1]["content"]
    english_query,detected_lang=process_user_input(latest_user_msg)
    if english_query!=latest_user_msg:
        messages=messages[:-1]+[{"role":"user","content":english_query}]
    msg_lower=english_query.lower(); headings=get_section_headings(detected_lang)
    user_context=extract_user_context(latest_user_msg)
    if is_greeting(latest_user_msg):
        greeting="Hello! I'm NexusAI, your intelligent assistant. How can I help you today?"
        def greeting_gen():
            yield f"data: {json.dumps({'type':'token','content':greeting})}\n\n"
            yield f"data: {json.dumps({'type':'done'})}\n\n"
        return StreamingResponse(greeting_gen(),media_type="text/event-stream",headers={"Cache-Control":"no-cache","X-Accel-Buffering":"no"})
    page_match=PAGE_PATTERN.search(msg_lower); mark_match=MARK_PATTERN.search(msg_lower)
    current_mode,current_point_count=detect_mode_from_message(msg_lower)
    system_prompt,max_tok=build_system_prompt(current_mode,current_point_count,user_context,detected_lang,headings,page_match,mark_match)
    recent=get_recent_messages_fast(messages,6)
    llm_messages=[{"role":"system","content":system_prompt}]+recent
    if current_mode=="points":
        current_questions=extract_questions_comprehensive(latest_user_msg)
        if current_questions:
            questions_text="\n".join([f"{i+1}. {q}" for i,q in enumerate(current_questions)])
            llm_messages=[{"role":"system","content":system_prompt},{"role":"user","content":f"{current_point_count} points each:\n{questions_text}"}]
    skip_image=any(kw in english_query.lower() for kw in ['who','person','famous','actor','actress','singer','politician','celebrity'])

    def sync_stream_gen():
        with ThreadPoolExecutor(max_workers=1) as ex:
            svg_future=None
            if not skip_image and len(english_query)>=2:
                svg_future=ex.submit(get_image_for_topic,english_query)
            if _file_context.get("filename"):
                if _file_context.get("processing"):
                    _fname=_file_context["filename"]
                    _indexing_html=('<div style="background:rgba(99,102,241,0.12);border-left:4px solid #6366f1;'
                                    'padding:8px 14px;margin-bottom:14px;border-radius:4px;color:#a5b4fc;font-size:13px;">'
                                    f'⏳ Still indexing <strong>{_fname}</strong> — answering from general knowledge.</div>')
                    yield f"data: {json.dumps({'type':'prefix','content':_indexing_html})}\n\n"
                elif _file_context.get("ready") and _file_context["text"]:
                    file_answer=answer_from_file_context(english_query,_file_context["text"],_file_context["filename"])
                    if file_answer:
                        _fname=_file_context["filename"]
                        badge=('<div style="background:rgba(0,180,100,0.15);border-left:4px solid #00b464;'
                               'padding:8px 14px;margin-bottom:14px;border-radius:4px;color:#7fffb8;font-size:13px;">'
                               f'📄 Answer sourced from: <strong>{_fname}</strong></div>')
                        yield f"data: {json.dumps({'type':'prefix','content':badge})}\n\n"
                        yield f"data: {json.dumps({'type':'token','content':file_answer})}\n\n"
                        yield f"data: {json.dumps({'type':'done'})}\n\n"
                        return
                    else:
                        _fname=_file_context["filename"]
                        _notfound_html=('<div style="background:rgba(255,160,0,0.12);border-left:4px solid #ffa000;'
                                        'padding:8px 14px;margin-bottom:14px;border-radius:4px;color:#ffd580;font-size:13px;">'
                                        f'⚠️ Not found in uploaded file ({_fname}). Here is the answer from my knowledge:</div>')
                        yield f"data: {json.dumps({'type':'prefix','content':_notfound_html})}\n\n"
            try:
                stream=get_groq_client().chat.completions.create(model=_PRIMARY_MODEL,messages=llm_messages,stream=True,temperature=0.25,max_tokens=max_tok,top_p=0.92)
                for chunk in stream:
                    delta=chunk.choices[0].delta.content
                    if delta: yield f"data: {json.dumps({'type':'token','content':delta})}\n\n"
            except Exception as e:
                err=str(e)
                if '429' in err or 'rate_limit' in err.lower():
                    try:
                        stream2=get_groq_client().chat.completions.create(model=_FALLBACK_MODEL,messages=llm_messages,stream=True,temperature=0.25,max_tokens=max_tok,top_p=0.92)
                        for chunk in stream2:
                            delta=chunk.choices[0].delta.content
                            if delta: yield f"data: {json.dumps({'type':'token','content':delta})}\n\n"
                    except Exception: yield f"data: {json.dumps({'type':'error','message':'Failed to generate response'})}\n\n"
                else: yield f"data: {json.dumps({'type':'error','message':'Failed to generate response'})}\n\n"
            if svg_future:
                try:
                    image_url=svg_future.result(timeout=25)
                    if image_url: yield f"data: {json.dumps({'type':'image','url':image_url})}\n\n"
                except Exception: pass
            yield f"data: {json.dumps({'type':'done'})}\n\n"

    return StreamingResponse(sync_stream_gen(),media_type="text/event-stream",
                             headers={"Cache-Control":"no-cache","X-Accel-Buffering":"no","Connection":"keep-alive"})


# ════════════════════════════════════════════════════════════════════════════
#  QUIZ ENDPOINTS
# ════════════════════════════════════════════════════════════════════════════

class QuizGenerateRequest(BaseModel):
    topic: str
    num_questions: int = 5
    marks_per_question: int = 2
    difficulty: str = "medium"

class QuizAnswerItem(BaseModel):
    question_id: str
    question: str
    student_answer: str
    max_marks: int

class QuizEvaluateRequest(BaseModel):
    answers: List[QuizAnswerItem]


@app.post("/api/quiz/generate")
async def quiz_generate(request: QuizGenerateRequest):
    is_mcq = request.marks_per_question == 1

    if is_mcq:
        mcq_system = (
            "You are a university exam MCQ generator. "
            "Generate multiple-choice questions with 4 REAL, TOPIC-SPECIFIC answer options. "
            "NEVER write 'Option 1', 'Option A', 'True', 'False', or any generic placeholder. "
            "Every option must be a concrete fact or term directly related to the topic. "
            "Exactly one option must be correct. "
            "Return ONLY a raw JSON array — no markdown, no backticks, no explanation. "
            "Each item: id (string), question (string), "
            "options (array of exactly 4 strings prefixed A) B) C) D)), "
            "correct_option (string), max_marks (int always 1)."
        )
        mcq_user = (
            f"Topic: {request.topic}\nCount: {request.num_questions}\nDifficulty: {request.difficulty}\n\n"
            f"Generate {request.num_questions} MCQ questions about '{request.topic}'. "
            f"All 4 options must be specific facts/terms about the topic — never generic.\n"
            f"Example for 'Python':\n"
            f'[{{"id":"q1","question":"Which keyword defines a function in Python?",'
            f'"options":["A) func","B) def","C) define","D) function"],'
            f'"correct_option":"B) def","max_marks":1}}]\n\n'
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
                valid.append(q)
            return valid

        try:
            for attempt in range(2):
                comp = get_groq_client().chat.completions.create(
                    model=_FALLBACK_MODEL,
                    messages=[{"role":"system","content":mcq_system},{"role":"user","content":mcq_user}],
                    temperature=0.3 if attempt==0 else 0.15,
                    max_tokens=2500,
                )
                raw = comp.choices[0].message.content.strip()
                raw = re.sub(r"^```[a-zA-Z]*\n?","",raw).rstrip("`").strip()
                start=raw.find('['); end=raw.rfind(']')
                if start==-1 or end==-1: continue
                parsed    = json.loads(raw[start:end+1])
                validated = validate_mcq(parsed)
                if validated:
                    print(f"✅ MCQ: {len(validated)} valid questions for '{request.topic}'")
                    return {"questions": validated}
                print(f"⚠ MCQ attempt {attempt+1}: no valid options, retrying...")
            raise HTTPException(status_code=500, detail="Could not generate valid MCQ options. Please try again.")
        except HTTPException: raise
        except Exception as e:
            import traceback; print(traceback.format_exc())
            raise HTTPException(status_code=500, detail="Failed to generate MCQ questions.")

    else:
        try:
            system_prompt = (
                "You are a university exam paper setter. "
                "Generate REAL, SPECIFIC exam questions — never placeholder text like "
                "'Question 1', 'Maths question 1', or any generic filler. "
                "Each question must be a complete, answerable question directly about the topic given. "
                "Respond ONLY with a valid JSON array, no markdown, no extra text. "
                "Each object must have: id (string like 'q1'), question (string), max_marks (int)."
            )
            user_prompt = (
                f"Topic: {request.topic}\nNumber of questions: {request.num_questions}\n"
                f"Marks per question: {request.marks_per_question}\nDifficulty: {request.difficulty}\n\n"
                f"Write {request.num_questions} REAL, SPECIFIC exam questions about '{request.topic}'. "
                f"Every question must be directly about '{request.topic}'. "
                f"For {request.marks_per_question}-mark questions: define/state/list/give one example. "
                f"Each question is worth exactly {request.marks_per_question} marks. "
                f"Return ONLY a valid JSON array like: "
                f'[{{"id":"q1","question":"Define X and state its formula.","max_marks":{request.marks_per_question}}}]'
            )
            comp = get_groq_client().chat.completions.create(
                model="openai/gpt-oss-120b",
                messages=[{"role":"system","content":system_prompt},{"role":"user","content":user_prompt}],
                temperature=0.4, max_tokens=1500,
            )
            raw = comp.choices[0].message.content.strip()
            raw = re.sub(r"^```[a-z]*\n?","",raw).rstrip("`").strip()
            questions = json.loads(raw)
            placeholder_patterns = ["question 1","question 2","question 3",f"{request.topic.lower()} question","placeholder","sample question"]
            for q in questions:
                if any(p in q.get("question","").lower() for p in placeholder_patterns):
                    raise HTTPException(status_code=500, detail="Generated placeholder questions. Please try again.")
            return {"questions": questions}
        except HTTPException: raise
        except Exception as e:
            import traceback; print(traceback.format_exc())
            raise HTTPException(status_code=500, detail="Failed to generate quiz questions.")


@app.post("/api/quiz/evaluate")
async def quiz_evaluate(request: QuizEvaluateRequest):
    try:
        system_prompt = (
            "You are a strict but fair university examiner. "
            "Award marks honestly. NEVER exceed max_marks for any question. "
            "Respond ONLY with a valid JSON array. "
            "Each object: question_id, awarded_marks (int 0..max_marks), feedback (1-2 sentences)."
        )
        items_text="\n\n".join([
            f"Question ID: {a.question_id}\nQuestion: {a.question}\nMax marks: {a.max_marks}\nStudent answer: {a.student_answer or '[No answer]'}"
            for a in request.answers
        ])
        user_prompt=(f"Evaluate these answers:\n\n{items_text}\n\n"
                     f'Return ONLY JSON like: [{{"question_id":"q1","awarded_marks":2,"feedback":"Good."}}]')
        comp=get_groq_client().chat.completions.create(
            model="openai/gpt-oss-120b",
            messages=[{"role":"system","content":system_prompt},{"role":"user","content":user_prompt}],
            temperature=0.1,max_tokens=2000)
        raw=comp.choices[0].message.content.strip()
        raw=re.sub(r"^```[a-z]*\n?","",raw).rstrip("`").strip()
        evaluations=json.loads(raw)
        max_marks_map={a.question_id:a.max_marks for a in request.answers}
        for ev in evaluations:
            cap=max_marks_map.get(ev["question_id"],0)
            ev["awarded_marks"]=max(0,min(int(ev["awarded_marks"]),cap))
            ev["max_marks"]=cap
        return {"evaluations":evaluations,"total_awarded":sum(ev["awarded_marks"] for ev in evaluations),"total_possible":sum(a.max_marks for a in request.answers)}
    except Exception as e:
        import traceback; print(traceback.format_exc())
        raise HTTPException(status_code=500,detail="Failed to evaluate answers.")


# ════════════════════════════════════════════════════════════════════════════
#  ENDPOINT: /api/roadmap
# ════════════════════════════════════════════════════════════════════════════

class RoadmapRequest(BaseModel):
    subject: str

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
            temperature=0.15, max_tokens=1500, top_p=0.9,
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
    result = await loop.run_in_executor(_executor, _generate_roadmap_sync, subject)
    return result


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        app,
        host="0.0.0.0",
        port=8000,
        limit_concurrency=100,
        timeout_keep_alive=30,
    )