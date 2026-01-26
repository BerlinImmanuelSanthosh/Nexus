import os
import re
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional, Tuple
from groq import Groq
from dotenv import load_dotenv
import time
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

app = FastAPI(title="NexusAI Chatbot")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:8080"],
    allow_methods=["*"],
    allow_headers=["*"],
)

class ChatRequest(BaseModel):
    messages: List[dict]

# Cache for Groq client
groq_client = None

def get_groq_client():
    """Singleton Groq client"""
    global groq_client
    if groq_client is None:
        groq_client = Groq(api_key=GROQ_API_KEY)
    return groq_client

def detect_language(text: str) -> str:
    """Detect language using Unicode ranges"""
    try:
        if re.search(r'[\u0B80-\u0BFF]', text):
            return 'ta'
        elif re.search(r'[\u0900-\u097F]', text):
            return 'hi'
        elif re.search(r'[\u0600-\u06FF]', text):
            return 'ar'
        elif re.search(r'[\u4E00-\u9FFF]', text):
            return 'zh-CN'
        elif re.search(r'[\u3040-\u309F\u30A0-\u30FF]', text):
            return 'ja'
        elif re.search(r'[\uAC00-\uD7AF]', text):
            return 'ko'
        elif re.search(r'[\u0400-\u04FF]', text):
            return 'ru'
        elif re.search(r'[\u0C00-\u0C7F]', text):
            return 'te'
        elif re.search(r'[\u0D00-\u0D7F]', text):
            return 'ml'
        elif re.search(r'[\u0980-\u09FF]', text):
            return 'bn'
        return 'en'
    except:
        return 'en'

def translate_headings(lang_code: str) -> dict:
    """Translate section headings using googletrans library - NO hardcoding"""
    if lang_code == 'en':
        return {
            'intro': 'INTRODUCTION',
            'concepts': 'CORE CONCEPTS',
            'fundamental': 'FUNDAMENTAL CONCEPTS',
            'detailed': 'DETAILED EXPLANATION',
            'example': 'EXAMPLE',
            'examples': 'REAL-WORLD EXAMPLES',
            'applications': 'APPLICATIONS',
            'advantages': 'ADVANTAGES',
            'limitations': 'LIMITATIONS',
            'conclusion': 'CONCLUSION',
            'insights': 'KEY INSIGHTS'
        }
    
    if not TRANSLATOR_AVAILABLE:
        print(f"⚠ googletrans not available, using English headings")
        return {
            'intro': 'INTRODUCTION',
            'concepts': 'CORE CONCEPTS',
            'fundamental': 'FUNDAMENTAL CONCEPTS',
            'detailed': 'DETAILED EXPLANATION',
            'example': 'EXAMPLE',
            'examples': 'REAL-WORLD EXAMPLES',
            'applications': 'APPLICATIONS',
            'advantages': 'ADVANTAGES',
            'limitations': 'LIMITATIONS',
            'conclusion': 'CONCLUSION',
            'insights': 'KEY INSIGHTS'
        }
    
    # Translate dynamically using Google Translate
    try:
        translator = Translator()
        
        english_headings = {
            'intro': 'introduction',
            'concepts': 'core concepts',
            'fundamental': 'fundamental concepts',
            'detailed': 'detailed explanation',
            'example': 'example',
            'examples': 'real world examples',
            'applications': 'applications',
            'advantages': 'advantages',
            'limitations': 'limitations',
            'conclusion': 'conclusion',
            'insights': 'key insights'
        }
        
        translated_headings = {}
        
        print(f"🔄 Translating headings to language: {lang_code}")
        
        for key, english_text in english_headings.items():
            try:
                result = translator.translate(english_text, src='en', dest=lang_code)
                if result and hasattr(result, 'text') and result.text:
                    translated_text = result.text.upper()
                    translated_headings[key] = translated_text
                    print(f"  ✓ '{english_text}' → '{translated_text}'")
                else:
                    translated_headings[key] = english_text.upper()
                    print(f"  ✗ '{english_text}' → fallback to English")
            except Exception as e:
                print(f"  ✗ Translation error for '{english_text}': {e}")
                translated_headings[key] = english_text.upper()
        
        print(f"✓ Translation complete for {lang_code}")
        return translated_headings
    except Exception as e:
        print(f"✗ Translation service error: {e}")
        return {
            'intro': 'INTRODUCTION',
            'concepts': 'CORE CONCEPTS',
            'fundamental': 'FUNDAMENTAL CONCEPTS',
            'detailed': 'DETAILED EXPLANATION',
            'example': 'EXAMPLE',
            'examples': 'REAL-WORLD EXAMPLES',
            'applications': 'APPLICATIONS',
            'advantages': 'ADVANTAGES',
            'limitations': 'LIMITATIONS',
            'conclusion': 'CONCLUSION',
            'insights': 'KEY INSIGHTS'
        }

