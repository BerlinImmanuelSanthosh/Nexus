# Function Calling - Quick Start Guide

## ✅ Setup Complete

Your NexusAI system now has **function calling enabled**! The AI can automatically call tools to access real-time data without fine-tuning.

## What Was Added

### 3 New Files in `Backend/`:

1. **tools_manager.py** - Defines 6 available tools
   - `search_knowledge_base` - Search your knowledge base
   - `search_pdf_documents` - Search uploaded PDFs  
   - `get_company_faq` - Company FAQ/procedures
   - `get_today_updates` - ⭐ TODAY'S UPDATES (key feature!)
   - `web_search` - Real-time web search
   - `get_file_context` - Access uploaded files

2. **function_calling.py** - Orchestrates tool calls with Groq API
   - Handles the AI requesting tools
   - Processes tool results
   - Integrates results back into conversation

3. **main.py** (updated)
   - Added imports for function calling
   - Added `chat_completion_with_tools()` function
   - Ready to integrate into endpoints

### Documentation Files:

- **FUNCTION_CALLING_GUIDE.md** - Complete reference guide
- **INTEGRATION_EXAMPLES.py** - Code examples for 4 different integration approaches
- **test_function_calling.py** - Test script (all 7 tests ✓ passing)

## Quick Start - 3 Steps

### Step 1: Enable Function Calling in Your Chat Endpoint

Find your `/api/chat` endpoint in `main.py` and change:

```python
# OLD:
response = chat_completion(messages, temperature=0.25)

# NEW:
with _file_context_lock:
    file_ctx = _file_context.copy()

response = chat_completion_with_tools(
    messages=messages,
    temperature=0.25,
    file_context=file_ctx,
    use_functions=True
)
```

### Step 2: Feed Today's Updates

Create a daily updates file in `Backend/`:

**File:** `daily_updates_2025_03_23.txt`

```
=== Today's Updates ===

NEW DOCUMENTS:
- Q1 financial results
- Updated training material

ANNOUNCEMENTS:
- New remote work policy
- Team building event at 3 PM

SCHEDULE:
- Maintenance window 6-8 PM
- Client call at 2 PM
```

### Step 3: Test It

Ask the AI about today:
```
User: "What's new today?"
AI: [Calls get_today_updates tool] 
    → Reads daily_updates_2025_03_23.txt
    → Provides current information
```

## The Magic 🎯

**Before Function Calling:**
- Q: "What happened today?"
- A: "I don't have real-time information..."
- ❌ Need to fine-tune with new data

**After Function Calling:**
- Q: "What happened today?"
- A: [Automatically calls get_today_updates]
    → Returns today's file content
    → Provides accurate answer
- ✅ No fine-tuning needed!

## Integration Approaches

### Simple (Recommended for Now)
```python
response = chat_completion_with_tools(
    messages=messages,
    use_functions=True  # Enable tools
)
```

### Smart Routing (Optimize Performance)  
```python
# Only use tools when asking about current/new info
should_use_tools = any(
    kw in latest_msg.lower() 
    for kw in ['today', 'update', 'new', 'current', 'latest']
)

response = chat_completion_with_tools(
    messages=messages,
    use_functions=should_use_tools  # Conditional
)
```

### New Endpoint (Keep Old One Intact)
```python
@app.post("/api/chat/smart")
async def chat_with_tools(request: ChatRequest):
    return chat_completion_with_tools(
        messages=request.messages,
        use_functions=True
    )
```

See `INTEGRATION_EXAMPLES.py` for 4 full code examples.

## Monitoring Tool Calls

Watch your console when the app runs:

```
🔧 Tool: get_today_updates | Args: ['category']
   Result: {'status': 'success', ...}

🔧 Tool: search_knowledge_base | Args: ['query', 'max_results']  
   Result: {'status': 'success', 'results_count': 3...}
```

This shows what information the AI is accessing.

## Update Your Knowledge Base

Add to `Backend/knowledge_base.json`:

```json
{
  "documents": [
    {
      "title": "Updated Company Policy",
      "content": "Effective March 23, 2025...",
      "date": "2025-03-23"
    }
  ]
}
```

The `search_knowledge_base` tool will find and use it.

## Best Practices

1. **Create daily files** (or use automation)
   ```bash
   # Automate with a cron job:
   0 0 * * * python /path/to/create_daily_updates.py
   ```

2. **Structure your updates**
   - Use clear sections (ANNOUNCEMENTS, SCHEDULE, etc.)
   - Include dates/times
   - Keep it concise

3. **Monitor what works**
   - Check console logs for tool usage
   - See what queries trigger which tools
   - Optimize tool descriptions if needed

4. **Combine with existing features**
   - File uploads still work
   - Quiz/roadmap systems unaffected
   - Everything is compatible

## Files to Know

```
Backend/
├── tools_manager.py           ← Tool definitions & implementations
├── function_calling.py        ← Groq integration & orchestration  
├── main.py                    ← Updated with function calling imports
├── test_function_calling.py   ← Test suite (7/7 passing ✓)
├── knowledge_base.json        ← Searchable knowledge docs
└── daily_updates_YYYY_MM_DD.txt ← Create daily for updates

Docs/
├── FUNCTION_CALLING_GUIDE.md  ← Complete reference
├── INTEGRATION_EXAMPLES.py    ← Code examples
└── QUICK_START.md             ← This file
```

## Common Questions

**Q: Do I have to use function calling?**
A: No! Use `use_functions=False` to disable it. Existing code still works.

**Q: What if function calling fails?**
A: Automatically falls back to regular chat completion. You never get errors to the user.

**Q: How much slower is it?**
A: ~200-500ms per tool call. Use smart routing (Option 2) to only call tools when needed.

**Q: Can I add custom tools?**
A: Yes! See FUNCTION_CALLING_GUIDE.md section "Extending with Custom Tools".

**Q: What about web search?**
A: Already configured if you have GOOGLE_API_KEY and GOOGLE_CX in .env.

## Next Steps

1. ✅ Read FUNCTION_CALLING_GUIDE.md for complete reference
2. ✅ Choose integration approach from INTEGRATION_EXAMPLES.py  
3. ✅ Update your chat endpoint (Step 1 above)
4. ✅ Test with `curl` or your frontend
5. ✅ Set up daily updates automation
6. ✅ Monitor tool usage in console logs

## Example: Complete Daily Automation

Create `Backend/setup_daily_updates.py`:

```python
from datetime import datetime
from pathlib import Path

def create_daily_updates():
    """Create today's updates file."""
    date_str = datetime.now().strftime("%Y_%m_%d")
    file_path = Path(f"daily_updates_{date_str}.txt")
    
    content = f"""=== {datetime.now().strftime('%B %d, %Y')} Updates ===

ANNOUNCEMENTS:
- Check team Slack for important notices

DOCUMENTS:
- Updated procedures available in knowledge base

SCHEDULE:
"""
    
    file_path.write_text(content)
    print(f"✅ Created {file_path}")

if __name__ == "__main__":
    create_daily_updates()
```

Run at midnight:
```bash
# In crontab:
0 0 * * * cd /path/to/Backend && python setup_daily_updates.py
```

## Support

- **Full docs:** See FUNCTION_CALLING_GUIDE.md
- **Code examples:** See INTEGRATION_EXAMPLES.py  
- **Troubleshooting:** See FUNCTION_CALLING_GUIDE.md section "Troubleshooting"
- **Tests:** Run `python test_function_calling.py` anytime

---

**Your AI now learns daily without fine-tuning!** 🚀

Questions? Check the guides or run the test script to verify setup.
