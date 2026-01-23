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

# Pre-compile regex patterns for better performance
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
        
        # Only skip pure section headers
        if (line.lower() in ['introduction', 'key features', 'applications', 'conclusion', 'references'] 
            and not any(word in line.lower() for word in ['define', 'what', 'list', 'explain', 'state', 'name'])):
            continue
        
        # Unnumbered questions
        if not re.match(r'^\d+\.', line) and any(word in line.lower() for word in ['define', 'what', 'list', 'explain', 'state', 'name']):
            if 10 < len(line) < 150:
                if not line.endswith('?'):
                    line += '?'
                questions.append(line)
        
        # Numbered questions
        elif re.match(r'^\d+\.', line):
            question = re.sub(r'^\d+\.\s*', '', line)
            if question and 5 < len(question) < 150:
                if not question.endswith('?'):
                    if any(word in question.lower() for word in ['define', 'list', 'what', 'explain', 'state', 'name']):
                        question += '?'
                    else:
                        question = f"What is {question}?"
                questions.append(question)
    
    # Remove duplicates
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
    """Get recent messages - optimized for performance"""
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
    """Calculate word count based on number of pages"""
    return pages * 250

def calculate_word_count_from_marks(marks: int) -> int:
    """Calculate word count based on marks"""
    return marks * 50

def create_html_table_fast(schedule_data: list, topic: str) -> str:
    """Fast HTML table creation"""
    if not schedule_data:
        return ""
    
    rows = []
    for i, row in enumerate(schedule_data):
        bg_color = "rgba(255, 255, 255, 0.05)" if i % 2 == 0 else "rgba(255, 255, 255, 0.1)"
        rows.append(f'''<tr style="background-color: {bg_color};">
<td style="border: 1px solid rgba(255, 255, 255, 0.2); padding: 10px; color: white;">{row[0]}</td>
<td style="border: 1px solid rgba(255, 255, 255, 0.2); padding: 10px; color: white;">{row[1]}</td>
<td style="border: 1px solid rgba(255, 255, 255, 0.2); padding: 10px; color: white;">{row[2]}</td>
</tr>''')
    
    return f'''<div style="margin: 20px 0;">
<h3 style="font-family: Arial, sans-serif; color: white; margin-bottom: 15px;">
Study Plan: {topic} ({len(schedule_data)} days, 2 hours/day)
</h3>
<table style="width: 100%; border-collapse: collapse; font-family: Arial, sans-serif; background-color: transparent;">
<thead>
<tr style="background-color: rgba(68, 114, 196, 0.3); color: white;">
<th style="border: 1px solid rgba(255, 255, 255, 0.3); padding: 12px; text-align: left; font-weight: 600; color: white;">Day</th>
<th style="border: 1px solid rgba(255, 255, 255, 0.3); padding: 12px; text-align: left; font-weight: 600; color: white;">Topic</th>
<th style="border: 1px solid rgba(255, 255, 255, 0.3); padding: 12px; text-align: left; font-weight: 600; color: white;">Time</th>
</tr>
</thead>
<tbody>
{''.join(rows)}
</tbody>
</table>
</div>'''

def process_schedule_with_html_table_fast(response_text: str, latest_user_msg: str) -> str:
    """Extract schedule and convert to HTML table, removing original schedule text"""
    schedule_markers = ["Schedule:", "STUDY SCHEDULE:", "Study Schedule:", "STUDY PLAN:"]
    schedule_start_idx = -1
    
    for marker in schedule_markers:
        idx = response_text.find(marker)
        if idx != -1:
            schedule_start_idx = idx
            break
    
    if schedule_start_idx == -1:
        lines = response_text.split('\n')
        for i, line in enumerate(lines):
            if 'Day 1' in line or 'Day1' in line:
                schedule_start_idx = response_text.find(line)
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
        if any(header in lower_line for header in ['day|topic|time', 'day | topic | time', '---', '===', 'schedule:', 'study schedule:', 'study plan:']):
            continue
        
        if '|' in line:
            parts = [p.strip() for p in line.split('|')]
            if len(parts) >= 3:
                day_part = parts[0]
                topic_part = parts[1]
                time_part = parts[2]
                if 'day' in day_part.lower() and topic_part:
                    schedule_lines.append([day_part, topic_part, time_part])
        
        elif re.search(r'Day\s*\d+', line, re.IGNORECASE):
            day_match = re.search(r'(Day\s*\d+)', line, re.IGNORECASE)
            if day_match:
                day_part = day_match.group(0)
                remaining = line[day_match.end():].strip()
                
                time_match = re.search(r'(\d+\s*(?:hours?|hrs?|h))', remaining, re.IGNORECASE)
                if time_match:
                    time_part = time_match.group(1)
                    topic_part = remaining[:time_match.start()].strip(' -:|')
                else:
                    time_part = '2 hours'
                    topic_part = remaining.strip(' -:|')
                
                if topic_part and len(topic_part) > 3:
                    schedule_lines.append([day_part, topic_part, time_part])
    
    if schedule_lines:
        html_table = create_html_table_fast(schedule_lines, latest_user_msg[:50])
        return f"{explanation_text}\n\n{html_table}"
    
    return response_text

