import os
import re
import requests
from fastapi import FastAPI, HTTPException
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

load_dotenv()
GROQ_API_KEY = os.getenv("GROQ_API_KEY")
if not GROQ_API_KEY:
    raise RuntimeError("Missing GROQ_API_KEY in .env")

GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY", "")
GOOGLE_CX      = os.getenv("GOOGLE_CX", "")

app = FastAPI(title="NexusAI Chatbot")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:8080"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Models ──────────────────────────────────────────────────────────────────
class ChatRequest(BaseModel):
    messages: List[dict]

class SimpleTeachRequest(BaseModel):
    topic: str
    language: str = "en"
    previous_response: str = ""   # the full AI answer already shown to the user

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
    """
    Remove artefacts the LLM sometimes adds:
      • ![alt](url)  markdown image tags  → deleted
      • ## Heading   markdown headings    → converted to plain ALL-CAPS
    """
    text = re.sub(r'!\[[^\]]*\]\([^\)]*\)', '', text)          # strip markdown images
    text = re.sub(r'^#{1,6}\s+(.+)$', lambda m: m.group(1).upper(), text, flags=re.MULTILINE)
    return text.strip()


# ════════════════════════════════════════════════════════════════════════════
#  HELPERS: image search
#  Key fix: derive the Google Image query from the AI's OWN response text,
#  not from the raw user message  →  relevant images every time.
# ════════════════════════════════════════════════════════════════════════════

def extract_image_query_from_ai_response(ai_response_text: str) -> str:
    """
    Ask the LLM to read the first ~500 chars of its own answer and produce
    a precise 3-5 word Google Image search query for a diagram of that topic.
    e.g.  user: "kerberos"  →  AI answer about TGT/KDC
          query returned   →  "Kerberos ticket granting diagram"
    """
    try:
        plain = re.sub(r'<[^>]+>', ' ', ai_response_text)[:500].strip()
        if len(plain) < 20:
            return ""
        comp = get_groq_client().chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are a search-query assistant. "
                        "Read the educational text and reply with ONLY "
                        "a 3-5 word Google Image search query that finds "
                        "the best diagram or illustration for the topic. "
                        "No punctuation, no explanation – just the query words."
                    )
                },
                {"role": "user", "content": plain}
            ],
            temperature=0.0,
            max_tokens=15,
        )
        query = re.sub(r'["\'\n\r]', '', comp.choices[0].message.content.strip())
        print(f"🔍 Image query from AI response: '{query}'")
        return query if len(query) > 3 else ""
    except Exception as e:
        print(f"⚠ extract_image_query error: {e}")
        return ""


def search_google_images(query: str, num_results: int = 1) -> List[str]:
    if not GOOGLE_API_KEY or not GOOGLE_CX:
        print("⚠ Google API credentials not configured")
        return []
    try:
        clean_q = re.sub(r'[?.,!]', '', query).strip()
        if len(clean_q) < 3:
            return []
        r = requests.get(
            "https://www.googleapis.com/customsearch/v1",
            params={
                'q': clean_q, 'cx': GOOGLE_CX, 'key': GOOGLE_API_KEY,
                'searchType': 'image', 'num': num_results,
                'imgSize': 'medium', 'safe': 'active'
            },
            timeout=5
        )
        if r.status_code == 200:
            data = r.json()
            if 'items' in data:
                return [item['link'] for item in data['items']]
        return []
    except Exception as e:
        print(f"⚠ Image search error: {e}")
        return []


def get_image_for_ai_response(ai_response_text: str) -> str:
    query = extract_image_query_from_ai_response(ai_response_text)
    if not query:
        return ""
    urls = search_google_images(query, 1)
    return urls[0] if urls else ""


def should_show_image(user_message: str) -> bool:
    msg_lower = user_message.lower()
    if is_greeting(user_message):
        return False
    if any(t in msg_lower for t in [
        "show image", "show picture", "show diagram",
        "image of", "picture of", "diagram of", "visual of", "show me"
    ]):
        return True
    visual_topics = [
        "architecture", "diagram", "flowchart", "graph", "chart",
        "structure", "component", "layout", "design", "model",
        "network", "topology", "interface", "screenshot", "example"
    ]
    return any(t in msg_lower for t in visual_topics)


