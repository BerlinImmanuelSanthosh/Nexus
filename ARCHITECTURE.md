# Function Calling Architecture

## System Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                     User Chat Interface                             │
│                      (React Frontend)                               │
└──────────────────────────────────┬──────────────────────────────────┘
                                   │
                                   │ POST /api/chat
                                   │ {"messages": [...]}
                                   ▼
        ┌──────────────────────────────────────────────────┐
        │          FastAPI Backend (main.py)               │
        │  @app.post("/api/chat")                          │
        │  async def chat(request: ChatRequest)            │
        └────────────────┬─────────────────────────────────┘
                         │
                         │ calls
                         ▼
        ┌──────────────────────────────────────────────────┐
        │  chat_completion_with_tools()                    │
        │  (NEW FUNCTION - main.py)                        │
        └────────────────┬─────────────────────────────────┘
                         │
                         │ creates
                         ▼
        ┌──────────────────────────────────────────────────┐
        │    FunctionCallingHandler                        │
        │    (function_calling.py)                         │
        │                                                  │
        │  • Manages tool call orchestration               │
        │  • Handles iterative AI/tool conversations       │
        │  • Processes tool results & integrates back      │
        └────────────────┬─────────────────────────────────┘
                         │
            ┌────────────┼────────────┐
            │            │            │
            ▼            ▼            ▼
    ┌─────────────┐ ┌──────────┐ ┌─────────────┐
    │   Groq      │ │   Tool   │ │  Knowledge  │
    │   API       │ │  Manager │ │   Base      │
    │   Client    │ │ (tools.. │ │   JSON      │
    └─────────────┘ │py)       │ └─────────────┘
                    └──────────┘
                         │
            ┌────────────┼────────────┐
            │            │            │
            ▼            ▼            ▼
    ┌────────────────┬──────────────┬──────────────────┐
    │   Knowledge    │    PDF       │   Company        │
    │   Base Search  │   Search     │   FAQ            │
    │                │              │                  │
    │ Returns docs   │ Returns text │ Returns answers  │
    └────────────────┴──────────────┴──────────────────┘
            │            │            │
            │            ▼            │
            │      ┌─────────────┐    │
            │      │ LangChain   │    │
            │      │ PDF Loaders │    │
            │      └─────────────┘    │
            │                         │
    ┌───────┴─────────────────────────┴────────┐
    │                                           │
    ▼                                           ▼
┌──────────────────────┐        ┌────────────────────────┐
│  Today's Updates     │        │   Additional Tools     │
│  (daily_updates_    │        │                        │
│   YYYY_MM_DD.txt)    │        │ • web_search()         │
│                      │        │ • get_file_context()   │
│ - Announcements      │        │ • Custom tools         │
│ - Schedule           │        │                        │
│ - New documents      │        │ [Easily Extensible]    │
│ - Team notes         │        │                        │
└──────────────────────┘        └────────────────────────┘
            │                              │
            └──────────┬───────────────────┘
                       │
                       │ All tools return:
                       │ {"status": "success"/"error", "data": ...}
                       ▼
        ┌──────────────────────────────────────────┐
        │   Tool Results Integration              │
        │   (function_calling.py)                 │
        │                                         │
        │ Integrates tool results back into       │
        │ conversation as tool_role messages      │
        └────────────────┬─────────────────────────┘
                         │
                         │ Calls Groq again with:
                         │ - Original messages
                         │ - Tool results
                         │ - New tool definitions
                         ▼
        ┌──────────────────────────────────────────┐
        │  Groq LLM (2nd request)                  │
        │                                          │
        │  Synthesizes tool results into response  │
        └────────────────┬─────────────────────────┘
                         │
                         │ Returns final
                         │ response
                         ▼
        ┌──────────────────────────────────────────┐
        │    Final Response to User                │
        │  (with sourced information included)     │
        └──────────────────────────────────────────┘