def get_section_headings(lang_code: str) -> dict:
    """Get section headings by translating from English"""
    return translate_headings(lang_code)

# Pre-compile regex patterns
GREETING_PATTERN = re.compile(r'^\s*(hello|hi|hey|greetings|good morning|good afternoon|good evening|what\'s up|howdy|hiya)\b', re.IGNORECASE)
PAGE_PATTERN = re.compile(r'(\d+)\s*pages?\b', re.IGNORECASE)
MARK_PATTERN = re.compile(r'(\d+)\s*(?:mark|marks)\b', re.IGNORECASE)
POINT_PATTERN = re.compile(r'(\d+)\s*(?:point|points)\b', re.IGNORECASE)
GIVE_POINTS_PATTERN = re.compile(r'give\s+(\d+)\s+points?\b', re.IGNORECASE)
QUESTION_INDICATORS = re.compile(r'\b(define|what|list|explain|state|name|describe|discuss|write about)\b', re.IGNORECASE)
FOLLOWUP_INDICATORS = re.compile(r'\b(its|it\'s|that|those|these|the|this|above|previous|only|but)\b', re.IGNORECASE)

@lru_cache(maxsize=128)
def is_greeting_cached(user_message: str) -> bool:
    """Cached greeting check"""
    return bool(GREETING_PATTERN.search(user_message))

def is_greeting(user_message: str) -> bool:
    """Check if the message is a greeting"""
    return is_greeting_cached(user_message.strip())

@lru_cache(maxsize=64)
def extract_questions_comprehensive_cached(text: str) -> tuple:
    """Cached question extraction"""
    questions = []
    lines = text.split('\n')
    
    for line in lines:
        line = line.strip()
        if not line or len(line) > 200:
            continue
        
        if (line.lower() in ['introduction', 'key features', 'applications', 'conclusion', 'references'] 
            and not any(word in line.lower() for word in ['define', 'what', 'list', 'explain', 'state', 'name'])):
            continue
        
        if not re.match(r'^\d+\.', line) and any(word in line.lower() for word in ['define', 'what', 'list', 'explain', 'state', 'name']):
            if 10 < len(line) < 150:
                if not line.endswith('?'):
                    line += '?'
                questions.append(line)
        
        elif re.match(r'^\d+\.', line):
            question = re.sub(r'^\d+\.\s*', '', line)
            if question and 5 < len(question) < 150:
                if not question.endswith('?'):
                    if any(word in question.lower() for word in ['define', 'list', 'what', 'explain', 'state', 'name']):
                        question += '?'
                    else:
                        question = f"What is {question}?"
                questions.append(question)
    
    seen = set()
    unique_questions = []
    for q in questions:
        clean_q = re.sub(r'[^\w\s]', '', q.lower())
        if clean_q not in seen:
            unique_questions.append(q)
            seen.add(clean_q)
    
    return tuple(unique_questions)

def extract_questions_comprehensive(text: str) -> list:
    """Wrapper for cached question extraction"""
    return list(extract_questions_comprehensive_cached(text))

def get_recent_messages_fast(messages: List[dict], max_messages: int = 6) -> List[dict]:
    """Get recent messages"""
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
    """Calculate word count from pages"""
    return pages * 250