def create_html_with_image(text_response: str, image_url: str, topic: str) -> str:
    if not image_url or '<img' in text_response:
        return text_response
    image_html = f'''
<div style="margin:20px 0;text-align:center;">
    <img src="{image_url}" alt="{topic}"
         style="max-width:100%;max-height:400px;border-radius:8px;box-shadow:0 4px 8px rgba(0,0,0,0.2);"
         onerror="this.parentElement.style.display='none'">
    <p style="color:#888;font-size:12px;margin-top:5px;">Related image: {topic}</p>
</div>'''
    if text_response.strip().startswith('<'):
        lines = text_response.split('\n')
        if len(lines) > 3:
            return '\n'.join(lines[:2]) + '\n' + image_html + '\n' + '\n'.join(lines[2:])
        return image_html + '\n' + text_response
    return f'''<div style="font-family:'Segoe UI',Arial,sans-serif;color:white;">
{image_html}
<div style="white-space:pre-wrap;">{text_response}</div>
</div>'''


# ════════════════════════════════════════════════════════════════════════════
#  HELPERS: language / headings
# ════════════════════════════════════════════════════════════════════════════

# Map googletrans language codes → display names used in system prompts
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
    """
    Detect language using Unicode ranges ONLY for native scripts.
    Pure latin/romanized text → always returns 'en' (default English).
    Language only switches when user actually types in a non-English script
    OR explicitly asks e.g. 'explain in Tamil'.
    """
    try:
        if re.search(r'[\u0B80-\u0BFF]', text): return 'ta'   # Tamil script
        if re.search(r'[\u0900-\u097F]', text): return 'hi'   # Hindi/Devanagari
        if re.search(r'[\u0600-\u06FF]', text): return 'ar'   # Arabic
        if re.search(r'[\u4E00-\u9FFF]', text): return 'zh-CN'# Chinese
        if re.search(r'[\u3040-\u309F\u30A0-\u30FF]', text): return 'ja'  # Japanese
        if re.search(r'[\uAC00-\uD7AF]', text): return 'ko'   # Korean
        if re.search(r'[\u0400-\u04FF]', text): return 'ru'   # Russian/Cyrillic
        if re.search(r'[\u0C00-\u0C7F]', text): return 'te'   # Telugu
        if re.search(r'[\u0D00-\u0D7F]', text): return 'ml'   # Malayalam
        if re.search(r'[\u0980-\u09FF]', text): return 'bn'   # Bengali
        # Everything else (English, romanized any language) → English
        return 'en'
    except:
        return 'en'


# Map of explicit language keywords the user might type in their message
EXPLICIT_LANG_KEYWORDS = {
    'tamil': 'ta', 'தமிழ்': 'ta',
    'hindi': 'hi', 'हिंदी': 'hi',
    'telugu': 'te', 'తెలుగు': 'te',
    'malayalam': 'ml', 'മലയാളം': 'ml',
    'kannada': 'kn', 'ಕನ್ನಡ': 'kn',
    'bengali': 'bn', 'বাংলা': 'bn',
    'marathi': 'mr', 'मराठी': 'mr',
    'gujarati': 'gu', 'ગુજરાતી': 'gu',
    'punjabi': 'pa', 'ਪੰਜਾਬੀ': 'pa',
    'urdu': 'ur', 'اردو': 'ur',
    'arabic': 'ar', 'french': 'fr',
    'german': 'de', 'spanish': 'es',
    'italian': 'it', 'portuguese': 'pt',
    'russian': 'ru', 'chinese': 'zh-CN',
    'japanese': 'ja', 'korean': 'ko',
    'turkish': 'tr', 'dutch': 'nl',
}


