# backend/ingest.py
import os
import json
import re
from pathlib import Path

DOCUMENTS_DIR = "../documents"
KB_FILE = "knowledge_base.json"

def simple_tokenize(text: str) -> list[str]:
    """Convert text to lowercase words, remove punctuation"""
    text = re.sub(r"[^\w\s]", " ", text.lower())
    return text.split()

def split_into_chunks(text: str, chunk_size: int = 300, overlap: int = 50) -> list[str]:
    words = text.split()
    chunks = []
    step = chunk_size - overlap
    for i in range(0, len(words), step):
        chunk = " ".join(words[i:i + chunk_size])
        if chunk.strip():
            chunks.append(chunk)
    return chunks

def ingest():
    chunks = []
    doc_dir = Path(DOCUMENTS_DIR)
    
    if not doc_dir.exists():
        doc_dir.mkdir()
        print(f"Created {DOCUMENTS_DIR} - add your .txt files there!")
        return

    # Only process .txt files (avoid PDFs for 3.14 compatibility)
    for file_path in doc_dir.glob("*.txt"):
        try:
            text = file_path.read_text(encoding="utf-8")
            file_chunks = split_into_chunks(text)
            chunks.extend(file_chunks)
            print(f"Loaded: {file_path.name} -> {len(file_chunks)} chunks")
        except Exception as e:
            print(f"Error reading {file_path}: {e}")

    # Save as JSON (our "vector DB")
    with open(KB_FILE, "w", encoding="utf-8") as f:
        json.dump(chunks, f, ensure_ascii=False, indent=2)
    
    print(f"Knowledge base saved to {KB_FILE} ({len(chunks)} chunks)")

if __name__ == "__main__":
    ingest()