```

## Request/Response Cycle

### Iteration 1: AI Requests Tools
```
CLIENT → /api/chat (POST)
         {
           "messages": [
             {"role": "user", "content": "What's new today?"}
           ]
         }
           ↓
         chat_completion_with_tools()
           ↓
         FunctionCallingHandler.call_with_tools()
           ↓
         Groq API Request #1:
         {
           "model": "mixtral-8x7b-32768",
           "messages": [...],
           "tools": [
             {
               "type": "function",
               "function": {
                 "name": "get_today_updates",
                 "description": "...",
                 "parameters": {...}
               }
             },
             ... (5 more tools)
           ],
           "tool_choice": "auto"
         }
           ↓
         Groq Response #1:
         {
           "choices": [{
             "message": {
               "content": null,
               "tool_calls": [
                 {
                   "id": "call_123",
                   "function": {
                     "name": "get_today_updates",
                     "arguments": "{\"category\": \"all\"}"
                   }
                 }
               ]
             }
           }]
         }
```

### Iteration 2: Tools Executed
```
         Tool Call Processing:
         - Parse: get_today_updates(category="all")
         - Execute: handle_tool_call()
         - Result: 
           {
             "status": "success",
             "updates": {...},
             "timestamp": "2026-03-23..."
           }
           ↓
         Add to Messages:
         {
           "role": "tool",
           "tool_call_id": "call_123",
           "content": "{...tool result...}"
         }
```

### Iteration 3: AI Synthesizes Response
```
         Groq API Request #2:
         {
           "model": "mixtral-8x7b-32768",
           "messages": [
             {"role": "user", "content": "What's new today?"},
             {
               "role": "assistant",
               "content": null,
               "tool_calls": [... same as above ...]
             },
             {
               "role": "tool",
               "tool_call_id": "call_123",
               "content": "{...tool result...}"
             }
           ],
           "tools": [...same tools...],
           "tool_choice": "auto"
         }
           ↓
         Groq Response #2:
         {
           "choices": [{
             "message": {
               "content": "Based on today's updates... [synthesized answer]",
               "tool_calls": null  ← Now returns answer, no more tools
             }
           }]
         }
           ↓
         Return to User:
         {
           "response": "Based on today's updates..."
         }
```

## Data Flow

```
┌─────────────────────────────────────────────────────────────┐
│                    SOURCE DATA                              │
└─────────────────────────────────────────────────────────────┘
            │                    │                │
            ├─────────────────────┼────────────────┤
            │                    │                │
            ▼                    ▼                ▼
    ┌─────────────┐    ┌──────────────┐  ┌─────────────┐
    │ knowledge_  │    │ daily_       │  │ company     │
    │ base.json   │    │ updates_     │  │ faq.txt +   │
    │             │    │ YYYY_MM_DD   │  │ steps.txt   │
    │ {documents}▼    │ .txt         │  │             │
    └─────────────┘    └──────────────┘  └─────────────┘
            │                    │                │
            └────────────────────┼────────────────┘
                                 │
                    ┌────────────▼───────────┐
                    │   tools_manager.py     │
                    │                        │
                    │  Tool Implementations: │
                    │  • parse files         │
                    │  • search content      │
                    │  • return results      │
                    └────────────────────────┘
                                 │
                                 ▼
                    ┌─────────────────────────┐
                    │ function_calling.py     │
                    │                         │
                    │ Execute tools and       │
                    │ integrate results       │
                    └─────────────────────────┘
                                 │
                                 ▼
                    ┌─────────────────────────┐
                    │ Groq API                │
                    │ (Synthesizes response)  │
                    └─────────────────────────┘
                                 │
                                 ▼
                    ┌─────────────────────────┐
                    │ Final Response to User  │
                    │ (sourced from tools)    │
                    └─────────────────────────┘