def process_user_input(text: str) -> tuple:
    """
    Determines what language to respond in and what query to send to the LLM.

    Rules:
      1. If the user typed in a NON-ENGLISH SCRIPT (Tamil characters, Arabic, etc.)
         → translate to English for LLM, respond in that script's language.
      2. If the user EXPLICITLY REQUESTED a language
         e.g. "explain python in tamil" / "python tamil la sollu"
         → keep the query as-is for LLM, respond in the requested language.
      3. Everything else (pure English, romanized text like "solli kudu")
         → respond in English as normal.

    Returns: (query_for_llm: str, response_lang_code: str)
    """
    lang_code = detect_language(text)

    # Rule 1: Native non-English script detected → translate query to English
    if lang_code != 'en' and TRANSLATOR_AVAILABLE:
        try:
            translator = Translator()
            translated = translator.translate(text, src=lang_code, dest='en')
            if translated and translated.text:
                english_query = translated.text.strip()
                print(f"🌐 Native script: '{text}' ({lang_code}) → '{english_query}'")
                return english_query, lang_code
        except Exception as e:
            print(f"⚠ Translation error: {e}")
        return text, lang_code

    # Rule 2: User explicitly asked for a specific language in plain text
    # e.g. "explain python in tamil" or "python tamil la explain pannu"
    text_lower = text.lower()
    for keyword, code in EXPLICIT_LANG_KEYWORDS.items():
        if keyword in text_lower:
            print(f"🌐 Explicit language request: '{keyword}' → respond in '{code}'")
            return text, code

    # Rule 3: Default → English
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
QUESTION_INDICATORS = re.compile(r'\b(define|what|list|explain|state|name|describe|discuss|write about|show|image|picture|diagram)\b', re.IGNORECASE)
FOLLOWUP_INDICATORS = re.compile(r'\b(its|it\'s|that|those|these|the|this|above|previous|only|but)\b', re.IGNORECASE)


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
#  HELPERS: mode detection and pages/marks responses
# ════════════════════════════════════════════════════════════════════════════

def detect_mode_from_message(msg_lower: str) -> Tuple[str, int]:
    if any(t in msg_lower for t in ["explain in detail","detailed explanation","comprehensive","in depth"]):
        return "detailed_no_schedule", 2
    if any(t in msg_lower for t in ["teach me","explain like","for beginners","simple"]):
        return "teaching", 2
    if "point" in msg_lower or "mark" in msg_lower:
        gm = GIVE_POINTS_PATTERN.search(msg_lower)
        if gm: return "points", int(gm.group(1))
        gn = POINT_PATTERN.search(msg_lower) or MARK_PATTERN.search(msg_lower)
        if gn: return "points", int(gn.group(1))
    return "detailed", 2


def process_detailed_response_without_schedule(user_message: str, messages: List[dict]) -> str:
    msg_lower  = user_message.lower()
    page_match = PAGE_PATTERN.search(msg_lower)
    if page_match:
        pages      = int(page_match.group(1))
        word_count = calculate_word_count_from_pages(pages)
        system_prompt = (
            f"You are NexusAI, a university-level academic tutor. "
            f"Provide a comprehensive ~{word_count}-word explanation.\n"
            "STRUCTURE: INTRODUCTION, CORE CONCEPTS, CONCRETE EXAMPLE, "
            "TECHNICAL DETAILS, REAL-WORLD APPLICATIONS, CHALLENGES/TRADE-OFFS, CONCLUSION.\n"
            "RULES: Plain ALL-CAPS headings (NO ## markdown). "
            "Same language as user. NO study schedule. NO markdown image tags."
        )
        recent = get_recent_messages_fast(messages, 4)
        comp = get_groq_client().chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[{"role":"system","content":system_prompt}] + recent,
            temperature=0.2, max_tokens=min(word_count * 2, 8000), top_p=0.95,
        )
        return clean_llm_response(comp.choices[0].message.content.strip())

    mark_match = MARK_PATTERN.search(msg_lower)
    if mark_match:
        marks      = int(mark_match.group(1))
        word_count = calculate_word_count_from_marks(marks)
        system_prompt = (
            f"You are NexusAI. Answer this {marks}-mark question as a continuous ~{word_count}-word essay.\n"
            "Cover: Introduction, Need/Motivation, Objectives, Components/Architecture, Terminology, "
            "Working/Process, Security/Technical Mechanisms, Features, Advantages, Limitations, "
            "Applications, Versions/Evolution, Conclusion.\n"
            "RULES: Continuous essay, NOT Q&A. Plain ALL-CAPS headings (NO ## symbols). "
            "Same language as user. NO study schedule. NO markdown image tags."
        )
        recent = get_recent_messages_fast(messages, 4)
        comp = get_groq_client().chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[{"role":"system","content":system_prompt}] + recent,
            temperature=0.2, max_tokens=min(word_count * 2, 8000), top_p=0.95,
        )
        return clean_llm_response(comp.choices[0].message.content.strip())


