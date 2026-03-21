import os
import re
import io
import json
import base64
import requests
from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional, Tuple
from groq import Groq
from dotenv import load_dotenv
from functools import lru_cache

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

_file_context: dict = {"text": "", "filename": "", "type": ""}


# ── Models ───────────────────────────────────────────────────────────────────
class ChatRequest(BaseModel):
    messages: List[dict]

class SimpleTeachRequest(BaseModel):
    topic: str
    language: str = "en"
    previous_response: str = ""

class ChildTeachRequest(BaseModel):
    topic: str
    language: str = "en"

# ── Groq singleton ───────────────────────────────────────────────────────────
_groq_client = None
def get_groq_client():
    global _groq_client
    if _groq_client is None:
        _groq_client = Groq(api_key=GROQ_API_KEY)
    return _groq_client


# ════════════════════════════════════════════════════════════════════════════
#  HELPERS: clean LLM output
# ════════════════════════════════════════════════════════════════════════════

def clean_llm_response(text: str) -> str:
    # Remove markdown image tags
    text = re.sub(r'!\[[^\]]*\]\([^\)]*\)', '', text)
    # Convert ## Heading → **Heading** style (bold, title case, no ALL-CAPS)
    text = re.sub(r'^#{1,6}\s+(.+)$', lambda m: f"\n{m.group(1).strip()}\n", text, flags=re.MULTILINE)
    # Remove leftover bold markers that might come from LLM
    text = re.sub(r'\*\*(.+?)\*\*', lambda m: m.group(1), text)
    return text.strip()


# ════════════════════════════════════════════════════════════════════════════
#  HELPERS: FILE EXTRACTION
# ════════════════════════════════════════════════════════════════════════════

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
            model="openai/gpt-oss-20b",
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
        comp = get_groq_client().chat.completions.create(
            model="openai/gpt-oss-20b",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user",   "content": user_msg},
            ],
            temperature=0.1, max_tokens=800,
        )
        answer = comp.choices[0].message.content.strip()
        if answer.upper().startswith("NOT_IN_FILE"):
            return None
        return clean_llm_response(answer)
    except Exception as e:
        print(f"⚠ file-context answer error: {e}")
        return None


# ════════════════════════════════════════════════════════════════════════════
#  ENDPOINT: /api/upload-file
# ════════════════════════════════════════════════════════════════════════════

@app.post("/api/upload-file")
async def upload_file(file: UploadFile = File(...)):
    global _file_context
    try:
        content_type = file.content_type or ""
        filename     = file.filename or "uploaded_file"
        file_bytes   = await file.read()
        extracted_text = ""
        file_type      = ""

        if "pdf" in content_type or filename.lower().endswith(".pdf"):
            file_type      = "pdf"
            extracted_text = extract_text_from_pdf_bytes(file_bytes)
            if not extracted_text:
                return {"success": False, "message": "Could not extract text from PDF.", "chars_extracted": 0}
        elif content_type.startswith("image/"):
            file_type      = "image"
            extracted_text = describe_image_with_groq(file_bytes, content_type)
            if not extracted_text:
                return {"success": False, "message": "Could not analyse the image.", "chars_extracted": 0}
        else:
            raise HTTPException(status_code=400, detail="Unsupported file type. Upload a PDF or image.")

        _file_context["text"]     = extracted_text
        _file_context["filename"] = filename
        _file_context["type"]     = file_type

        preview = extracted_text[:200].replace("\n", " ")
        return {
            "success": True, "filename": filename, "file_type": file_type,
            "chars_extracted": len(extracted_text), "preview": preview,
            "message": f"✅ File '{filename}' uploaded and analysed successfully."
        }
    except HTTPException:
        raise
    except Exception as e:
        import traceback; print(traceback.format_exc())
        raise HTTPException(status_code=500, detail="File processing failed.")


@app.post("/api/clear-file")
async def clear_file():
    global _file_context
    _file_context = {"text": "", "filename": "", "type": ""}
    return {"success": True, "message": "File context cleared."}


# ════════════════════════════════════════════════════════════════════════════
#  HELPERS: IMAGE SEARCH
# ════════════════════════════════════════════════════════════════════════════

_FILLER_WORDS = re.compile(
    r'\b('
    # Request verbs / phrases
    r'explain|what is|what are|how does|how do|how is|describe|define|'
    r'tell me about|teach me about|teach me|give me|get me|show me|'
    r'write|create|generate|make|prepare|provide|list|'
    # Study material nouns
    r'notes|note|summary|summaries|overview|introduction|guide|tutorial|'
    r'material|materials|content|syllabus|curriculum|topics|'
    # Quantity / format words
    r'detailed|detail|details|in detail|in depth|comprehensive|brief|short|simple|simply|'
    r'full|complete|all|important|key|main|basic|basics|advanced|'
    r'for beginners|'
    # Institution / exam context words
    r'university|college|school|institute|institution|academy|'
    r'anna university|vtu|jntu|mumbai university|madras university|'
    r'board|exam|examination|exams|test|quiz|'
    r'semester|sem|year|grade|class|std|standard|'
    r'1st|2nd|3rd|4th|5th|6th|7th|8th|9th|10th|11th|12th|'
    r'regulation|reg|pattern|scheme|'
    # Common filler
    r'about|the|a|an|in|with|and|or|of|to|on|'
    r'for|from|by|at|as|is|are|was|were|be|been|'
    # Quantity words
    r'marks|mark|pages|page|points|point|words|word|'
    # Language names
    r'tamil|hindi|english|telugu|malayalam|kannada|bengali|marathi|'
    r'french|german|spanish|arabic|chinese|japanese|korean|'
    # Action words
    r'compare|discuss|state|name'
    r')\b',
    re.IGNORECASE
)