```

## Tool Execution Loop

```
START
  │
  ├─ Get available tools
  │  │
  │  └─ get_tool_definitions()
  │     Returns: List[tools]
  │
  ├─ Call Groq with tools
  │  │
  │  └─ {"messages": [...], "tools": [...]}
  │
  ├─ Check response
  │  │
  │  ├─ Tool calls requested?
  │  │  │
  │  │  YES ├─ For each tool call:
  │  │  │    │
  │  │  │    ├─ Parse tool name & args
  │  │  │    │
  │  │  │    ├─ Execute tool
  │  │  │    │  │
  │  │  │    │  └─ handle_tool_call()
  │  │  │    │     Returns: {"status": "...", "data": "..."}
  │  │  │    │
  │  │  │    ├─ Add result to messages
  │  │  │    │  │
  │  │  │    │  └─ {"role": "tool", "content": "..."}
  │  │  │    │
  │  │  │    └─ Loop back, increment iteration
  │  │  │
  │  │  NO ├─ Return final response
  │  │      │
  │  │      └─ Groq synthesis is complete
  │  │
  │  └─ Max iterations reached?
  │     │
  │     YES ├─ Error: Too many tool calls
  │     │
  │     NO ├─ Continue
  │
  └─ Return response
END
```

## Tool Invocation Flow

```
AI Request
    │
    ├─ parse_tool_call()
    │  │
    │  ├─ tool_id: "call_123"
    │  ├─ tool_name: "search_knowledge_base"
    │  └─ tool_args: {"query": "...", "max_results": 5}
    │
    ▼
handle_tool_call(tool_name, tool_args)
    │
    ├─ Lookup handler in TOOL_HANDLERS
    │  │
    │  └─ search_knowledge_base(query, max_results)
    │
    ▼
Tool Implementation
    │
    ├─ Validate inputs
    ├─ Load/access data
    ├─ Search/filter/process
    ├─ Format results
    │
    ▼
Return Result
    │
    ├─ {"status": "success", "data": "..."}
    │
    ▼
Integration
    │
    └─ Add to messages as tool_role
       {"role": "tool", "tool_call_id": "call_123", "content": "..."}
```

## Files & Directories

```
Backend/
├── main.py                          [UPDATED]
│   └─ Added: chat_completion_with_tools()
│   └─ Added: get_function_calling_handler()
│   └─ Added: imports for function calling
│
├── tools_manager.py                 [NEW]
│   ├─ get_tool_definitions()
│   │  └─ Returns list of 6 tool definitions
│   ├─ search_knowledge_base()
│   ├─ search_pdf_documents()
│   ├─ get_company_faq()
│   ├─ get_today_updates()
│   ├─ web_search()
│   ├─ get_file_context()
│   └─ TOOL_HANDLERS dict
│
├── function_calling.py              [NEW]
│   └─ FunctionCallingHandler class
│      ├─ call_with_tools()
│      ├─ stream_with_tools()
│      └─ async versions
│
├── knowledge_base.json
│   └─ Can be searched by tools
│
├── daily_updates_2026_03_23.txt     [NEW - Created Daily]
│   └─ Automatically read by get_today_updates()
│
├── daily_updates_automation.py      [NEW]
│   └─ Creates daily update files
│   └─ Can be automated with cron
│
├── test_function_calling.py         [NEW]
│   └─ 7 comprehensive tests (all passing ✓)
│
├── QUICK_START.md                   [NEW]
├── INTEGRATION_EXAMPLES.py          [NEW]
└── PROJECT_SUMMARY.md               [NEW]
```

## Extension Points

```
┌─────────────────────────────────────────────────────────┐
│           TOOL MANAGER (Easy to Extend)                 │
└─────────────────────────────────────────────────────────┘
                         │
         ┌───────────────┼───────────────┐
         │               │               │
         ▼               ▼               ▼
    ┌─────────┐  ┌────────────┐  ┌──────────┐
    │ Built-in │  │ Slack API │  │ Database │
    │ Tools    │  │ Integration   │ Queries │
    │          │  │            │  │         │
    │ 1-6      │  │ Add in     │  │ Custom  │
    │          │  │ _fetch_    │  │ tools   │
    │ ✓ Ready  │  │ announcements()│       │
    │          │  │            │  │ [TBD]   │
    └─────────┘  └────────────┘  └──────────┘
```

---

**This architecture enables real-time AI knowledge updates without fine-tuning.**