def calculate_word_count_from_marks(marks: int) -> int:
    """Calculate word count from marks"""
    return marks * 50

def create_html_table_fast(schedule_data: list, topic: str) -> str:
    """Create HTML table for schedule"""
    if not schedule_data:
        return ""
    
    rows = []
    for i, row in enumerate(schedule_data):
        bg_color = "rgba(255, 255, 255, 0.05)" if i % 2 == 0 else "rgba(255, 255, 255, 0.1)"
        day_text = str(row[0])
        topic_text = str(row[1])
        time_text = str(row[2])
        
        rows.append(f'''<tr style="background-color: {bg_color};">
<td style="border: 1px solid rgba(255, 255, 255, 0.2); padding: 12px; color: white; font-family: 'Segoe UI', Arial, sans-serif; white-space: normal; word-wrap: break-word;">{day_text}</td>
<td style="border: 1px solid rgba(255, 255, 255, 0.2); padding: 12px; color: white; font-family: 'Segoe UI', Arial, sans-serif; white-space: normal; word-wrap: break-word;">{topic_text}</td>
<td style="border: 1px solid rgba(255, 255, 255, 0.2); padding: 12px; color: white; font-family: 'Segoe UI', Arial, sans-serif; white-space: normal; word-wrap: break-word;">{time_text}</td>
</tr>''')
    
    topic_display = str(topic)
    
    return f'''<div style="margin: 20px 0; font-family: 'Segoe UI', Arial, sans-serif;">
<h3 style="color: white; margin-bottom: 15px; font-family: 'Segoe UI', Arial, sans-serif;">
Study Plan: {topic_display} ({len(schedule_data)} days)
</h3>
<table style="width: 100%; border-collapse: collapse; background-color: transparent; table-layout: auto;">
<thead>
<tr style="background-color: rgba(68, 114, 196, 0.3); color: white;">
<th style="border: 1px solid rgba(255, 255, 255, 0.3); padding: 12px; text-align: left; font-weight: 600; color: white; font-family: 'Segoe UI', Arial, sans-serif; width: 15%;">Day</th>
<th style="border: 1px solid rgba(255, 255, 255, 0.3); padding: 12px; text-align: left; font-weight: 600; color: white; font-family: 'Segoe UI', Arial, sans-serif; width: 65%;">Topic</th>
<th style="border: 1px solid rgba(255, 255, 255, 0.3); padding: 12px; text-align: left; font-weight: 600; color: white; font-family: 'Segoe UI', Arial, sans-serif; width: 20%;">Time</th>
</tr>
</thead>
<tbody>
{''.join(rows)}
</tbody>
</table>
</div>'''

