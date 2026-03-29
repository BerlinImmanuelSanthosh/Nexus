# NexusAI

An intelligent AI assistant system with advanced function calling capabilities, enabling real-time data access and dynamic tool integration for enhanced conversational experiences.

## ✨ Key Features

- **Intelligent Chat Interface**: Natural language conversations powered by Groq AI
- **Function Calling**: Automatic tool invocation for real-time data retrieval
- **Document Processing**: PDF extraction with OCR fallback for comprehensive document understanding
- **Knowledge Base Integration**: Searchable local knowledge stores and company FAQs
- **Daily Updates**: Automatic ingestion of current information without model retraining
- **Web Search**: Real-time information retrieval for current events
- **Quiz System**: Interactive assessment and learning tools
- **Roadmap Planning**: Project planning and milestone tracking
- **Multi-language Support**: Translation capabilities for global communication

## 🚀 Quick Start

### Prerequisites

- **Node.js** (v16 or higher) - [Install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating)
- **Python** (v3.8 or higher)
- **Groq API Key** - Get one at [groq.com](https://groq.com)

### Installation

1. **Clone the repository**
   ```bash
   git clone "https://github.com/BerlinImmanuelSanthosh/Nexus"
   cd nexus
   ```

2. **Set up the backend**
   ```bash
   cd Backend
   python -m venv venv
   # On Windows:
   venv\Scripts\activate
   # On macOS/Linux:
   # source venv/bin/activate

   pip install -p requirements.txt
   ```

3. **Configure environment variables**

   Create a `.env` file in the `Backend/` directory:
   ```env
   GROQ_API_KEY=your_groq_api_key_here
   # Optional: For web search functionality
   GOOGLE_API_KEY=your_google_api_key
   GOOGLE_CX=your_custom_search_engine_id
   ```

4. **Set up the frontend**
   ```bash
   # From the project root
   npm install
   npm run dev
   ```

5. **Start the backend server**
   ```bash
   # From Backend/ directory with virtual environment activated
   python main.py
   ```

The application will be available at `http://localhost:5173` (frontend) and the API at `http://localhost:8000` (backend).

## 📖 Usage Examples

### Basic Chat
```javascript
// Send a message to the AI
const response = await fetch('/api/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    messages: [{ role: 'user', content: 'Hello!' }]
  })
});
```

### Function Calling
The AI automatically calls tools when needed:

```javascript
// Ask about today's updates
const response = await fetch('/api/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    messages: [{ role: 'user', content: "What's new today?" }]
  })
});
// AI automatically calls get_today_updates() tool
```

### File Upload and Processing
```javascript
const formData = new FormData();
formData.append('file', pdfFile);

const response = await fetch('/api/upload', {
  method: 'POST',
  body: formData
});
```

## 🛠️ Available Tools

NexusAI comes with 6 built-in tools for enhanced functionality:

1. **search_knowledge_base** - Query local knowledge base JSON
2. **search_pdf_documents** - Search content from uploaded PDFs
3. **get_company_faq** - Retrieve company FAQs and procedures
4. **get_today_updates** - Access current day's information
5. **web_search** - Perform real-time web searches
6. **get_file_context** - Access currently uploaded/processed files

## 🏗️ Project Structure

```
nexus/
├── src/                    # React frontend
│   ├── components/         # UI components
│   ├── hooks/             # Custom React hooks
│   ├── lib/               # Utility functions
│   ├── pages/             # Route components
│   └── types/             # TypeScript definitions
├── Backend/               # FastAPI backend
│   ├── main.py           # Main API server
│   ├── tools_manager.py  # Tool definitions
│   ├── function_calling.py # Function calling orchestration
│   └── requirements.txt  # Python dependencies
├── docs/                  # Documentation
├── documents/            # Sample documents
└── public/               # Static assets
```

## 📚 Documentation

- [Function Calling Guide](FUNCTION_CALLING_GUIDE.md) - Complete reference for tool integration
- [Architecture Overview](ARCHITECTURE.md) - System design and data flows
- [Quick Start Guide](Backend/QUICK_START.md) - 3-step setup guide
- [API Documentation](docs/) - Detailed component documentation

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guidelines](CONTRIBUTING.md) for details on:

- Setting up a development environment
- Code style and standards
- Testing requirements
- Pull request process

## 📞 Support

- **Issues**: [GitHub Issues](https://github.com/your-repo/issues)
- **Discussions**: [GitHub Discussions](https://github.com/your-repo/discussions)
- **Documentation**: Check the `docs/` directory for detailed guides

## 👥 Maintainers

- **Primary Maintainer**: [Your Name](https://github.com/your-username)

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
- Edit files directly within the Codespace and commit and push your changes once you're done.

## What technologies are used for this project?

This project is built with:

- Vite
- TypeScript
- React
- shadcn-ui
- Tailwind CSS