def get_clean_topic_from_message(user_message: str) -> str:
    clean = _FILLER_WORDS.sub(' ', user_message)
    clean = re.sub(r'\b\d+\b', ' ', clean)
    clean = re.sub(r'[?.,!;:\'"()]', ' ', clean)
    clean = re.sub(r'\s+', ' ', clean).strip()

    if len(clean) < 2:
        words = user_message.split()
        clean = ' '.join(words[:3])

    print(f"📌 Clean topic for image: '{clean}'")
    return clean.lower()


def build_architecture_query(topic: str) -> str:
    query = f"{topic} architecture diagram"
    print(f"🔍 Image query: '{query}'")
    return query


def search_google_images(query: str, num_results: int = 3) -> List[str]:
    if not GOOGLE_API_KEY or not GOOGLE_CX:
        print("⚠ Google API credentials not configured")
        return []
    try:
        r = requests.get(
            "https://www.googleapis.com/customsearch/v1",
            params={
                'q':          query,
                'cx':         GOOGLE_CX,
                'key':        GOOGLE_API_KEY,
                'searchType': 'image',
                'num':        num_results,
                'imgSize':    'large',
                'safe':       'active',
            },
            timeout=5
        )
        if r.status_code == 200:
            data = r.json()
            if 'items' in data:
                urls = [item['link'] for item in data['items']]
                print(f"✅ Found {len(urls)} image(s) for: '{query}'")
                return urls
        else:
            print(f"⚠ Google Images API {r.status_code}")
        return []
    except Exception as e:
        print(f"⚠ Image search error: {e}")
        return []


def get_image_for_topic(user_message: str) -> str:
    msg_lower = user_message.lower()
    
    no_image_keywords = ['who is', 'famous person', 'actor', 'actress', 'singer', 
                         'person', 'individual', 'somebody', 'someone',
                         'formula', 'equation', 'derivation', 'proof']
    
    for keyword in no_image_keywords:
        if keyword in msg_lower:
            print(f"📵 Skipping image for personal/abstract query: '{keyword}'")
            return ""
    
    topic = get_clean_topic_from_message(user_message)
    
    if len(topic) < 3:
        return ""
    
    image_type = "diagram"
    
    if any(word in msg_lower for word in ['architecture', 'structure', 'components', 'parts', 'layers']):
        image_type = "architecture diagram"
    elif any(word in msg_lower for word in ['flow', 'process', 'working', 'how it works', 'algorithm']):
        image_type = "flow diagram"
    elif any(word in msg_lower for word in ['graph', 'chart', 'plot', 'visualization']):
        image_type = "graph chart"
    elif any(word in msg_lower for word in ['example', 'real world', 'application', 'use case']):
        image_type = "example illustration"
    elif any(word in msg_lower for word in ['comparison', 'compare', 'vs', 'versus']):
        image_type = "comparison chart"
    elif any(word in msg_lower for word in ['model', 'network', 'neural', 'deep learning']):
        image_type = "neural network diagram"
    elif any(word in msg_lower for word in ['interface', 'ui', 'gui', 'screen']):
        image_type = "user interface screenshot"
    elif any(word in msg_lower for word in ['concept', 'idea', 'theory']):
        image_type = "concept illustration"
    else:
        image_type = "educational diagram"
    
    query = f"{topic} {image_type}"
    
    generic_topics = ['python', 'java', 'c++', 'javascript', 'html', 'css', 
                      'sql', 'database', 'network', 'security', 'ai', 'ml']
    
    if topic in generic_topics:
        if image_type == "architecture diagram":
            query = f"{topic} programming language architecture diagram"
        elif image_type == "flow diagram":
            query = f"{topic} code flow diagram example"
        else:
            query = f"{topic} programming concept illustration"
    
    print(f"🔍 Contextual image query: '{query}'")
    
    urls = search_google_images(query, num_results=3)
    
    if not urls:
        simpler_query = f"{topic} diagram"
        print(f"⚠ No results, trying simpler: '{simpler_query}'")
        urls = search_google_images(simpler_query, num_results=3)
    
    return urls[0] if urls else ""


def create_html_with_image(text_response: str, image_url: str, topic: str) -> str:
    if not image_url or '<img' in text_response:
        return text_response

    image_html = f'''<div style="margin:0 0 24px 0;text-align:center;">
    <img src="{image_url}" alt="{topic} architecture diagram"
         style="max-width:100%;max-height:480px;border-radius:10px;
                box-shadow:0 4px 16px rgba(0,0,0,0.4);border:1px solid rgba(255,255,255,0.15);"
         onerror="this.parentElement.style.display='none'">
    <p style="color:#aaa;font-size:12px;margin-top:8px;letter-spacing:0.3px;">
        🖼️ {topic.title()} — Diagram
    </p>
</div>'''

    content_style = 'style="white-space:pre-wrap;word-wrap:break-word;overflow-wrap:break-word;line-height:1.7;"'

    return f'''<div style="font-family:'Segoe UI',Arial,sans-serif;color:white;">
{image_html}
<div {content_style}>{text_response}</div>
</div>'''


# ════════════════════════════════════════════════════════════════════════════
#  HELPERS: CONTEXT EXTRACTION
# ════════════════════════════════════════════════════════════════════════════