def process_schedule_with_html_table_fast(response_text: str, latest_user_msg: str) -> str:
    """Extract schedule and convert to HTML"""
    day_patterns = [
        r'Day\s*\d+', r'நாள்\s*\d+', r'Día\s*\d+', r'Jour\s*\d+',
        r'Tag\s*\d+', r'日\s*\d+', r'\d+\s*день',
    ]
    
    schedule_markers = ["Schedule:", "STUDY SCHEDULE:", "Study Schedule:", "STUDY PLAN:", "அட்டவணை:", "Horario:"]
    schedule_start_idx = -1
    
    for marker in schedule_markers:
        idx = response_text.find(marker)
        if idx != -1:
            schedule_start_idx = idx
            break
    
    if schedule_start_idx == -1:
        lines = response_text.split('\n')
        for i, line in enumerate(lines):
            for pattern in day_patterns:
                if re.search(pattern, line):
                    schedule_start_idx = response_text.find(line)
                    break
            if schedule_start_idx != -1:
                break
    
    if schedule_start_idx == -1:
        return response_text
    
    explanation_text = response_text[:schedule_start_idx].strip()
    schedule_text = response_text[schedule_start_idx:].strip()
    
    schedule_lines = []
    lines = schedule_text.split('\n')
    
    for line in lines:
        line = line.strip()
        if not line or len(line) < 5:
            continue
        
        lower_line = line.lower()
        if any(header in lower_line for header in ['day|topic|time', 'day | topic | time', '---', '===', 'schedule:', 'study schedule:', 'study plan:', 'அட்டவணை:']):
            continue
        
        if '|' in line:
            parts = [p.strip() for p in line.split('|')]
            if len(parts) >= 3:
                day_part = parts[0]
                topic_part = parts[1]
                time_part = parts[2]
                if day_part and topic_part and len(topic_part) > 3:
                    schedule_lines.append([day_part, topic_part, time_part])
        
        else:
            day_found = False
            day_part = ""
            for pattern in day_patterns:
                day_match = re.search(pattern, line, re.IGNORECASE)
                if day_match:
                    day_part = day_match.group(0)
                    remaining = line[day_match.end():].strip()
                    day_found = True
                    
                    time_patterns = [
                        r'(\d+\s*(?:hours?|hrs?|h))', r'(\d+\s*(?:மணி நேரம்|மணி))',
                        r'(\d+\s*(?:horas?))', r'(\d+\s*(?:heures?))',
                        r'(\d+\s*(?:Stunden?))', r'(\d+\s*(?:小时|時間))',
                    ]
                    
                    time_part = '2 hours'
                    topic_part = remaining
                    
                    for time_pattern in time_patterns:
                        time_match = re.search(time_pattern, remaining, re.IGNORECASE)
                        if time_match:
                            time_part = time_match.group(1)
                            topic_part = remaining[:time_match.start()].strip(' -:|')
                            break
                    
                    if not topic_part or len(topic_part) <= 3:
                        topic_part = remaining.strip(' -:|')
                    
                    if topic_part and len(topic_part) > 3:
                        schedule_lines.append([day_part, topic_part, time_part])
                    break
            
            if not day_found:
                continue
    
    if schedule_lines:
        html_table = create_html_table_fast(schedule_lines, latest_user_msg[:50])
        return f"{explanation_text}\n\n{html_table}"
    
    return response_text

def detect_mode_from_message(msg_lower: str) -> Tuple[str, int]:
    """Detect mode from message"""
    if any(term in msg_lower for term in ["explain in detail", "detailed explanation", "comprehensive", "in depth"]):
        return "detailed_no_schedule", 2
    
    if any(term in msg_lower for term in ["teach me", "explain like", "for beginners", "simple"]):
        return "teaching", 2
    
    if "point" in msg_lower or "mark" in msg_lower:
        give_match = GIVE_POINTS_PATTERN.search(msg_lower)
        if give_match:
            return "points", int(give_match.group(1))
        
        general_match = POINT_PATTERN.search(msg_lower) or MARK_PATTERN.search(msg_lower)
        if general_match:
            return "points", int(general_match.group(1))
    
    return "detailed", 2

