# Tesseract OCR Installation Guide

## Quick Setup (5 minutes)

### Step 1: Install Python packages
```bash
cd Backend
pip install -r requirements.txt
```

### Step 2: Install Tesseract Binary

#### **Windows** (Most Common)
1. Download installer: https://github.com/UB-Mannheim/tesseract/wiki
2. Look for: `tesseract-ocr-w64-setup-v5.x.exe` (or latest version)
3. Run installer → Install to default path: `C:\Program Files\Tesseract-OCR`
4. **Done!** No additional configuration needed (it auto-finds the path)

#### **macOS**
```bash
brew install tesseract
```

#### **Linux (Ubuntu/Debian)**
```bash
sudo apt-get update
sudo apt-get install tesseract-ocr
```

#### **Linux (Fedora/RHEL)**
```bash
sudo yum install tesseract
```

### Step 3: Verify Installation

**Windows PowerShell**:
```powershell
& 'C:\Program Files\Tesseract-OCR\tesseract.exe' --version
```

**macOS/Linux**:
```bash
tesseract --version
```

You should see output like:
```
tesseract 5.3.0
```

### Step 4: Test with Your PDF

1. Clear browser: `Ctrl+Shift+Delete`
2. Start backend server: `python Backend/main.py` 
3. Upload the 146-page PDF from frontend
4. Monitor console for logs like:
   ```
   🖼️ Page 1/146: Scanned page, extracting text...
   📊 Image size: 0.95MB
   ✅ Extracted 847 chars from page 1
   ```

## Troubleshooting

### Error: "TesseractNotFoundError"
**Problem**: Python can't find Tesseract binary  
**Solution Windows**: 
- Verify Tesseract is installed to `C:\Program Files\Tesseract-OCR`
- Restart Python/terminal after installation

**Solution macOS/Linux**:
```bash
which tesseract
```
If empty, run install command again.

### Error: "pytesseract not available"
**Problem**: Python package not installed  
**Solution**:
```bash
pip install pytesseract pillow
```

### Slow Processing
**This is normal!** Tesseract OCR on 146 pages:
- Estimated: 2-3 minutes
- Per page: ~1-2 seconds
- Larger images take longer (0.95MB per page is normal)

### No Text Extracted
**Problem**: Tesseract returned empty text  
**Possible causes**:
- Low-quality PDF images (< 200 DPI)
- Scanned text is very small
- Corrupted PDF pages

**Try**:
- Ensure PDF is high-quality
- Check console for specific page errors
- Run test on a single page first

## Advanced: Custom Configuration

**For Windows with non-standard Tesseract path**:

Edit `Backend/main.py` after imports (around line 42):
```python
import pytesseract

# Add this line if Tesseract is NOT in C:\Program Files\Tesseract-OCR
pytesseract.pytesseract.pytesseract_cmd = r'YOUR\CUSTOM\PATH\tesseract.exe'
```

**For specific languages** (beyond English):

Replace in `Backend/main.py` line in `extract_text_with_ocr()`:
```python
# English only (default):
text = pytesseract.image_to_string(img, lang='eng')

# Multiple languages:
text = pytesseract.image_to_string(img, lang='eng+fra+deu')  # English + French + German

# Spanish:
text = pytesseract.image_to_string(img, lang='spa')
```

Available language codes: `eng`, `fra`, `deu`, `spa`, `ita`, `rus`, `jpn`, `chi_sim`, `chi_tra`, etc.

## Performance Tips

1. **First 5 pages always OCR'd** - ensures good intro content
2. **Every 10th page sampled** - balances speed and coverage
3. **Max 2 minutes for 146 pages** with 1.0x resolution
4. **Lower resolution = faster** - but less accurate

To adjust sampling in `Backend/main.py`:
```python
# Sample every 20th page instead of 10th (faster):
should_ocr_this_page = (page_num % 20 == 0) or (page_num < 5)

# Or sample first 10 pages instead of 5 (more thorough):
should_ocr_this_page = (page_num % 10 == 0) or (page_num < 10)
```

## Success!

Once Tesseract processes your PDF:
```
✅ PDF extraction complete: 156,234 chars
   Pages: 146 total | 12 scanned | 8 OCR'd via Tesseract
```

You'll see extracted text in the chat window! 🎉
