"""
Function calling orchestration for Groq.
Handles tool calls, manages the request/response loop, and integrates with tools_manager.
"""
from typing import Any, Dict, List, Optional, Generator, AsyncGenerator
import json
from groq import Groq
from tools_manager import get_tool_definitions, handle_tool_call


class FunctionCallingHandler:
    """Manages function calling with Groq API."""
    
    def __init__(self, groq_client: Groq, model: str = "mixtral-8x7b-32768"):
        self.client = groq_client
        self.model = model
        self.max_iterations = 10  # Prevent infinite tool call loops
        
    def call_with_tools(
        self,
        messages: List[Dict[str, str]],
        system_prompt: Optional[str] = None,
        file_context: Optional[Dict] = None,
        temperature: float = 0.7
    ) -> str:
        """
        Call Groq with function calling enabled.
        
        Args:
            messages: Chat messages
            system_prompt: System prompt to prepend
            file_context: Global file context for tools
            temperature: Model temperature
            
        Returns:
            Final response text
        """
        # Prepare messages with system prompt
        prepared_messages = messages.copy()
        if system_prompt:
            prepared_messages.insert(0, {"role": "system", "content": system_prompt})
        
        # Get available tools
        tools = get_tool_definitions()
        
        # Iterative function calling loop
        iteration = 0
        while iteration < self.max_iterations:
            iteration += 1
            
            # Call Groq with tools
            response = self.client.chat.completions.create(
                model=self.model,
                messages=prepared_messages,
                tools=tools,
                tool_choice="auto",  # Let model decide when to use tools
                temperature=temperature,
                max_tokens=2048
            )
            
            # Check if model wants to call a tool
            if response.choices[0].message.tool_calls:
                tool_calls = response.choices[0].message.tool_calls
                
                # Add assistant's response to messages
                prepared_messages.append({
                    "role": "assistant",
                    "content": response.choices[0].message.content or "",
                    "tool_calls": [
                        {
                            "id": tc.id,
                            "type": "function",
                            "function": {
                                "name": tc.function.name,
                                "arguments": tc.function.arguments
                            }
                        }
                        for tc in tool_calls
                    ]
                })
                
                # Process each tool call
                for tool_call in tool_calls:
                    tool_name = tool_call.function.name
                    tool_arguments = json.loads(tool_call.function.arguments)
                    
                    # Execute tool
                    tool_result = handle_tool_call(tool_name, tool_arguments, file_context)
                    
                    print(f"🔧 Tool: {tool_name} | Args: {list(tool_arguments.keys())}")
                    print(f"   Result: {json.dumps(tool_result, indent=2)[:200]}...")
                    
                    # Add tool result to messages
                    prepared_messages.append({
                        "role": "tool",
                        "tool_call_id": tool_call.id,
                        "content": json.dumps(tool_result)
                    })
            else:
                # Model didn't call a tool, return the response
                return response.choices[0].message.content or ""
        
        # Max iterations reached
        return "I've reached the maximum number of tool calls. Please try a simpler query."
    
    def stream_with_tools(
        self,
        messages: List[Dict[str, str]],
        system_prompt: Optional[str] = None,
        file_context: Optional[Dict] = None,
        temperature: float = 0.7
    ) -> Generator[str, None, None]:
        """
        Stream response with function calling.
        
        Args:
            messages: Chat messages
            system_prompt: System prompt
            file_context: Global file context
            temperature: Model temperature
            
        Yields:
            Response tokens as they arrive
        """
        prepared_messages = messages.copy()
        if system_prompt:
            prepared_messages.insert(0, {"role": "system", "content": system_prompt})
        
        tools = get_tool_definitions()
        iteration = 0
        
        while iteration < self.max_iterations:
            iteration += 1
            
            response = self.client.chat.completions.create(
                model=self.model,
                messages=prepared_messages,
                tools=tools,
                tool_choice="auto",
                temperature=temperature,
                stream=False,  # We'll handle streaming differently with tools
                max_tokens=2048
            )
            
            if response.choices[0].message.tool_calls:
                tool_calls = response.choices[0].message.tool_calls
                
                # Yield thinking message
                yield json.dumps({
                    "type": "thinking",
                    "content": f"Using tools: {', '.join([tc.function.name for tc in tool_calls])}"
                }) + "\n"
                
                prepared_messages.append({
                    "role": "assistant",
                    "content": response.choices[0].message.content or "",
                    "tool_calls": [
                        {
                            "id": tc.id,
                            "type": "function",
                            "function": {
                                "name": tc.function.name,
                                "arguments": tc.function.arguments
                            }
                        }
                        for tc in tool_calls
                    ]
                })
                
                # Execute tools
                for tool_call in tool_calls:
                    tool_name = tool_call.function.name
                    tool_arguments = json.loads(tool_call.function.arguments)
                    tool_result = handle_tool_call(tool_name, tool_arguments, file_context)
                    
                    prepared_messages.append({
                        "role": "tool",
                        "tool_call_id": tool_call.id,
                        "content": json.dumps(tool_result)
                    })
            else:
                # Stream final response
                content = response.choices[0].message.content or ""
                # Simulate streaming by yielding word by word
                for token in content.split():
                    yield token + " "
                return
        
        yield "Tool call limit exceeded. Please try again."
    
    async def async_call_with_tools(
        self,
        messages: List[Dict[str, str]],
        system_prompt: Optional[str] = None,
        file_context: Optional[Dict] = None,
        temperature: float = 0.7
    ) -> str:
        """Async version of call_with_tools."""
        # Groq client is synchronous, so we just call the sync version
        return self.call_with_tools(messages, system_prompt, file_context, temperature)
    
    async def async_stream_with_tools(
        self,
        messages: List[Dict[str, str]],
        system_prompt: Optional[str] = None,
        file_context: Optional[Dict] = None,
        temperature: float = 0.7
    ) -> AsyncGenerator[str, None]:
        """Async version of stream_with_tools."""
        for token in self.stream_with_tools(messages, system_prompt, file_context, temperature):
            yield token