def extract_user_context(user_message: str) -> str:
    msg_lower = user_message.lower()

    wants_notes = bool(re.search(
        r'\bnotes?\b|\bsummary\b|\bsummaries\b|\boverview\b|\bguide\b|\btutorial\b', msg_lower
    ))

    context_match = re.search(
        r'\b(?:for|as per|according to|based on|per|following)\b\s*(.{3,60})',
        msg_lower
    )

    context_phrase = ""
    if context_match:
        raw = context_match.group(1).strip()
        raw = re.sub(r'\b(exam|exams|test|notes?|summary|the)\b', '', raw).strip()
        raw = re.sub(r'\s+', ' ', raw).strip().title()
        if len(raw) > 2:
            context_phrase = raw

    parts = []
    if context_phrase:
        parts.append(
            f"The user is asking about the topic above in the context of {context_phrase}. "
            f"Answer ONLY about the topic — do NOT explain or describe {context_phrase} itself. "
            f"Match the depth, terminology, and syllabus coverage expected at {context_phrase} "
            f"for this specific subject."
        )
    if wants_notes:
        parts.append(
            "Format as structured notes: use numbered points and sub-points, "
            "short crisp sentences, key terms in Title Case — not long paragraphs."
        )

    return "\n".join(parts)


# ════════════════════════════════════════════════════════════════════════════
#  HELPERS: language / headings
# ════════════════════════════════════════════════════════════════════════════

LANG_NAME_MAP = {
    'ta': 'Tamil',   'hi': 'Hindi',      'te': 'Telugu',   'ml': 'Malayalam',
    'kn': 'Kannada', 'bn': 'Bengali',    'mr': 'Marathi',  'gu': 'Gujarati',
    'pa': 'Punjabi', 'ur': 'Urdu',       'ar': 'Arabic',   'fr': 'French',
    'de': 'German',  'es': 'Spanish',    'it': 'Italian',  'pt': 'Portuguese',
    'ru': 'Russian', 'zh-cn': 'Chinese', 'ja': 'Japanese', 'ko': 'Korean',
    'nl': 'Dutch',   'sv': 'Swedish',    'tr': 'Turkish',  'pl': 'Polish',
    'en': 'English',
}

def detect_language(text: str) -> str:
    try:
        if re.search(r'[\u0B80-\u0BFF]', text): return 'ta'
        if re.search(r'[\u0900-\u097F]', text): return 'hi'
        if re.search(r'[\u0600-\u06FF]', text): return 'ar'
        if re.search(r'[\u4E00-\u9FFF]', text): return 'zh-CN'
        if re.search(r'[\u3040-\u309F\u30A0-\u30FF]', text): return 'ja'
        if re.search(r'[\uAC00-\uD7AF]', text): return 'ko'
        if re.search(r'[\u0400-\u04FF]', text): return 'ru'
        if re.search(r'[\u0C00-\u0C7F]', text): return 'te'
        if re.search(r'[\u0D00-\u0D7F]', text): return 'ml'
        if re.search(r'[\u0980-\u09FF]', text): return 'bn'
        return 'en'
    except:
        return 'en'


EXPLICIT_LANG_KEYWORDS = {
    'tamil': 'ta', 'தமிழ்': 'ta', 'hindi': 'hi', 'हिंदी': 'hi',
    'telugu': 'te', 'తెలుగు': 'te', 'malayalam': 'ml', 'മലയാളം': 'ml',
    'kannada': 'kn', 'ಕನ್ನಡ': 'kn', 'bengali': 'bn', 'বাংলা': 'bn',
    'marathi': 'mr', 'मराठी': 'mr', 'gujarati': 'gu', 'ગુજરાતી': 'gu',
    'punjabi': 'pa', 'ਪੰਜਾਬੀ': 'pa', 'urdu': 'ur', 'اردو': 'ur',
    'arabic': 'ar', 'french': 'fr', 'german': 'de', 'spanish': 'es',
    'italian': 'it', 'portuguese': 'pt', 'russian': 'ru', 'chinese': 'zh-CN',
    'japanese': 'ja', 'korean': 'ko', 'turkish': 'tr', 'dutch': 'nl',
}


def process_user_input(text: str) -> tuple:
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
    for keyword, code in EXPLICIT_LANG_KEYWORDS.items():
        if keyword in text_lower:
            return text, code
    return text, 'en'


def translate_headings(lang_code: str) -> dict:
    fallback = {
        'intro': 'INTRODUCTION', 'concepts': 'CORE CONCEPTS',
        'fundamental': 'FUNDAMENTAL CONCEPTS', 'detailed': 'DETAILED EXPLANATION',
        'example': 'EXAMPLE', 'examples': 'REAL-WORLD EXAMPLES',
        'applications': 'APPLICATIONS', 'advantages': 'ADVANTAGES',
        'limitations': 'LIMITATIONS', 'conclusion': 'CONCLUSION',
        'insights': 'KEY INSIGHTS'
    }
    if lang_code == 'en' or not TRANSLATOR_AVAILABLE:
        return fallback
    try:
        translator = Translator()
        english = {
            'intro': 'introduction', 'concepts': 'core concepts',
            'fundamental': 'fundamental concepts', 'detailed': 'detailed explanation',
            'example': 'example', 'examples': 'real world examples',
            'applications': 'applications', 'advantages': 'advantages',
            'limitations': 'limitations', 'conclusion': 'conclusion',
            'insights': 'key insights'
        }
        out = {}
        for key, eng in english.items():
            try:
                result = translator.translate(eng, src='en', dest=lang_code)
                out[key] = result.text.upper() if result and result.text else fallback[key]
            except:
                out[key] = fallback[key]
        return out
    except:
        return fallback


def get_section_headings(lang_code: str) -> dict:
    return translate_headings(lang_code)


# ════════════════════════════════════════════════════════════════════════════
#  HELPERS: patterns / message utils
# ════════════════════════════════════════════════════════════════════════════

GREETING_PATTERN    = re.compile(r'^\s*(hello|hi|hey|greetings|good morning|good afternoon|good evening|what\'s up|howdy|hiya)\b', re.IGNORECASE)
PAGE_PATTERN        = re.compile(r'(\d+)\s*pages?\b', re.IGNORECASE)
MARK_PATTERN        = re.compile(r'(\d+)\s*(?:mark|marks)\b', re.IGNORECASE)
POINT_PATTERN       = re.compile(r'(\d+)\s*(?:point|points)\b', re.IGNORECASE)
GIVE_POINTS_PATTERN = re.compile(r'give\s+(\d+)\s+points?\b', re.IGNORECASE)
NOTES_PATTERN       = re.compile(r'\bnotes?\b|\bsummary\b|\bsummaries\b|\boverview\b', re.IGNORECASE)


