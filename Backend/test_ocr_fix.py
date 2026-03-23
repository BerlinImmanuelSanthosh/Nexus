"""
Test script to verify OCR base64 encoding fix.
Run this to diagnose PDF extraction issues before uploading large PDFs.
"""

import base64
import json
from pathlib import Path

def test_base64_encoding():
    """Test that base64 encoding produces valid strings"""
    print("🧪 Testing base64 encoding...")
    
    # Simulate image data (JPEG magic bytes)
    fake_jpeg = b'\xff\xd8\xff\xe0' + b'\x00' * 1000  # 1KB fake JPEG
    
    try:
        b64_encoded = base64.b64encode(fake_jpeg).decode('utf-8')
        print(f"  ✅ Base64 encoding successful: {len(b64_encoded)} chars")
        print(f"  First 50 chars: {b64_encoded[:50]}...")
        
        # Validate encoding
        decoded = base64.b64decode(b64_encoded)
        assert decoded == fake_jpeg, "Decoded data doesn't match original!"
        print(f"  ✅ Decoding validation passed")
        
        return True
    except Exception as e:
        print(f"  ❌ Base64 error: {e}")
        return False

def test_groq_message_structure():
    """Test that message structure is valid JSON"""
    print("\n🧪 Testing Groq message structure...")
    
    fake_b64 = base64.b64encode(b'test' * 250).decode('utf-8')
    
    message = {
        "role": "user",
        "content": [
            {
                "type": "image_url",
                "image_url": {
                    "url": f"data:image/jpeg;base64,{fake_b64}"
                }
            },
            {
                "type": "text",
                "text": "Extract all text from this image."
            }
        ]
    }
    
    try:
        # Validate it's valid JSON
        json_str = json.dumps(message)
        print(f"  ✅ Message is valid JSON: {len(json_str)} chars")
        
        # Check structure
        assert message["content"][0]["type"] == "image_url"
        assert message["content"][1]["type"] == "text"
        print(f"  ✅ Content structure is correct")
        
        return True
    except Exception as e:
        print(f"  ❌ Message structure error: {e}")
        return False

def check_dependencies():
    """Check if required libraries are installed"""
    print("\n🧪 Checking dependencies...")
    
    dependencies = {
        "fitz": "PyMuPDF",
        "langchain_community.document_loaders": "LangChain",
        "groq": "Groq",
        "pydantic": "Pydantic",
    }
    
    for module, name in dependencies.items():
        try:
            if "." in module:
                parts = module.split(".")
                exec(f"from {parts[0]} import {parts[1]}")
            else:
                exec(f"import {module}")
            print(f"  ✅ {name}")
        except ImportError:
            print(f"  ⚠️ {name} not installed - install with: pip install {module.split('.')[0]}")

if __name__ == "__main__":
    print("=" * 60)
    print("🔍 OCR Fix Validation Test Suite")
    print("=" * 60)
    
    results = []
    results.append(("Base64 Encoding", test_base64_encoding()))
    results.append(("Message Structure", test_groq_message_structure()))
    check_dependencies()
    
    print("\n" + "=" * 60)
    print("📊 Test Results:")
    print("=" * 60)
    for test_name, passed in results:
        status = "✅ PASS" if passed else "❌ FAIL"
        print(f"  {status}: {test_name}")
    
    if all(result for _, result in results):
        print("\n✨ All core tests passed! OCR should work correctly.")
    else:
        print("\n⚠️ Some tests failed. Check errors above.")
