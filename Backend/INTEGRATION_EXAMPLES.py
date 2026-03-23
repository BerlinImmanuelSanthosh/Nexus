"""
INTEGRATION EXAMPLES - Function Calling with Your Chat Endpoints
Shows how to update your existing chat endpoints to use function calling.
"""

# ============================================================================
# OPTION 1: Update Your Existing /api/chat Endpoint (Recommended)
# ============================================================================

"""
In your main.py, find the @app.post("/api/chat") function and update it:

FROM:
------
@app.post("/api/chat")
async def chat(request: ChatRequest):
    try:
        messages = request.messages
        # ... existing code ...
        
        def _run_chat_completion(system_prompt, user_content, temp, max_tok, top_p):
            return clean_llm_response(chat_completion(
                messages=[{"role":"system","content":system_prompt},{"role":"user","content":user_content}],
                temperature=temp,max_tokens=max_tok,top_p=top_p,timeout=25.0))

TO:
------
@app.post("/api/chat")
async def chat(request: ChatRequest):
    try:
        messages = request.messages
        # ... existing code ...
        
        # Get file context for tools
        with _file_context_lock:
            file_ctx = _file_context.copy()
        
        def _run_chat_completion(system_prompt, user_content, temp, max_tok, top_p):
            # Use function calling instead of regular chat
            return clean_llm_response(chat_completion_with_tools(
                messages=[{"role":"system","content":system_prompt},{"role":"user","content":user_content}],
                system_prompt=system_prompt,  # Can also pass as param
                temperature=temp,
                file_context=file_ctx,
                use_functions=True  # Enable function calling
            ))
"""

# ============================================================================
# OPTION 2: Create a New Function Calling Endpoint
# ============================================================================

"""
Keep your existing /api/chat intact and create a new endpoint:

from fastapi import FastAPI
from pydantic import BaseModel

@app.post("/api/chat/with-tools")
async def chat_with_tools(request: ChatRequest):
    '''Chat endpoint with function calling enabled.'''
    try:
        messages = request.messages
        if not messages:
            raise HTTPException(status_code=400, detail="No messages provided")
        
        # Get file context for tools
        with _file_context_lock:
            file_ctx = _file_context.copy()
        
        # Create system prompt
        system_prompt = ""\"You are NexusAI, an intelligent assistant. 
You have access to tools to search knowledge base, PDFs, company FAQs, and today's updates.
Use these tools to provide accurate, current information. Always mention sources when using tools.\"\"\"
        
        # Call with function calling
        response = chat_completion_with_tools(
            messages=messages,
            system_prompt=system_prompt,
            temperature=0.25,
            file_context=file_ctx,
            use_functions=True
        )
        
        return {"response": response}
        
    except Exception as e:
        print(f"Error in chat_with_tools: {e}")
        raise HTTPException(status_code=500, detail=str(e))
"""

# ============================================================================
# OPTION 3: Streaming Endpoint with Function Calling
# ============================================================================

"""
Update your /api/chat/stream endpoint:

@app.post("/api/chat/stream")
async def chat_stream(request: ChatRequest):
    try:
        messages = request.messages
        
        # Get file context
        with _file_context_lock:
            file_ctx = _file_context.copy()
        
        async def event_generator():
            try:
                # Use function calling handler for streaming
                handler = get_function_calling_handler()
                
                # First, let's do the LLM call with tools
                response = handler.call_with_tools(
                    messages=messages,
                    system_prompt="You are NexusAI...",
                    file_context=file_ctx,
                    temperature=0.25
                )
                
                # Stream the response
                for token in (response.split() if response else []):
                    yield f"data: {json.dumps({'type':'token','content':token+' '})}\n"
                
                yield f"data: {json.dumps({'type':'done'})}\n"
                
            except Exception as e:
                yield f"data: {json.dumps({'type':'error','content':str(e)})}\n"
        
        return StreamingResponse(event_generator(), media_type="text/event-stream")
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
"""

# ============================================================================
# OPTION 4: Use Function Calling Only for Specific Query Types
# ============================================================================

"""
Smart routing - use function calling when beneficial:

@app.post("/api/chat")
async def chat(request: ChatRequest):
    messages = request.messages
    latest_msg = messages[-1]["content"] if messages else ""
    
    # Get file context
    with _file_context_lock:
        file_ctx = _file_context.copy()
    
    # Decide whether to use function calling
    should_use_tools = any(
        keyword in latest_msg.lower() 
        for keyword in ['today', 'update', 'new', 'current', 'latest', 'search', 'find']
    )
    
    if should_use_tools:
        # User is asking about current/new information - use tools
        response = chat_completion_with_tools(
            messages=messages,
            temperature=0.25,
            file_context=file_ctx,
            use_functions=True
        )
    else:
        # Regular query - use standard chat completion
        response = chat_completion(
            messages=messages,
            temperature=0.25
        )
    
    return {"response": response}
"""

# ============================================================================
# TESTING THE INTEGRATION
# ============================================================================

"""
Test your function calling implementation:

1. Start your FastAPI server:
   python main.py

2. Test in Python:
   
   import requests
   
   url = "http://localhost:8000/api/chat"
   messages = [
       {"role": "user", "content": "What updates happened today?"}
   ]
   
   response = requests.post(
       url,
       json={"messages": messages}
   )
   
   print(response.json())

3. Check console for tool calls:
   Look for lines like:
   🔧 Tool: get_today_updates | Args: ['category']
   🔧 Tool: search_knowledge_base | Args: ['query']

4. Verify the AI used tools in its response
"""

# ============================================================================
# PERFORMANCE TIPS
# ============================================================================

"""
1. Use function calling when beneficial:
   - Tool calls add 200-500ms latency
   - Only enable for query types that benefit from up-to-date info
   - Or use keyword detection (see Option 4)

2. Cache tool results:
   - If same query asked multiple times, cache the tool results
   - Prevents redundant API calls

3. Optimize tool implementations:
   - Add timeout limits to tool calls
   - Return only necessary data (not full documents)
   - Use pagination for large results

4. Monitor and log:
   - Log which tools are called most often
   - Identify slow tools and optimize them
   - Track AI's tool usage patterns
"""

# ============================================================================
# TROUBLESHOOTING
# ============================================================================

"""
Issue: Tool calls failing
Solution: Check error logs, ensure files exist at expected paths

Issue: AI not calling tools
Solution: This is normal - AI is smart about when tools are needed
         If tool should be used, improve the tool description
         
Issue: Slow responses
Solution: Function calling adds latency. Use Option 4 (smart routing)
         Cache results. Optimize slow tools.

Issue: ImportError for function_calling or tools_manager
Solution: Make sure files are in Backend/ directory
         Check relative imports if moving files
"""
