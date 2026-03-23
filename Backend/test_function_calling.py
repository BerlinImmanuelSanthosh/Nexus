#!/usr/bin/env python
"""
Test Function Calling Implementation
Run this to verify your function calling setup is working.
"""

import sys
import os
from pathlib import Path

# Add Backend to path
sys.path.insert(0, str(Path(__file__).parent))

def test_imports():
    """Test that all required modules can be imported."""
    print("🧪 Testing imports...")
    try:
        from tools_manager import get_tool_definitions, handle_tool_call, TOOL_HANDLERS
        print("  ✓ tools_manager imported")
        
        from function_calling import FunctionCallingHandler
        print("  ✓ function_calling imported")
        
        return True
    except ImportError as e:
        print(f"  ✗ Import failed: {e}")
        return False

def test_tool_definitions():
    """Test that tools are properly defined."""
    print("\n🧪 Testing tool definitions...")
    try:
        from tools_manager import get_tool_definitions
        tools = get_tool_definitions()
        
        if not tools:
            print("  ✗ No tools defined")
            return False
        
        print(f"  ✓ Found {len(tools)} tools:")
        for tool in tools:
            tool_name = tool.get("function", {}).get("name", "unknown")
            print(f"    - {tool_name}")
        
        return True
    except Exception as e:
        print(f"  ✗ Tool definition test failed: {e}")
        return False

def test_tool_handlers():
    """Test that tool handlers exist."""
    print("\n🧪 Testing tool handlers...")
    try:
        from tools_manager import TOOL_HANDLERS
        
        if not TOOL_HANDLERS:
            print("  ✗ No tool handlers registered")
            return False
        
        print(f"  ✓ Found {len(TOOL_HANDLERS)} registered handlers:")
        for name in TOOL_HANDLERS.keys():
            print(f"    - {name}")
        
        return True
    except Exception as e:
        print(f"  ✗ Tool handler test failed: {e}")
        return False

def test_tool_execution():
    """Test basic tool execution."""
    print("\n🧪 Testing tool execution...")
    try:
        from tools_manager import handle_tool_call
        
        # Test search_knowledge_base
        result = handle_tool_call("search_knowledge_base", {"query": "test"})
        print(f"  ✓ search_knowledge_base executed")
        print(f"    Result: {result.get('status', 'unknown')}")
        
        # Test get_today_updates
        result = handle_tool_call("get_today_updates", {})
        print(f"  ✓ get_today_updates executed")
        print(f"    Result: {result.get('status', 'unknown')}")
        
        # Test get_company_faq
        result = handle_tool_call("get_company_faq", {"topic": "test"})
        print(f"  ✓ get_company_faq executed")
        print(f"    Result: {result.get('status', 'unknown')}")
        
        return True
    except Exception as e:
        print(f"  ✗ Tool execution test failed: {e}")
        return False

def test_file_structure():
    """Test that required files exist."""
    print("\n🧪 Testing file structure...")
    backend_dir = Path(__file__).parent
    
    files_to_check = [
        "tools_manager.py",
        "function_calling.py",
        "main.py",
        "INTEGRATION_EXAMPLES.py"
    ]
    
    all_exist = True
    for file in files_to_check:
        file_path = backend_dir / file
        if file_path.exists():
            print(f"  ✓ {file}")
        else:
            print(f"  ✗ {file} NOT FOUND")
            all_exist = False
    
    return all_exist

def test_knowledge_base():
    """Test knowledge base access."""
    print("\n🧪 Testing knowledge base...")
    kb_path = Path(__file__).parent / "knowledge_base.json"
    
    if kb_path.exists():
        print(f"  ✓ knowledge_base.json exists")
        try:
            import json
            with open(kb_path) as f:
                data = json.load(f)
            
            if isinstance(data, dict):
                doc_count = len(data.get("documents", []))
                print(f"    Contains {doc_count} documents")
            elif isinstance(data, list):
                print(f"    Contains {len(data)} items")
            
            return True
        except json.JSONDecodeError:
            print("  ✗ knowledge_base.json is invalid JSON")
            return False
    else:
        print("  ⚠ knowledge_base.json not found (optional)")
        return True

def test_env_file():
    """Test .env configuration."""
    print("\n🧪 Testing .env configuration...")
    from dotenv import load_dotenv
    load_dotenv()
    
    import os
    required_vars = ["GROQ_API_KEY"]
    optional_vars = ["GOOGLE_API_KEY", "GOOGLE_CX"]
    
    all_required = True
    for var in required_vars:
        if os.getenv(var):
            print(f"  ✓ {var} configured")
        else:
            print(f"  ✗ {var} NOT SET")
            all_required = False
    
    for var in optional_vars:
        if os.getenv(var):
            print(f"  ✓ {var} configured (optional)")
        else:
            print(f"  ⚠ {var} not set (required for web_search)")
    
    return all_required

def run_all_tests():
    """Run all tests."""
    print("=" * 60)
    print("Function Calling Implementation Test Suite")
    print("=" * 60)
    
    tests = [
        ("Imports", test_imports),
        ("Tool Definitions", test_tool_definitions),
        ("Tool Handlers", test_tool_handlers),
        ("Tool Execution", test_tool_execution),
        ("File Structure", test_file_structure),
        ("Knowledge Base", test_knowledge_base),
        ("Environment", test_env_file),
    ]
    
    results = {}
    for name, test_func in tests:
        try:
            results[name] = test_func()
        except Exception as e:
            print(f"\n✗ {name} crashed: {e}")
            results[name] = False
    
    # Print summary
    print("\n" + "=" * 60)
    print("TEST SUMMARY")
    print("=" * 60)
    
    passed = sum(1 for v in results.values() if v)
    total = len(results)
    
    for name, result in results.items():
        status = "✓ PASS" if result else "✗ FAIL"
        print(f"{status}: {name}")
    
    print(f"\nTotal: {passed}/{total} tests passed")
    
    if passed == total:
        print("\n✅ All tests passed! Function calling is ready to use.")
        print("\nNext steps:")
        print("1. Read FUNCTION_CALLING_GUIDE.md for setup instructions")
        print("2. Check INTEGRATION_EXAMPLES.py for code examples")
        print("3. Update your chat endpoints to use chat_completion_with_tools()")
        return True
    else:
        print(f"\n⚠️ {total - passed} test(s) failed. See above for details.")
        return False

if __name__ == "__main__":
    success = run_all_tests()
    sys.exit(0 if success else 1)