# ════════════════════════════════════════════════════════════════════════════
#  ENDPOINT: /api/teach-simple
#
#  Triggered when the user CLICKS a message bubble in the UI.
#  Goal: give a SHORT 300-400 word simple recap — completely different from
#        the full 1000-word chat answer the user already saw.
#  Rules:
#    • 300-400 words MAX
#    • No timetable / no schedule
#    • Plain language — imagine explaining to a friend in 2 minutes
#    • Different angle: focus on "what it is + why it matters + one example"
# ════════════════════════════════════════════════════════════════════════════

@app.post("/api/teach-simple")
async def teach_simple(request: SimpleTeachRequest):
    try:
        topic             = request.topic
        language          = request.language
        previous_response = request.previous_response.strip()

        # ── Strategy ────────────────────────────────────────────────────────
        # If the frontend passes the full AI answer that was already shown,
        # we COMPRESS it into a short summary so it is guaranteed to be
        # different (shorter, simpler) rather than generating fresh content
        # that ends up being the same length/style.
        # ────────────────────────────────────────────────────────────────────

        if previous_response:
            # Strip HTML tags so the LLM sees plain text
            plain_prev = re.sub(r'<[^>]+>', ' ', previous_response)
            # Trim to first 3000 chars to stay within context safely
            plain_prev = plain_prev[:3000].strip()

            system_prompt = (
                f"You are NexusAI. The user just read a long detailed explanation about '{topic}'. "
                f"They clicked to get a SHORTER, SIMPLER version.\n\n"
                f"Your job: read the detailed explanation below and rewrite it as a "
                f"SHORT SIMPLE SUMMARY of strictly 300-400 words.\n\n"
                f"STRICT RULES:\n"
                f"- Output ONLY 300 to 400 words. Stop after 400 words no matter what.\n"
                f"- Use simple everyday language — no jargon.\n"
                f"- Follow this exact 4-part structure with plain ALL-CAPS labels:\n"
                f"  WHAT IS IT\n"
                f"  HOW IT WORKS\n"
                f"  REAL EXAMPLE\n"
                f"  WHY IT MATTERS\n"
                f"- NO timetable, NO study schedule, NO bullet study plans.\n"
                f"- NO markdown ## symbols.\n"
                f"- NO markdown image tags.\n"
                f"- Respond in '{language}' language.\n\n"
                f"DETAILED EXPLANATION TO SUMMARIZE:\n"
                f"{plain_prev}"
            )
            user_msg = f"Please give me the short simple version of the above explanation about {topic}."
        else:
            # Fallback: no previous response sent — generate a short answer fresh
            system_prompt = (
                f"You are NexusAI. Explain '{topic}' in a SHORT SIMPLE way.\n\n"
                f"STRICT RULES:\n"
                f"- Output ONLY 300 to 400 words. Stop after 400 words.\n"
                f"- Use simple everyday language.\n"
                f"- Follow this exact 4-part structure with plain ALL-CAPS labels:\n"
                f"  WHAT IS IT\n"
                f"  HOW IT WORKS\n"
                f"  REAL EXAMPLE\n"
                f"  WHY IT MATTERS\n"
                f"- NO timetable, NO schedule, NO bullet study plans.\n"
                f"- NO markdown ## symbols.\n"
                f"- NO markdown image tags.\n"
                f"- Respond in '{language}' language."
            )
            user_msg = f"Explain {topic} simply in 300-400 words."

        comp = get_groq_client().chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user",   "content": user_msg}
            ],
            temperature=0.3,
            max_tokens=550,   # hard token cap — forces short output
            top_p=0.9,
        )
        response_text = clean_llm_response(comp.choices[0].message.content.strip())

        # Image based on AI response content
        if should_show_image(topic):
            image_url = get_image_for_ai_response(response_text)
            if image_url:
                return {"response": create_html_with_image(response_text, image_url, topic)}

        return {"response": response_text}

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
            f"Extremely simple words, fun analogies with toys/animals/food. "
            f"Short sentences (max 10 words each). ~200-300 words total. "
            f"Respond in {language}. End with a fun fact or curious question. "
            f"NO ## symbols. NO markdown image tags."
        )
        comp = get_groq_client().chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user",   "content": f"Explain {topic} like I'm 5 years old!"}
            ],
            temperature=0.6,
            max_tokens=600,
            top_p=0.95,
        )
        response_text = clean_llm_response(comp.choices[0].message.content.strip())

        image_url = get_image_for_ai_response(response_text)
        if image_url:
            image_html = f'''
<div style="margin:20px 0;text-align:center;">
    <img src="{image_url}" alt="{topic}"
         style="max-width:100%;max-height:300px;border-radius:12px;
                box-shadow:0 4px 12px rgba(0,0,0,0.3);border:3px solid #ffaa00;"
         onerror="this.parentElement.style.display='none'">
    <p style="color:#ffaa00;font-size:14px;margin-top:8px;font-weight:bold;">
        ✨ Look at this picture of {topic}! ✨
    </p>
</div>'''
            return {"response": image_html + f'<div style="font-family:Arial,sans-serif;color:white;font-size:18px;line-height:1.6;">{response_text}</div>'}

        return {"response": response_text}

    except Exception as e:
        import traceback; print(traceback.format_exc())
        raise HTTPException(status_code=500, detail="An error occurred. Please try again.")