@lru_cache(maxsize=128)
def is_greeting_cached(msg: str) -> bool:
    return bool(GREETING_PATTERN.search(msg))

def is_greeting(msg: str) -> bool:
    return is_greeting_cached(msg.strip())


@lru_cache(maxsize=64)
def extract_questions_comprehensive_cached(text: str) -> tuple:
    questions, seen, unique = [], set(), []
    for line in text.split('\n'):
        line = line.strip()
        if not line or len(line) > 200:
            continue
        if (line.lower() in ['introduction','key features','applications','conclusion','references']
                and not any(w in line.lower() for w in ['define','what','list','explain','state','name'])):
            continue
        if not re.match(r'^\d+\.', line) and any(w in line.lower() for w in ['define','what','list','explain','state','name']):
            if 10 < len(line) < 150:
                questions.append(line if line.endswith('?') else line + '?')
        elif re.match(r'^\d+\.', line):
            q = re.sub(r'^\d+\.\s*', '', line)
            if q and 5 < len(q) < 150:
                if not q.endswith('?'):
                    q = q+'?' if any(w in q.lower() for w in ['define','list','what','explain','state','name']) else f"What is {q}?"
                questions.append(q)
    for q in questions:
        k = re.sub(r'[^\w\s]', '', q.lower())
        if k not in seen:
            unique.append(q); seen.add(k)
    return tuple(unique)

def extract_questions_comprehensive(text: str) -> list:
    return list(extract_questions_comprehensive_cached(text))


def get_recent_messages_fast(messages: List[dict], max_messages: int = 6) -> List[dict]:
    if len(messages) <= max_messages:
        return messages
    recent = messages[-max_messages:]
    if recent[0]["role"] != "user" and messages[-1]["role"] == "user":
        for i in range(len(messages)-2, -1, -1):
            if messages[i]["role"] == "user":
                recent = messages[i:]
                if len(recent) > max_messages:
                    recent = recent[:max_messages]
                break
    return recent


def calculate_word_count_from_pages(pages: int) -> int:
    return pages * 250

def calculate_word_count_from_marks(marks: int) -> int:
    return marks * 50


# ════════════════════════════════════════════════════════════════════════════
#  HELPERS: schedule → HTML table
# ════════════════════════════════════════════════════════════════════════════

def create_html_table_fast(schedule_data: list, topic: str) -> str:
    if not schedule_data:
        return ""
    rows = []
    for i, row in enumerate(schedule_data):
        bg = "rgba(255,255,255,0.05)" if i % 2 == 0 else "rgba(255,255,255,0.1)"
        rows.append(f'''<tr style="background-color:{bg};">
<td style="border:1px solid rgba(255,255,255,0.2);padding:12px;color:white;font-family:'Segoe UI',Arial,sans-serif;white-space:normal;word-wrap:break-word;">{row[0]}</td>
<td style="border:1px solid rgba(255,255,255,0.2);padding:12px;color:white;font-family:'Segoe UI',Arial,sans-serif;white-space:normal;word-wrap:break-word;">{row[1]}</td>
<td style="border:1px solid rgba(255,255,255,0.2);padding:12px;color:white;font-family:'Segoe UI',Arial,sans-serif;white-space:normal;word-wrap:break-word;">{row[2]}</td>
</tr>''')
    return f'''<div style="margin:20px 0;font-family:'Segoe UI',Arial,sans-serif;">
<h3 style="color:white;margin-bottom:15px;font-family:'Segoe UI',Arial,sans-serif;">
Study Plan: {topic} ({len(schedule_data)} days)
</h3>
<table style="width:100%;border-collapse:collapse;background-color:transparent;table-layout:auto;">
<thead>
<tr style="background-color:rgba(68,114,196,0.3);color:white;">
<th style="border:1px solid rgba(255,255,255,0.3);padding:12px;text-align:left;font-weight:600;color:white;width:15%;">Day</th>
<th style="border:1px solid rgba(255,255,255,0.3);padding:12px;text-align:left;font-weight:600;color:white;width:65%;">Topic</th>
<th style="border:1px solid rgba(255,255,255,0.3);padding:12px;text-align:left;font-weight:600;color:white;width:20%;">Time</th>
</tr>
</thead>
<tbody>{''.join(rows)}</tbody>
</table>
</div>'''