def process_detailed_response_without_schedule(user_message: str, messages: List[dict]) -> str:
    """Process detailed response without schedule"""
    msg_lower = user_message.lower()
    
    page_match = PAGE_PATTERN.search(msg_lower)
    if page_match:
        pages = int(page_match.group(1))
        word_count = calculate_word_count_from_pages(pages)
        
        system_prompt = (
            f"You are NexusAI, a university-level academic tutor. Provide comprehensive {word_count}-word explanation.\n"
            "STRUCTURE:\n"
            "1. INTRODUCTION: Clear definition and why it matters\n"
            "2. CORE CONCEPTS: Precise technical definitions and key components\n"
            "3. CONCRETE EXAMPLE: Specific real-world scenario\n"
            "4. TECHNICAL DETAILS: Relevant algorithms, protocols, frameworks\n"
            "5. REAL-WORLD APPLICATIONS: Specific companies/systems\n"
            "6. CHALLENGES/TRADE-OFFS: Fundamental limitations\n"
            "7. CONCLUSION: Summary of key insights\n\n"
            f"CRITICAL RULES:\n"
            f"- Write approximately {word_count} words\n"
            f"- Respond in the SAME language as the user's query (including headings)\n"
            f"- Stay focused on the topic without adding study schedules\n"
            f"- Format as plain text with section headings\n"
            f"- NO STUDY SCHEDULE OR TIMETABLE\n"
            f"- Provide expert-level depth with specific examples and data"
        )
        
        recent_messages = get_recent_messages_fast(messages, 4)
        api_messages = [{"role": "system", "content": system_prompt}] + recent_messages
        
        client = get_groq_client()
        completion = client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=api_messages,
            temperature=0.2,
            max_tokens=min(word_count * 2, 8000),
            top_p=0.95,
            stop=None
        )
        return completion.choices[0].message.content.strip()
    
    mark_match = MARK_PATTERN.search(msg_lower)
    if mark_match:
        marks = int(mark_match.group(1))
        word_count = calculate_word_count_from_marks(marks)
        
        system_prompt = (
            f"You are NexusAI, a university-level academic tutor. This is a SINGLE QUESTION worth {marks} marks.\n"
            f"Provide a comprehensive, continuous essay-style answer of approximately {word_count} words.\n\n"
            "MANDATORY STRUCTURE (continuous essay format, NOT Q&A):\n"
            "1. Introduction: Define the topic, its importance, and historical context\n"
            "2. Need/Motivation: Explain why this topic/concept is needed and problems it solves\n"
            "3. Objectives: List main goals and objectives of the topic\n"
            "4. Components/Architecture: Explain key components and how they work together\n"
            "5. Terminology: Define important terms and concepts\n"
            "6. Working/Process: Explain how it works with step-by-step details\n"
            "7. Security/Technical Mechanisms: Explain technical aspects and security features\n"
            "8. Features: List and explain key features\n"
            "9. Advantages: Discuss benefits and advantages\n"
            "10. Limitations/Disadvantages: Discuss drawbacks and limitations\n"
            "11. Applications: Provide real-world use cases and applications\n"
            "12. Versions/Evolution: If applicable, discuss different versions or evolution\n"
            "13. Conclusion: Summarize key points and future outlook\n\n"
            f"CRITICAL RULES:\n"
            f"- Write as a CONTINUOUS ESSAY, NOT as Q&A or bullet points\n"
            f"- Respond in the SAME language as the user's query (including all headings)\n"
            f"- Aim for approximately {word_count} words\n"
            f"- Use clear section headings in the query's language\n"
            f"- Include detailed explanations with examples where relevant\n"
            f"- Ensure smooth transitions between sections\n"
            f"- NO ANSWER KEY, NO MARKS ALLOCATION section\n"
            f"- Do NOT include study schedules or timetables\n"
            f"- Write in academic, professional tone"
        )
        
        recent_messages = get_recent_messages_fast(messages, 4)
        api_messages = [{"role": "system", "content": system_prompt}] + recent_messages
        
        client = get_groq_client()
        completion = client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=api_messages,
            temperature=0.2,
            max_tokens=min(word_count * 2, 8000),
            top_p=0.95,
            stop=None
        )
        return completion.choices[0].message.content.strip()