# ════════════════════════════════════════════════════════════════════════════
#  ENDPOINT: /api/chat  (main)
#
#  Default mode: ~1000-word detailed explanation  WITH  14-day timetable
# ════════════════════════════════════════════════════════════════════════════

@app.post("/api/chat")
async def chat(request: ChatRequest):
    try:
        messages = request.messages
        if not messages:
            raise HTTPException(status_code=400, detail="No messages provided")

        latest_user_msg = messages[-1]["content"]

        # ── Mixed / romanized language detection ─────────────────────────────
        # e.g. "Emaku python solli kudu" → english_query="Tell me about Python",
        #       detected_lang="ta"  →  LLM responds in Tamil
        english_query, detected_lang = process_user_input(latest_user_msg)

        # If the user wrote in a non-English / romanized language, swap the
        # message content we pass to the LLM with the English translation so
        # the LLM correctly understands the request, but we still tell it to
        # respond in the user's original language.
        if english_query != latest_user_msg:
            messages = messages[:-1] + [{"role": "user", "content": english_query}]

        msg_lower = english_query.lower()
        headings  = get_section_headings(detected_lang)

        # ── Greeting ────────────────────────────────────────────────────────
        if is_greeting(latest_user_msg):
            return {"response": "Hello! I'm NexusAI, your intelligent assistant. How can I help you today?"}

        # ── Pages / Marks ────────────────────────────────────────────────────
        page_match = PAGE_PATTERN.search(msg_lower)
        mark_match = MARK_PATTERN.search(msg_lower)
        if page_match or mark_match:
            response_text = process_detailed_response_without_schedule(latest_user_msg, messages)
            if should_show_image(latest_user_msg):
                image_url = get_image_for_ai_response(response_text)
                if image_url:
                    return {"response": create_html_with_image(response_text, image_url, latest_user_msg)}
            return {"response": response_text}

        current_mode, current_point_count = detect_mode_from_message(msg_lower)

        # ── Detailed no schedule ─────────────────────────────────────────────
        if current_mode == "detailed_no_schedule":
            system_prompt = (
                f"You are NexusAI, a university-level academic expert. "
                f"Provide a COMPREHENSIVE 1200-1500 word explanation.\n"
                f"Language: '{detected_lang}' — ALL content including headings.\n"
                f"Plain ALL-CAPS headings (NO ## markdown):\n"
                f"  {headings['intro']}, {headings['fundamental']}, {headings['detailed']},\n"
                f"  {headings['examples']}, {headings['applications']},\n"
                f"  {headings['advantages']}, {headings['limitations']}, {headings['conclusion']}\n"
                f"NO timetable. NO markdown image tags."
            )
            recent = get_recent_messages_fast(messages, 4)
            comp = get_groq_client().chat.completions.create(
                model="llama-3.3-70b-versatile",
                messages=[{"role":"system","content":system_prompt}] + recent,
                temperature=0.2, max_tokens=6000, top_p=0.95,
            )
            response_text = clean_llm_response(comp.choices[0].message.content.strip())
            if should_show_image(latest_user_msg):
                image_url = get_image_for_ai_response(response_text)
                if image_url:
                    return {"response": create_html_with_image(response_text, image_url, latest_user_msg)}
            return {"response": response_text}

        # ── Points ───────────────────────────────────────────────────────────
        if current_mode == "points":
            current_questions = extract_questions_comprehensive(latest_user_msg)
            if current_questions:
                system_prompt = (
                    f"EXAM MODE: EXACTLY {current_point_count} points per question. "
                    f"Language: '{detected_lang}'. 5-8 words per point. "
                    f"NO ## symbols. NO image tags."
                )
                questions_text = "\n".join([f"{i+1}. {q}" for i, q in enumerate(current_questions)])
                comp = get_groq_client().chat.completions.create(
                    model="llama-3.3-70b-versatile",
                    messages=[
                        {"role":"system","content":system_prompt},
                        {"role":"user","content":f"{current_point_count} points each:\n{questions_text}"}
                    ],
                    temperature=0.1, max_tokens=2500, top_p=0.85,
                )
                response_text = clean_llm_response(comp.choices[0].message.content.strip())
                if should_show_image(latest_user_msg):
                    image_url = get_image_for_ai_response(response_text)
                    if image_url:
                        return {"response": create_html_with_image(response_text, image_url, latest_user_msg)}
                return {"response": response_text}

        # ── Teaching ─────────────────────────────────────────────────────────
        if current_mode == "teaching":
            system_prompt = (
                f"You are NexusAI, a patient teacher. "
                f"Language: '{detected_lang}'. Simple language and analogies. "
                f"NO ## symbols. NO image tags."
            )
            recent = get_recent_messages_fast(messages, 4)
            comp = get_groq_client().chat.completions.create(
                model="llama-3.3-70b-versatile",
                messages=[{"role":"system","content":system_prompt}] + recent,
                temperature=0.4, max_tokens=2000, top_p=0.9,
            )
            response_text = clean_llm_response(comp.choices[0].message.content.strip())
            if should_show_image(latest_user_msg):
                image_url = get_image_for_ai_response(response_text)
                if image_url:
                    return {"response": create_html_with_image(response_text, image_url, latest_user_msg)}
            return {"response": response_text}

        # ── DEFAULT: ~1000-word explanation  +  14-day timetable ─────────────
        system_prompt = (
            f"You are NexusAI. Provide a detailed ~1000-word explanation of the topic "
            f"followed by a 14-day study schedule.\n\n"
            f"Language: '{detected_lang}'.\n\n"
            f"EXPLANATION STRUCTURE — use these plain ALL-CAPS headings (NO ## markdown):\n"
            f"  {headings['intro']}\n"
            f"  {headings['concepts']}\n"
            f"  {headings['example']}\n"
            f"  {headings['applications']}\n"
            f"  {headings['insights']}\n\n"
            f"After the explanation, add a 14-day study schedule in this EXACT pipe format:\n"
            f"STUDY SCHEDULE:\n"
            f"Day 1|Topic name here|2 hours\n"
            f"Day 2|Topic name here|2 hours\n"
            f"... and so on for all 14 days.\n\n"
            f"NO markdown image tags. NO ## symbols."
        )
        recent = get_recent_messages_fast(messages, 6)
        comp = get_groq_client().chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[{"role":"system","content":system_prompt}] + recent,
            temperature=0.25, max_tokens=6000, top_p=0.92,
        )
        raw_response       = clean_llm_response(comp.choices[0].message.content.strip())
        processed_response = process_schedule_with_html_table_fast(raw_response, latest_user_msg)

        if should_show_image(latest_user_msg):
            image_url = get_image_for_ai_response(raw_response)
            if image_url:
                return {"response": create_html_with_image(processed_response, image_url, latest_user_msg)}

        return {"response": processed_response}

    except Exception as e:
        import traceback; print(traceback.format_exc())
        raise HTTPException(status_code=500, detail="An error occurred. Please try again.")