def process_schedule_with_html_table_fast(response_text: str, latest_user_msg: str) -> str:
    day_patterns = [
        r'Day\s*\d+', r'நாள்\s*\d+', r'Día\s*\d+', r'Jour\s*\d+',
        r'Tag\s*\d+', r'日\s*\d+', r'\d+\s*день',
    ]
    schedule_markers = ["Schedule:", "STUDY SCHEDULE:", "Study Schedule:", "STUDY PLAN:", "அட்டவணை:", "Horario:"]
    schedule_start_idx = -1
    for marker in schedule_markers:
        idx = response_text.find(marker)
        if idx != -1:
            schedule_start_idx = idx; break
    if schedule_start_idx == -1:
        for line in response_text.split('\n'):
            for pattern in day_patterns:
                if re.search(pattern, line):
                    schedule_start_idx = response_text.find(line); break
            if schedule_start_idx != -1: break
    if schedule_start_idx == -1:
        return response_text

    explanation_text = response_text[:schedule_start_idx].strip()
    schedule_text    = response_text[schedule_start_idx:].strip()
    schedule_lines   = []

    for line in schedule_text.split('\n'):
        line = line.strip()
        if not line or len(line) < 5: continue
        lower_line = line.lower()
        if any(h in lower_line for h in ['day|topic|time','day | topic | time','---','===','schedule:','study schedule:','study plan:','அட்டவணை:']): continue
        if '|' in line:
            parts = [p.strip() for p in line.split('|')]
            if len(parts) >= 3 and parts[0] and parts[1] and len(parts[1]) > 3:
                schedule_lines.append([parts[0], parts[1], parts[2]])
        else:
            for pattern in day_patterns:
                dm = re.search(pattern, line, re.IGNORECASE)
                if dm:
                    day_part  = dm.group(0)
                    remaining = line[dm.end():].strip()
                    time_pats = [
                        r'(\d+\s*(?:hours?|hrs?|h))', r'(\d+\s*(?:மணி நேரம்|மணி))',
                        r'(\d+\s*(?:horas?))', r'(\d+\s*(?:heures?))',
                        r'(\d+\s*(?:Stunden?))', r'(\d+\s*(?:小时|時間))',
                    ]
                    time_part  = '2 hours'
                    topic_part = remaining
                    for tp in time_pats:
                        tm = re.search(tp, remaining, re.IGNORECASE)
                        if tm:
                            time_part  = tm.group(1)
                            topic_part = remaining[:tm.start()].strip(' -:|')
                            break
                    if not topic_part or len(topic_part) <= 3:
                        topic_part = remaining.strip(' -:|')
                    if topic_part and len(topic_part) > 3:
                        schedule_lines.append([day_part, topic_part, time_part])
                    break

    if schedule_lines:
        return f"{explanation_text}\n\n{create_html_table_fast(schedule_lines, latest_user_msg[:50])}"
    return response_text


# ════════════════════════════════════════════════════════════════════════════
#  HELPERS: mode detection
# ════════════════════════════════════════════════════════════════════════════

def detect_mode_from_message(msg_lower: str) -> Tuple[str, int]:
    if any(t in msg_lower for t in ["explain in detail","detailed explanation","comprehensive","in depth"]):
        return "detailed_no_schedule", 2
    if any(t in msg_lower for t in ["teach me","explain like","for beginners","simple"]):
        return "teaching", 2
    if NOTES_PATTERN.search(msg_lower):
        return "notes", 0
    if "point" in msg_lower or "mark" in msg_lower:
        gm = GIVE_POINTS_PATTERN.search(msg_lower)
        if gm: return "points", int(gm.group(1))
        gn = POINT_PATTERN.search(msg_lower) or MARK_PATTERN.search(msg_lower)
        if gn: return "points", int(gn.group(1))
    return "detailed", 2


def process_detailed_response_without_schedule(user_message: str, messages: List[dict]) -> str:
    user_context = extract_user_context(user_message)
    msg_lower  = user_message.lower()
    page_match = PAGE_PATTERN.search(msg_lower)
    if page_match:
        pages      = int(page_match.group(1))
        word_count = calculate_word_count_from_pages(pages)
        system_prompt = (
            f"You are NexusAI, a university-level academic tutor.\n"
            f"{user_context}\n\n"
            f"Provide a comprehensive ~{word_count}-word explanation.\n"
            "STRUCTURE: INTRODUCTION, CORE CONCEPTS, CONCRETE EXAMPLE, "
            "TECHNICAL DETAILS, REAL-WORLD APPLICATIONS, CHALLENGES/TRADE-OFFS, CONCLUSION.\n"
            "RULES: Use clear section headings on their own line (no ## symbols, no ALL-CAPS). "
            "Same language as user. NO study schedule. NO markdown image tags."
        )
        recent = get_recent_messages_fast(messages, 4)
        comp = get_groq_client().chat.completions.create(
            model="openai/gpt-oss-20b",
            messages=[{"role":"system","content":system_prompt}] + recent,
            temperature=0.2, max_tokens=min(word_count * 2, 8000), top_p=0.95,
        )
        return clean_llm_response(comp.choices[0].message.content.strip())

    mark_match = MARK_PATTERN.search(msg_lower)
    if mark_match:
        marks      = int(mark_match.group(1))
        word_count = calculate_word_count_from_marks(marks)
        system_prompt = (
            f"You are NexusAI.\n"
            f"{user_context}\n\n"
            f"Answer this {marks}-mark question as a continuous ~{word_count}-word essay.\n"
            "Cover: Introduction, Need/Motivation, Objectives, Components/Architecture, Terminology, "
            "Working/Process, Security/Technical Mechanisms, Features, Advantages, Limitations, "
            "Applications, Versions/Evolution, Conclusion.\n"
            "RULES: Continuous essay, NOT Q&A. Use clear section headings on their own line (no ## symbols, no ALL-CAPS). "
            "Same language as user. NO study schedule. NO markdown image tags."
        )
        recent = get_recent_messages_fast(messages, 4)
        comp = get_groq_client().chat.completions.create(
            model="openai/gpt-oss-20b",
            messages=[{"role":"system","content":system_prompt}] + recent,
            temperature=0.2, max_tokens=min(word_count * 2, 8000), top_p=0.95,
        )
        return clean_llm_response(comp.choices[0].message.content.strip())


# ════════════════════════════════════════════════════════════════════════════
#  ENDPOINT: /api/teach-simple
# ════════════════════════════════════════════════════════════════════════════

