# Function Calling & Tool Integration Guide

## Overview

Your NexusAI system now supports **function calling** - allowing the AI to dynamically call tools to retrieve real-time data without requiring fine-tuning. This means you can feed today's updates, new documents, and knowledge base changes directly to the AI in real-time.

## Architecture

### Three Components

1. **tools_manager.py** - Defines available tools and their implementations
2. **function_calling.py** - Orchestrates function calling with the Groq API
3. **main.py** - Integrates function calling into chat endpoints

## Available Tools

The AI can automatically call these tools when needed:

### 1. search_knowledge_base
Search your knowledge base for relevant information.
- **Parameters**: `query` (string), `max_results` (int, optional)
- **Use case**: When user asks questions about knowledge base content

```json
{
  "name": "search_knowledge_base",
  "parameters": {"query": "about company policies", "max_results": 5}
}
```

### 2. search_pdf_documents
Search and extract text from PDF documents.
- **Parameters**: `query` (string), `document_type` (optional)
- **Use case**: Searching uploaded PDFs, training materials

### 3. get_company_faq
Retrieve company FAQ and procedures.
- **Parameters**: `topic` (string), `search_term` (optional)
- **Use case**: Company-specific questions about FAQs or procedures

### 4. get_today_updates
Get today's updates - **KEY for real-time knowledge injection**.
- **Parameters**: `category` (optional: documents, announcements, schedule, all)
- **Use case**: Automatically pulls fresh data for the current day

### 5. web_search
Perform web search for real-time information.
- **Parameters**: `query` (string), `num_results` (int, 1-10)
- **Use case**: Current events, real-time information
- **Requires**: GOOGLE_API_KEY and GOOGLE_CX in .env

### 6. get_file_context
Access currently uploaded/processed file context.
- **Parameters**: `section` (summary, full, first_100_chars)
- **Use case**: Working with actively processed files

## Usage Examples

### Enable Function Calling in Your Chat Endpoint

Instead of:
```python
response = chat_completion(messages, temperature=0.25)
```

Use:
```python
response = chat_completion_with_tools(
    messages=messages,
    temperature=0.25,
    file_context=_file_context,  # Pass global file context
    use_functions=True  # Enable function calling
)
```

### Example Chat Endpoint Integration

```python
@app.post("/api/chat")
async def chat(request: ChatRequest):
    messages = request.messages
    
    # Get file context for tool usage
    with _file_context_lock:
        file_ctx = _file_context.copy()
    
    # Call with function calling enabled
    response = chat_completion_with_tools(
        messages=messages,
        system_prompt="You are NexusAI...",
        temperature=0.25,
        file_context=file_ctx,
        use_functions=True
    )
    
    return {"response": response}
```

## Daily Updates - The Key Feature

This is how you feed today's updates WITHOUT fine-tuning:

### 1. Create Daily Update Files

In `Backend/` directory, create files with the pattern: `daily_updates_YYYY_MM_DD.txt`

Example:
```
Backend/daily_updates_2025_03_23.txt
```

Content format:
```
=== March 23, 2025 Updates ===

ANNOUNCEMENTS:
- New company training module released
- Updated remote work policy effective today

SCHEDULE:
- Team meeting at 2 PM
- Maintenance window 6 PM - 8 PM

NEW DOCUMENTS:
- Annual report 2025
- Q1 financial results
- Updated security guidelines
```

### 2. The AI Will Access Them Automatically

When the AI detects a user is asking about current information:
```
User: "What updates happened today?"
AI: [Calls get_today_updates tool] → Returns daily_updates_2025_03_23.txt
AI: [Provides current information without retraining]
```

### 3. Update Knowledge Base

Add to `Backend/knowledge_base.json`:
```json
{
  "documents": [
    {
      "content": "New educational policy...",
      "title": "Policy Update",
      "date": "2025-03-23"
    }
  ],
  "last_updated": "2025-03-23T14:30:00"
}
```

The AI will find and use this when relevant.

## Configuration

### In your .env file:

```env
# Existing
GROQ_API_KEY=your_key_here
GOOGLE_API_KEY=your_google_api_key    # For web search
GOOGLE_CX=your_custom_search_engine_id # For web search
```