def detect_mode_from_message(msg_lower: str) -> Tuple[str, int]:
    """Detect mode from a single message"""
    if any(term in msg_lower for term in ["explain in detail", "detailed", "comprehensive", "1000 words", "800 words", "16 mark", "16 marks"]):
        return "detailed", 2
    
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
    """Process detailed response without study schedule"""
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
            f"- Stay focused on the topic without adding study schedules\n"
            f"- Format as plain text with section headings in ALL CAPS\n"
            f"- NO STUDY SCHEDULE OR TIMETABLE"
        )
        
        recent_messages = get_recent_messages_fast(messages, 4)
        api_messages = [{"role": "system", "content": system_prompt}] + recent_messages
        
        client = get_groq_client()
        completion = client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=api_messages,
            temperature=0.3,
            max_tokens=min(word_count * 2, 8000),
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
            "CRITICAL RULES:\n"
            f"- Write as a CONTINUOUS ESSAY, NOT as Q&A or bullet points\n"
            f"- Aim for approximately {word_count} words\n"
            f"- Use clear section headings in regular format (not ALL CAPS)\n"
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
            temperature=0.3,
            max_tokens=min(word_count * 2, 8000),
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
        
        if is_greeting(latest_user_msg):
            return {"response": "Hello! I'm NexusAI, your intelligent assistant. How can I help you today?"}
        
        page_match = PAGE_PATTERN.search(msg_lower)
        mark_match = MARK_PATTERN.search(msg_lower)
        
        if page_match or mark_match:
            detailed_response = process_detailed_response_without_schedule(latest_user_msg, messages)
            return {"response": detailed_response}
        
        current_mode, current_point_count = detect_mode_from_message(msg_lower)
        
        if current_mode == "points":
            current_questions = extract_questions_comprehensive(latest_user_msg)
            
            if current_questions:
                system_prompt = (
                    f"EXAM MODE: EXACTLY {current_point_count} points per question. "
                    "RULES: Ultra-concise answers. Each point = 5-8 words MAX. "
                    "NO explanations. FORMAT: '1. Question text\n• Point 1.\n• Point 2.'"
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
                    max_tokens=2000,
                    stop=None
                )
                return {"response": completion.choices[0].message.content.strip()}
        
        if current_mode == "teaching":
            system_prompt = "You are NexusAI, a patient teacher. Explain simply like to a 10-year-old. Use short sentences, analogies, and examples. Avoid jargon completely."
            recent_messages = get_recent_messages_fast(messages, 4)
            api_messages = [{"role": "system", "content": system_prompt}] + recent_messages
            
            client = get_groq_client()
            completion = client.chat.completions.create(
                model="llama-3.3-70b-versatile",
                messages=api_messages,
                temperature=0.3,
                max_tokens=2000,
                stop=None
            )
            return {"response": completion.choices[0].message.content.strip()}
        
        system_prompt = (
            "You are NexusAI, a university-level academic tutor. Provide comprehensive 500-800 word explanations followed by a study schedule.\n"
            "STRUCTURE:\n"
            "1. INTRODUCTION: Brief definition (2-3 sentences)\n"
            "2. CORE CONCEPTS: Key components and how they work\n"
            "3. EXAMPLE: One concrete real-world scenario\n"
            "4. APPLICATIONS: 2-3 practical use cases\n"
            "5. KEY TAKEAWAY: Main insights\n\n"
            "STUDY SCHEDULE:\n"
            "Generate EXACTLY 14 days with topic-specific content.\n"
            "CRITICAL FORMAT REQUIREMENT - Use EXACTLY this format with pipe separators:\n"
            "Day 1|Foundational concepts|2 hours\n"
            "Day 2|Core principles|2 hours\n"
            "Day 3|Intermediate concepts|2 hours\n"
            "Day 4|Advanced features|2 hours\n"
            "Day 5|Practical applications|2 hours\n"
            "Day 6|Problem solving|2 hours\n"
            "Day 7|Review basics|2 hours\n"
            "Day 8|Specialized topics|2 hours\n"
            "Day 9|Integration|2 hours\n"
            "Day 10|Projects|2 hours\n"
            "Day 11|Optimization|2 hours\n"
            "Day 12|Advanced concepts|2 hours\n"
            "Day 13|Review practice|2 hours\n"
            "Day 14|Final assessment|2 hours\n\n"
            "CRITICAL RULES:\n"
            "- Explanation: 500-800 words MAX\n"
            "- Schedule: EXACTLY 14 lines with Day|Topic|Time format\n"
            "- MUST use pipe separators (|) for every schedule line\n"
            "- NO bullet points, NO dashes, NO colons in schedule - ONLY pipes"
        )
        
        recent_messages = get_recent_messages_fast(messages, 6)
        api_messages = [{"role": "system", "content": system_prompt}] + recent_messages
        
        client = get_groq_client()
        completion = client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=api_messages,
            temperature=0.3,
            max_tokens=3000,
            stop=None
        )
        
        raw_response = completion.choices[0].message.content.strip()
        processed_response = process_schedule_with_html_table_fast(raw_response, latest_user_msg)
        return {"response": processed_response}
        
    except Exception as e:
        import traceback
        error_details = traceback.format_exc()
        print(f"Error in chat endpoint: {str(e)}")
        print(f"Full traceback: {error_details}")
        
        raise HTTPException(
            status_code=500,
            detail=f"An error occurred while processing your request. Please try again."
        )