@app.post("/api/teach-simple")
async def teach_simple(request: SimpleTeachRequest):
    try:
        topic             = request.topic
        language          = request.language
        previous_response = request.previous_response.strip()

        if previous_response:
            plain_prev = re.sub(r'<[^>]+>', ' ', previous_response)[:3000].strip()
            system_prompt = (
                f"You are NexusAI. Rewrite the explanation about '{topic}' as a SHORT SIMPLE SUMMARY of 300-400 words.\n"
                f"RULES: Clear section labels: WHAT IS IT / HOW IT WORKS / REAL EXAMPLE / WHY IT MATTERS. "
                f"NO schedule. NO ## symbols. NO image tags. Respond in '{language}'.\n\nEXPLANATION:\n{plain_prev}"
            )
            user_msg = f"Short simple version about {topic}."
        else:
            system_prompt = (
                f"You are NexusAI. Explain '{topic}' simply in 300-400 words.\n"
                f"Clear section labels: WHAT IS IT / HOW IT WORKS / REAL EXAMPLE / WHY IT MATTERS. "
                f"NO schedule. NO ## symbols. NO image tags. Respond in '{language}'."
            )
            user_msg = f"Explain {topic} simply in 300-400 words."

        comp = get_groq_client().chat.completions.create(
            model="openai/gpt-oss-20b",
            messages=[{"role":"system","content":system_prompt}, {"role":"user","content":user_msg}],
            temperature=0.3, max_tokens=2000, top_p=0.9,
        )
        response_text = clean_llm_response(comp.choices[0].message.content.strip())

        if not is_greeting(topic) and len(topic) > 3:
            image_url = get_image_for_topic(topic)
            if image_url:
                return {"response": create_html_with_image(response_text, image_url, topic)}

        return {"response": f'<div style="white-space:pre-wrap;word-wrap:break-word;overflow-wrap:break-word;font-family:\'Segoe UI\',Arial,sans-serif;color:white;">{response_text}</div>'}

    except Exception as e:
        import traceback; print(traceback.format_exc())
        raise HTTPException(status_code=500, detail="An error occurred. Please try again.")


# ════════════════════════════════════════════════════════════════════════════
#  ENDPOINT: /api/explain-like-child
# ════════════════════════════════════════════════════════════════════════════

@app.post("/api/explain-like-child")
async def explain_like_child(request: ChildTeachRequest):
    try:
        topic    = request.topic
        language = request.language

        system_prompt = (
            f"You are NexusAI explaining '{topic}' to a 5-year-old child.\n"
            f"Extremely simple words, fun analogies. Short sentences (max 10 words each). "
            f"~200-300 words total. Respond in {language}. End with a fun fact. "
            f"NO ## symbols. NO markdown image tags."
        )
        comp = get_groq_client().chat.completions.create(
            model="openai/gpt-oss-20b",
            messages=[
                {"role":"system","content":system_prompt},
                {"role":"user","content":f"Explain {topic} like I'm 5 years old!"}
            ],
            temperature=0.6, max_tokens=2000, top_p=0.95,
        )
        response_text = clean_llm_response(comp.choices[0].message.content.strip())

        return {"response": f'<div style="white-space:pre-wrap;word-wrap:break-word;overflow-wrap:break-word;font-family:\'Segoe UI\',Arial,sans-serif;color:white;">{response_text}</div>'}

    except Exception as e:
        import traceback; print(traceback.format_exc())
        raise HTTPException(status_code=500, detail="An error occurred. Please try again.")


# ════════════════════════════════════════════════════════════════════════════
#  ENDPOINT: /api/chat  (main)
# ════════════════════════════════════════════════════════════════════════════