### To enable/disable function calling:

**Enable globally** (modify main.py):
```python
chat_completion_with_tools(..., use_functions=True)
```

**Disable for specific query** (still use regular chat):
```python
chat_completion_with_tools(..., use_functions=False)
```

## Monitoring Tool Calls

The system logs every tool call. Watch your console for:

```
🔧 Tool: search_knowledge_base | Args: ['query']
   Result: {'status': 'success', 'results_count': 3, ...}
```

This helps you see what information the AI is accessing.

## Extending with Custom Tools

### Add a New Tool

1. **Define it** in `tools_manager.py`:

```python
def get_tool_definitions():
    return [
        # ... existing tools ...
        {
            "type": "function",
            "function": {
                "name": "your_new_tool",
                "description": "What this tool does",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "param1": {"type": "string", "description": "..."}
                    },
                    "required": ["param1"]
                }
            }
        }
    ]
```

2. **Implement the handler**:

```python
def your_new_tool(param1: str) -> Dict[str, Any]:
    """Your tool implementation"""
    return {"status": "success", "data": "..."}

# Register it
TOOL_HANDLERS: Dict[str, Callable] = {
    # ... existing ...
    "your_new_tool": your_new_tool,
}
```

3. **Use it** - The AI will automatically call it when appropriate!

## Real-World Workflow

### Daily Update Cycle

**Morning (9 AM):**
- Create `Backend/daily_updates_2025_03_23.txt`
- Update `Backend/knowledge_base.json` with new docs
- Restart app (or hot-reload)

**Throughout the day:**
- Users ask questions
- AI automatically calls `get_today_updates` tool
- AI provides accurate, current information
- No fine-tuning needed!

**Evening:**
- Review what tools were called (check logs)
- Plan next day's updates
- Update knowledge base as needed

## Best Practices

1. **Use descriptive tool names** - Makes logs clearer
2. **Validate tool inputs** - Prevent errors
3. **Cache responses** - Expensive tools should be cached
4. **Log everything** - Helps debug what the AI is doing
5. **Test tools independently** - Before integrating
6. **Document parameters** - Make descriptions clear

## Troubleshooting

### Tool not being called
- Check if AI has access to information without tools
- AI may not need the tool for that query
- Verify tool `description` is clear about when to use it

### Tool returning empty results
- Check file paths exist
- Verify data format matches expectations
- Add logging to tool implementation

### Function calling times out
- Some tools may be slow - this is logged
- Falls back to regular chat automatically
- Optimize slow tools or add caching

### AI not using available tools
- This is actually fine - AI is smart about when tools are needed
- If tool should be used, improve its description
- Add system prompt hint: "If you don't know, use search_knowledge_base"

## API Response Examples

### Regular Response
```json
{"response": "Here's the answer..."}
```

### Response with Tool Calls (logged internally)
```
🔧 Tool: search_knowledge_base | Args: ['query']
   Result: {'status': 'success', 'results_count': 2}
🔧 Tool: get_company_faq | Args: ['topic']  
   Result: {'status': 'success', 'results': [...]}
[Final response synthesized from tool results]
```

## Next Steps

1. **Enable function calling** in your main chat endpoint
2. **Set up git/daily automation** to create daily_updates files
3. **Monitor the logs** to see what tools the AI calls
4. **Add custom tools** specific to your domain
5. **Optimize knowledge base** - tool results are better with good data

## Example Daily Automation (with cron job)

Create `setup_daily_updates.py`:
```python
#!/usr/bin/env python
from datetime import datetime
import json

date_str = datetime.now().strftime("%Y_%m_%d")

# Fetch your latest data here
latest_data = {
    "announcements": [...],
    "schedule": [...],
    "documents": [...]
}

# Write daily updates file
with open(f"Backend/daily_updates_{date_str}.txt", "w") as f:
    f.write(f"=== {date_str} Updates ===\n\n")
    f.write(json.dumps(latest_data, indent=2))

print(f"✅ Daily updates created for {date_str}")
```

Run daily at midnight:
```bash
# In cron:
0 0 * * * cd /path/to/Backend && python setup_daily_updates.py
```

---

**Your AI now learns in real-time without fine-tuning!** 🚀