@app.post("/api/chat")
async def chat(request: ChatRequest):
    try:
        messages = request.messages
        if not messages:
            raise HTTPException(status_code=400, detail="No messages provided")
        
        latest_user_msg = messages[-1]["content"]
        msg_lower = latest_user_msg.lower()
        
        detected_lang = detect_language(latest_user_msg)
        headings = get_section_headings(detected_lang)
        
        if is_greeting(latest_user_msg):
            return {"response": "Hello! I'm NexusAI, your intelligent assistant. How can I help you today?"}
        
        page_match = PAGE_PATTERN.search(msg_lower)
        mark_match = MARK_PATTERN.search(msg_lower)
        
        if page_match or mark_match:
            detailed_response = process_detailed_response_without_schedule(latest_user_msg, messages)
            return {"response": detailed_response}
        
        current_mode, current_point_count = detect_mode_from_message(msg_lower)
        
        if current_mode == "detailed_no_schedule":
            system_prompt = (
                f"You are NexusAI, a university-level academic expert. Provide COMPREHENSIVE, IN-DEPTH explanation of 1200-1500 words.\n\n"
                f"CRITICAL LANGUAGE RULE:\n"
                f"- User query is in '{detected_lang}' language\n"
                f"- Respond 100% in '{detected_lang}' language - EVERYTHING including headings\n"
                f"- DO NOT use English headings\n"
                f"- MANDATORY: Use ONLY these headings:\n"
                f"  1. {headings['intro']}\n"
                f"  2. {headings['fundamental']}\n"
                f"  3. {headings['detailed']}\n"
                f"  4. {headings['examples']}\n"
                f"  5. {headings['applications']}\n"
                f"  6. {headings['advantages']}\n"
                f"  7. {headings['limitations']}\n"
                f"  8. {headings['conclusion']}\n\n"
                f"CRITICAL: Write ENTIRELY in '{detected_lang}' language. Copy provided headings EXACTLY."
            )
            
            recent_messages = get_recent_messages_fast(messages, 4)
            api_messages = [{"role": "system", "content": system_prompt}] + recent_messages
            
            client = get_groq_client()
            completion = client.chat.completions.create(
                model="llama-3.3-70b-versatile",
                messages=api_messages,
                temperature=0.2,
                max_tokens=6000,
                top_p=0.95,
                stop=None
            )
            return {"response": completion.choices[0].message.content.strip()}
        
        if current_mode == "points":
            current_questions = extract_questions_comprehensive(latest_user_msg)
            
            if current_questions:
                system_prompt = (
                    f"EXAM MODE: EXACTLY {current_point_count} points per question. "
                    f"Respond in '{detected_lang}' language. "
                    f"Ultra-concise. Each point = 5-8 words MAX."
                )
                questions_text = "\n".join([f"{i+1}. {q}" for i, q in enumerate(current_questions)])
                api_messages = [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": f"{current_point_count} points each:\n{questions_text}"}
                ]
                
                client = get_groq_client()
                completion = client.chat.completions.create(
                    model="llama-3.3-70b-versatile",
                    messages=api_messages,
                    temperature=0.1,
                    max_tokens=2500,
                    top_p=0.85,
                    stop=None
                )
                return {"response": completion.choices[0].message.content.strip()}
        
        if current_mode == "teaching":
            system_prompt = (
                f"You are NexusAI, a patient teacher. "
                f"Respond in '{detected_lang}' language. "
                f"Use simple language and analogies."
            )
            recent_messages = get_recent_messages_fast(messages, 4)
            api_messages = [{"role": "system", "content": system_prompt}] + recent_messages
            
            client = get_groq_client()
            completion = client.chat.completions.create(
                model="llama-3.3-70b-versatile",
                messages=api_messages,
                temperature=0.4,
                max_tokens=2000,
                top_p=0.9,
                stop=None
            )
            return {"response": completion.choices[0].message.content.strip()}
        
        system_prompt = (
            f"You are NexusAI. Provide 600-800 word explanation followed by study schedule.\n"
            f"Respond in '{detected_lang}' language.\n"
            f"Use headings: {headings['intro']}, {headings['concepts']}, {headings['example']}, {headings['applications']}, {headings['insights']}\n"
            f"Then 14-day schedule with pipe format: Day 1|Topic|2 hours"
        )
        
        recent_messages = get_recent_messages_fast(messages, 6)
        api_messages = [{"role": "system", "content": system_prompt}] + recent_messages
        
        client = get_groq_client()
        completion = client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=api_messages,
            temperature=0.25,
            max_tokens=5000,
            top_p=0.92,
            stop=None
        )
        
        raw_response = completion.choices[0].message.content.strip()
        processed_response = process_schedule_with_html_table_fast(raw_response, latest_user_msg)
        return {"response": processed_response}
        
    except Exception as e:
        import traceback
        error_details = traceback.format_exc()
        print(f"Error: {str(e)}")
        print(f"Traceback: {error_details}")
        
        raise HTTPException(status_code=500, detail="An error occurred. Please try again.")