@app.post("/api/chat")
async def chat(request: ChatRequest):
    try:
        messages = request.messages
        if not messages:
            raise HTTPException(status_code=400, detail="No messages provided")

        latest_user_msg = messages[-1]["content"]

        english_query, detected_lang = process_user_input(latest_user_msg)
        if english_query != latest_user_msg:
            messages = messages[:-1] + [{"role": "user", "content": english_query}]

        msg_lower = english_query.lower()
        headings  = get_section_headings(detected_lang)

        if is_greeting(latest_user_msg):
            return {"response": "Hello! I'm NexusAI, your intelligent assistant. How can I help you today?"}

        user_context = extract_user_context(latest_user_msg)

        skip_image_keywords = ['who', 'person', 'famous', 'actor', 'actress', 
                               'singer', 'politician', 'celebrity']
        skip_image = any(keyword in english_query.lower() for keyword in skip_image_keywords)
        
        image_url = ""
        if not skip_image and len(english_query) > 10:
            image_url = get_image_for_topic(english_query)

        file_prefix = ""
        if _file_context["text"]:
            file_answer = answer_from_file_context(
                english_query, _file_context["text"], _file_context["filename"]
            )
            if file_answer:
                file_badge = (
                    f'<div style="background:rgba(0,180,100,0.15);border-left:4px solid #00b464;'
                    f'padding:8px 14px;margin-bottom:14px;border-radius:4px;'
                    f'font-family:\'Segoe UI\',Arial,sans-serif;color:#7fffb8;font-size:13px;">'
                    f'📄 Answer sourced from: <strong>{_file_context["filename"]}</strong></div>'
                )
                return {"response": file_badge + f'<div style="white-space:pre-wrap;word-wrap:break-word;overflow-wrap:break-word;color:white;">{file_answer}</div>'}
            else:
                file_prefix = (
                    f'<div style="background:rgba(255,160,0,0.12);border-left:4px solid #ffa000;'
                    f'padding:8px 14px;margin-bottom:14px;border-radius:4px;'
                    f'font-family:\'Segoe UI\',Arial,sans-serif;color:#ffd580;font-size:13px;">'
                    f'⚠️ Not found in uploaded file ({_file_context["filename"]}). '
                    f'Here is the answer from my knowledge:</div>'
                )

        page_match = PAGE_PATTERN.search(msg_lower)
        mark_match = MARK_PATTERN.search(msg_lower)
        if page_match or mark_match:
            response_text = process_detailed_response_without_schedule(latest_user_msg, messages)
            if image_url:
                return {"response": file_prefix + create_html_with_image(response_text, image_url, english_query)}
            return {"response": file_prefix + f'<div style="white-space:pre-wrap;word-wrap:break-word;overflow-wrap:break-word;color:white;">{response_text}</div>'}

        current_mode, current_point_count = detect_mode_from_message(msg_lower)

        if current_mode == "notes":
            system_prompt = (
                f"You are NexusAI, an expert academic note-maker.\n"
                f"{user_context}\n\n"
                f"Generate comprehensive, well-structured NOTES on the topic.\n\n"
                f"FORMAT RULES (strict):\n"
                f"- Use clear section headings on their own line (no ## symbols, no ALL-CAPS)\n"
                f"- Use numbered points (1. 2. 3.) and sub-points (a. b. c.)\n"
                f"- Short, crisp sentences — exam-ready style\n"
                f"- Include: Definition, Key Concepts, Types/Categories (if any),\n"
                f"  Working/Process, Advantages, Disadvantages, Applications, Important Terms\n"
                f"- Highlight important terms in CAPS where appropriate\n"
                f"- Language: '{detected_lang}'\n"
                f"- NO timetable/schedule. NO markdown image tags. NO ## symbols.\n"
                f"- Length: thorough enough to cover the syllabus for the given context"
            )
            recent = get_recent_messages_fast(messages, 4)
            comp = get_groq_client().chat.completions.create(
                model="openai/gpt-oss-20b",
                messages=[{"role":"system","content":system_prompt}] + recent,
                temperature=0.2, max_tokens=8000, top_p=0.95,
            )
            response_text = clean_llm_response(comp.choices[0].message.content.strip())
            if image_url:
                return {"response": file_prefix + create_html_with_image(response_text, image_url, english_query)}
            return {"response": file_prefix + f'<div style="white-space:pre-wrap;word-wrap:break-word;overflow-wrap:break-word;color:white;">{response_text}</div>'}

        if current_mode == "detailed_no_schedule":
            system_prompt = (
                f"You are NexusAI, a university-level academic expert.\n"
                f"{user_context}\n\n"
                f"Provide a COMPREHENSIVE 2000-2500 word explanation.\n"
                f"Language: '{detected_lang}'.\n"
                f"Use clear section headings on their own line (no ## symbols, no ALL-CAPS):\n"
                f"  {headings['intro']}, {headings['fundamental']}, {headings['detailed']},\n"
                f"  {headings['examples']}, {headings['applications']},\n"
                f"  {headings['advantages']}, {headings['limitations']}, {headings['conclusion']}\n"
                f"NO timetable. NO markdown image tags."
            )
            recent = get_recent_messages_fast(messages, 4)
            comp = get_groq_client().chat.completions.create(
                model="openai/gpt-oss-20b",
                messages=[{"role":"system","content":system_prompt}] + recent,
                temperature=0.2, max_tokens=8000, top_p=0.95,
            )
            response_text = clean_llm_response(comp.choices[0].message.content.strip())
            if image_url:
                return {"response": file_prefix + create_html_with_image(response_text, image_url, english_query)}
            return {"response": file_prefix + f'<div style="white-space:pre-wrap;word-wrap:break-word;overflow-wrap:break-word;color:white;">{response_text}</div>'}

        if current_mode == "points":
            current_questions = extract_questions_comprehensive(latest_user_msg)
            if current_questions:
                system_prompt = (
                    f"EXAM MODE: EXACTLY {current_point_count} points per question.\n"
                    f"{user_context}\n\n"
                    f"Language: '{detected_lang}'. 5-8 words per point. NO ## symbols. NO image tags."
                )
                questions_text = "\n".join([f"{i+1}. {q}" for i, q in enumerate(current_questions)])
                comp = get_groq_client().chat.completions.create(
                    model="openai/gpt-oss-20b",
                    messages=[
                        {"role":"system","content":system_prompt},
                        {"role":"user","content":f"{current_point_count} points each:\n{questions_text}"}
                    ],
                    temperature=0.1, max_tokens=4000, top_p=0.85,           
                )
                response_text = clean_llm_response(comp.choices[0].message.content.strip())
                if image_url:
                    return {"response": file_prefix + create_html_with_image(response_text, image_url, english_query)}
                return {"response": file_prefix + f'<div style="white-space:pre-wrap;word-wrap:break-word;overflow-wrap:break-word;color:white;">{response_text}</div>'}

        if current_mode == "teaching":
            system_prompt = (
                f"You are NexusAI, a patient teacher.\n"
                f"{user_context}\n\n"
                f"Language: '{detected_lang}'. Simple language and analogies. NO ## symbols. NO image tags."
            )
            recent = get_recent_messages_fast(messages, 4)
            comp = get_groq_client().chat.completions.create(
                model="openai/gpt-oss-20b",
                messages=[{"role":"system","content":system_prompt}] + recent,
                temperature=0.4, max_tokens=2000, top_p=0.9,
            )
            response_text = clean_llm_response(comp.choices[0].message.content.strip())
            if image_url:
                return {"response": file_prefix + create_html_with_image(response_text, image_url, english_query)}
            return {"response": file_prefix + f'<div style="white-space:pre-wrap;word-wrap:break-word;overflow-wrap:break-word;color:white;">{response_text}</div>'}

        system_prompt = (
            f"You are NexusAI.\n"
            f"{user_context}\n\n"
            f"Provide a detailed ~1800-word explanation followed by a 14-day study schedule.\n\n"
            f"Language: '{detected_lang}'.\n\n"
            f"EXPLANATION STRUCTURE — clear section headings on their own line (no ## symbols, no ALL-CAPS):\n"
            f"  {headings['intro']}\n  {headings['concepts']}\n  {headings['example']}\n"
            f"  {headings['applications']}\n  {headings['insights']}\n\n"
            f"After the explanation, add a 14-day study schedule in this EXACT pipe format:\n"
            f"STUDY SCHEDULE:\n"
            f"Day 1|Topic name here|2 hours\n"
            f"Day 2|Topic name here|2 hours\n"
            f"... for all 14 days.\n\nNO markdown image tags. NO ## symbols."
        )
        recent = get_recent_messages_fast(messages, 6)
        comp = get_groq_client().chat.completions.create(
            model="openai/gpt-oss-20b",
            messages=[{"role":"system","content":system_prompt}] + recent,
            temperature=0.25, max_tokens=8000, top_p=0.92,
        )
        raw_response       = clean_llm_response(comp.choices[0].message.content.strip())
        processed_response = process_schedule_with_html_table_fast(raw_response, latest_user_msg)

        if image_url:
            return {"response": file_prefix + create_html_with_image(processed_response, image_url, english_query)}

        return {"response": file_prefix + f'<div style="white-space:pre-wrap;word-wrap:break-word;overflow-wrap:break-word;color:white;">{processed_response}</div>'}

    except Exception as e:
        import traceback; print(traceback.format_exc())
        raise HTTPException(status_code=500, detail="An error occurred. Please try again.")


# ════════════════════════════════════════════════════════════════════════════
#  QUIZ MODELS
# ════════════════════════════════════════════════════════════════════════════

class QuizGenerateRequest(BaseModel):
    topic: str
    num_questions: int = 5
    marks_per_question: int = 2
    difficulty: str = "medium"   # easy | medium | hard

class QuizAnswerItem(BaseModel):
    question_id: str
    question: str
    student_answer: str
    max_marks: int

class QuizEvaluateRequest(BaseModel):
    answers: List[QuizAnswerItem]


# ════════════════════════════════════════════════════════════════════════════
#  ENDPOINT: /api/quiz/generate
# ════════════════════════════════════════════════════════════════════════════

@app.post("/api/quiz/generate")
async def quiz_generate(request: QuizGenerateRequest):
    try:
        system_prompt = (
            "You are a university exam paper setter. "
            "Generate exactly the requested number of questions on the given topic. "
            "Respond ONLY with a valid JSON array, no markdown, no extra text. "
            "Each object must have: id (string like 'q1'), question (string), max_marks (int)."
        )
        user_prompt = (
            f"Topic: {request.topic}\n"
            f"Number of questions: {request.num_questions}\n"
            f"Marks per question: {request.marks_per_question}\n"
            f"Difficulty: {request.difficulty}\n\n"
            f"Generate {request.num_questions} questions. "
            f"Each question is worth exactly {request.marks_per_question} marks. "
            f"Return ONLY a JSON array like: "
            f'[{{"id":"q1","question":"Define X.","max_marks":{request.marks_per_question}}}]'
        )
        comp = get_groq_client().chat.completions.create(
            model="openai/gpt-oss-20b",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user",   "content": user_prompt},
            ],
            temperature=0.4,
            max_tokens=1500,
        )
        raw = comp.choices[0].message.content.strip()
        raw = re.sub(r"^```[a-z]*\n?", "", raw).rstrip("`").strip()
        questions = json.loads(raw)
        return {"questions": questions}
    except Exception as e:
        import traceback; print(traceback.format_exc())
        raise HTTPException(status_code=500, detail="Failed to generate quiz questions.")


# ════════════════════════════════════════════════════════════════════════════
#  ENDPOINT: /api/quiz/evaluate
#  Awards marks per question but NEVER exceeds max_marks for that question.
# ════════════════════════════════════════════════════════════════════════════

@app.post("/api/quiz/evaluate")
async def quiz_evaluate(request: QuizEvaluateRequest):
    try:
        system_prompt = (
            "You are a strict but fair university examiner. "
            "For each question you will receive the question text, student answer, and max marks. "
            "Award marks honestly based on correctness, completeness, and clarity. "
            "You MUST NEVER award more marks than the max_marks for that question. "
            "Respond ONLY with a valid JSON array — no markdown, no extra text. "
            "Each object must have: question_id, awarded_marks (int, 0 to max_marks), feedback (1-2 sentences)."
        )

        items_text = "\n\n".join([
            f"Question ID: {a.question_id}\n"
            f"Question: {a.question}\n"
            f"Max marks: {a.max_marks}\n"
            f"Student answer: {a.student_answer or '[No answer provided]'}"
            for a in request.answers
        ])

        user_prompt = (
            f"Evaluate these answers and return a JSON array:\n\n{items_text}\n\n"
            f"Return ONLY JSON like: "
            f'[{{"question_id":"q1","awarded_marks":2,"feedback":"Good definition but missed one key point."}}]'
        )

        comp = get_groq_client().chat.completions.create(
            model="openai/gpt-oss-20b",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user",   "content": user_prompt},
            ],
            temperature=0.1,
            max_tokens=2000,
        )
        raw = comp.choices[0].message.content.strip()
        raw = re.sub(r"^```[a-z]*\n?", "", raw).rstrip("`").strip()
        evaluations = json.loads(raw)

        # Hard cap — LLM can NEVER exceed threshold
        max_marks_map = {a.question_id: a.max_marks for a in request.answers}
        for ev in evaluations:
            cap = max_marks_map.get(ev["question_id"], 0)
            ev["awarded_marks"] = max(0, min(int(ev["awarded_marks"]), cap))
            ev["max_marks"] = cap

        total_awarded  = sum(ev["awarded_marks"] for ev in evaluations)
        total_possible = sum(a.max_marks for a in request.answers)

        return {
            "evaluations": evaluations,
            "total_awarded": total_awarded,
            "total_possible": total_possible,
        }
    except Exception as e:
        import traceback; print(traceback.format_exc())
        raise HTTPException(status_code=500, detail="Failed to evaluate answers.")