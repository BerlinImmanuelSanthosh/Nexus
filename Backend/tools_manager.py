"""
Tool/Function definitions for Groq function calling.
Allows AI to dynamically access data sources without fine-tuning.
"""
import json
import os
import requests
from typing import Any, Callable, Dict, List, Optional
from datetime import datetime, timedelta

# --- Tool Definition Factory ---

def get_tool_definitions() -> List[Dict[str, Any]]:
    """
    Returns Groq-compatible function definitions.
    The AI can call these functions to retrieve real-time data.
    """
    return [
        {
            "type": "function",
            "function": {
                "name": "search_knowledge_base",
                "description": "Search the knowledge base for information on a topic. Returns relevant documents and content.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {
                            "type": "string",
                            "description": "The search query to find relevant information"
                        },
                        "max_results": {
                            "type": "integer",
                            "description": "Maximum number of results to return (default: 5)",
                            "default": 5
                        }
                    },
                    "required": ["query"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "search_pdf_documents",
                "description": "Search and extract text from PDF documents. Use for retrieving specific information from uploaded PDFs.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {
                            "type": "string",
                            "description": "Search query or key terms to find in PDFs"
                        },
                        "document_type": {
                            "type": "string",
                            "description": "Type of document (e.g., 'company_faq', 'training_materials', 'guidelines')",
                            "enum": ["company_faq", "training_materials", "guidelines", "all"]
                        }
                    },
                    "required": ["query"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "get_company_faq",
                "description": "Retrieve company FAQ and steps information for frequently asked questions.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "topic": {
                            "type": "string",
                            "description": "FAQ topic to search (e.g., 'onboarding', 'policies', 'procedures')"
                        },
                        "search_term": {
                            "type": "string",
                            "description": "Specific search term within FAQs"
                        }
                    },
                    "required": ["topic"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "get_today_updates",
                "description": "Get today's updates, new documents, or recent changes. Useful for staying current without fine-tuning.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "category": {
                                "type": "string",
                                "description": "Category of updates to retrieve",
                                "enum": ["documents", "announcements", "schedule", "all"],
                                "default": "all"
                            },
                            "days": {
                                "type": "integer",
                                "description": "How many days back to include (default: 1)",
                                "default": 1
                            },
                            "include_online": {
                                "type": "boolean",
                                "description": "Whether to fetch online sources (Slack/GitHub/RSS) if configured",
                                "default": False
                            }
                        }
                    }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "web_search",
                "description": "Perform web search for real-time information. Requires Google API credentials.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {
                            "type": "string",
                            "description": "Search query"
                        },
                        "num_results": {
                            "type": "integer",
                            "description": "Number of results to return (1-10)",
                            "default": 3
                        }
                    },
                    "required": ["query"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "get_file_context",
                "description": "Get the current file context (uploaded document content) that's been processed.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "section": {
                            "type": "string",
                            "description": "Specific section to retrieve from context (e.g., 'summary', 'full', 'first_100_chars')",
                            "enum": ["summary", "full", "first_100_chars"],
                            "default": "summary"
                        }
                    }
                }
            }
        }
    ]


# --- Tool Implementation Functions ---

def search_knowledge_base(query: str, max_results: int = 5) -> Dict[str, Any]:
    """Search knowledge base for relevant information."""
    try:
        kb_path = "Backend/knowledge_base.json"
        if not os.path.exists(kb_path):
            return {"status": "error", "message": "Knowledge base not found"}
        
        with open(kb_path, 'r') as f:
            kb_data = json.load(f)
        
        # Simple keyword matching (can be upgraded to semantic search with embeddings)
        query_lower = query.lower()
        results = []
        
        if isinstance(kb_data, dict):
            items = kb_data.get("documents", []) if isinstance(kb_data.get("documents"), list) else list(kb_data.values())
        else:
            items = kb_data if isinstance(kb_data, list) else []
        
        for item in items[:100]:  # Limit search scope
            if isinstance(item, dict):
                content = str(item.get("content", "")) + " " + str(item.get("title", ""))
            else:
                content = str(item)
            
            if query_lower in content.lower():
                results.append({"content": content[:500], "relevance": "high"})
        
        return {
            "status": "success",
            "query": query,
            "results_count": len(results),
            "results": results[:max_results],
            "timestamp": datetime.now().isoformat()
        }
    except Exception as e:
        return {"status": "error", "message": str(e)}


def search_pdf_documents(query: str, document_type: str = "all") -> Dict[str, Any]:
    """Search PDF documents for specific information."""
    try:
        # This would integrate with your existing PDF extraction functions
        return {
            "status": "success",
            "query": query,
            "document_type": document_type,
            "message": "PDF search initialized - results depend on uploaded documents",
            "documents_found": 0,
            "note": "Integrate with your extract_text_with_langchain() function"
        }
    except Exception as e:
        return {"status": "error", "message": str(e)}


def get_company_faq(topic: str, search_term: Optional[str] = None) -> Dict[str, Any]:
    """Retrieve company FAQ and steps."""
    try:
        results = []
        
        # Search Companysteps.txt
        if os.path.exists("documents/Companysteps.txt"):
            with open("documents/Companysteps.txt", 'r', encoding='utf-8') as f:
                content = f.read()
                if topic.lower() in content.lower():
                    results.append({
                        "source": "Companysteps.txt",
                        "content": content[:1000]
                    })
        
        # Search companyfaq.txt
        if os.path.exists("documents/companyfaq.txt"):
            with open("documents/companyfaq.txt", 'r', encoding='utf-8') as f:
                content = f.read()
                if topic.lower() in content.lower():
                    results.append({
                        "source": "companyfaq.txt",
                        "content": content[:1000]
                    })
        
        return {
            "status": "success",
            "topic": topic,
            "search_term": search_term,
            "results": results,
            "timestamp": datetime.now().isoformat()
        }
    except Exception as e:
        return {"status": "error", "message": str(e)}


def get_today_updates(category: str = "all") -> Dict[str, Any]:
    """Get today's updates - allows daily knowledge injection without fine-tuning."""
    try:
        # New signature supports days and online sources via tool params
        # Expecting callers to pass 'days' and 'include_online' via tool_input
        # Default behavior: return today's local updates file and KB info
        updates = {
            "date": datetime.now().strftime("%Y-%m-%d"),
            "updates": []
        }

        # Determine days window (default 1)
        # If called via handle_tool_call, tool_input will pass args; here we accept env var fallback
        days = 1
        include_online = False
        # If a runtime caller set TOOLS_DAYS env var, respect it as fallback
        try:
            days = int(os.getenv("TOOLS_DAYS", "1"))
        except Exception:
            days = 1

        # Collect daily update files for the past `days` days
        for d in range(days):
            dt = datetime.now() - timedelta(days=d)
            updates_file = f"Backend/daily_updates_{dt.strftime('%Y_%m_%d')}.txt"
            if os.path.exists(updates_file):
                try:
                    with open(updates_file, 'r', encoding='utf-8') as f:
                        updates["updates"].append({
                            "date": dt.strftime('%Y-%m-%d'),
                            "category": "documents",
                            "content": f.read()
                        })
                except Exception:
                    updates["updates"].append({"date": dt.strftime('%Y-%m-%d'), "category": "documents", "content": "<read_error>"})

        # Knowledge base metadata
        if os.path.exists("Backend/knowledge_base.json"):
            with open("Backend/knowledge_base.json", 'r') as f:
                try:
                    kb = json.load(f)
                    if isinstance(kb, dict) and "last_updated" in kb:
                        updates["last_kb_update"] = kb["last_updated"]
                except Exception:
                    updates["last_kb_update"] = None

        # Optionally fetch online sources if configured via env vars
        include_online_env = os.getenv("TOOLS_INCLUDE_ONLINE", "false").lower()
        if include_online_env in ("1", "true", "yes"):
            include_online = True

        if include_online:
            online_results = []
            # Slack
            slack_token = os.getenv("SLACK_BOT_TOKEN")
            slack_channel = os.getenv("SLACK_CHANNEL")
            if slack_token and slack_channel:
                try:
                    slack = fetch_slack_messages(slack_channel, slack_token, days)
                    online_results.append({"source": "slack", "items": slack})
                except Exception as e:
                    online_results.append({"source": "slack", "error": str(e)})

            # GitHub (commits)
            gh_token = os.getenv("GITHUB_TOKEN")
            gh_repo = os.getenv("GITHUB_REPO")
            if gh_repo:
                try:
                    gh = fetch_github_commits(gh_repo, gh_token, days)
                    online_results.append({"source": "github", "items": gh})
                except Exception as e:
                    online_results.append({"source": "github", "error": str(e)})

            # RSS feeds list in env var (comma separated)
            rss_list = os.getenv("RSS_FEEDS", "")
            if rss_list:
                try:
                    feeds = [u.strip() for u in rss_list.split(",") if u.strip()]
                    rss_items = fetch_rss_feeds(feeds, days)
                    online_results.append({"source": "rss", "items": rss_items})
                except Exception as e:
                    online_results.append({"source": "rss", "error": str(e)})

            updates["online"] = online_results

        return {
            "status": "success",
            "category": category,
            "days": days,
            "include_online": include_online,
            "updates": updates,
            "note": "Create daily_updates_YYYY_MM_DD.txt files or configure online sources (SLACK_BOT_TOKEN, GITHUB_REPO, RSS_FEEDS)"
        }
    except Exception as e:
        return {"status": "error", "message": str(e)}


def fetch_slack_messages(channel: str, token: str, days: int = 1) -> List[Dict[str, Any]]:
    """Fetch recent messages from a Slack channel using conversations.history."""
    try:
        headers = {"Authorization": f"Bearer {token}"}
        now = datetime.utcnow()
        oldest = int((now - timedelta(days=days)).timestamp())
        url = "https://slack.com/api/conversations.history"
        params = {"channel": channel, "oldest": oldest, "limit": 50}
        resp = requests.get(url, headers=headers, params=params, timeout=10)
        data = resp.json()
        if not data.get("ok"):
            return [{"error": data.get("error")}]
        items = []
        for m in data.get("messages", []):
            items.append({"ts": m.get("ts"), "text": m.get("text")})
        return items
    except Exception as e:
        return [{"error": str(e)}]


def fetch_github_commits(repo: str, token: Optional[str], days: int = 1) -> List[Dict[str, Any]]:
    """Fetch recent commits from a GitHub repo since `days` ago."""
    try:
        headers = {"Accept": "application/vnd.github+json"}
        if token:
            headers["Authorization"] = f"token {token}"
        since_dt = (datetime.utcnow() - timedelta(days=days)).isoformat() + "Z"
        url = f"https://api.github.com/repos/{repo}/commits"
        params = {"since": since_dt, "per_page": 50}
        resp = requests.get(url, headers=headers, params=params, timeout=10)
        if resp.status_code != 200:
            return [{"error": f"HTTP {resp.status_code}"}]
        data = resp.json()
        items = []
        for c in data:
            items.append({"sha": c.get("sha"), "message": c.get("commit", {}).get("message"), "url": c.get("html_url")})
        return items
    except Exception as e:
        return [{"error": str(e)}]


def fetch_rss_feeds(urls: List[str], days: int = 1) -> List[Dict[str, Any]]:
    """Fetch items from RSS/Atom feeds. Tries to use feedparser if available, otherwise basic parsing."""
    results = []
    try:
        import feedparser
        cutoff = datetime.utcnow() - timedelta(days=days)
        for u in urls:
            try:
                d = feedparser.parse(u)
                items = []
                for e in d.entries:
                    # try published_parsed then fallback
                    pub = None
                    try:
                        pub = datetime(*e.published_parsed[:6]) if getattr(e, 'published_parsed', None) else None
                    except Exception:
                        pub = None
                    items.append({"title": e.get('title'), "link": e.get('link'), "published": pub.isoformat() if pub else None})
                results.append({"feed": u, "items": items})
            except Exception as fe:
                results.append({"feed": u, "error": str(fe)})
        return results
    except Exception:
        # Fallback: simple fetch and return raw content snippets
        for u in urls:
            try:
                r = requests.get(u, timeout=8)
                snippet = r.text[:1000]
                results.append({"feed": u, "snippet": snippet})
            except Exception as e:
                results.append({"feed": u, "error": str(e)})
        return results


def web_search(query: str, num_results: int = 3) -> Dict[str, Any]:
    """Perform web search using Google Custom Search API."""
    try:
        from googleapiclient.discovery import build
        
        api_key = os.getenv("GOOGLE_API_KEY")
        search_engine_id = os.getenv("GOOGLE_CX")
        
        if not api_key or not search_engine_id:
            return {
                "status": "error",
                "message": "Google API credentials not configured",
                "setup_required": "Set GOOGLE_API_KEY and GOOGLE_CX in .env"
            }
        
        service = build("customsearch", "v1", developerKey=api_key)
        result = service.cse().list(q=query, cx=search_engine_id, num=min(num_results, 10)).execute()
        
        items = []
        for item in result.get('items', []):
            items.append({
                "title": item.get('title'),
                "link": item.get('link'),
                "snippet": item.get('snippet')
            })
        
        return {
            "status": "success",
            "query": query,
            "results_count": len(items),
            "results": items,
            "timestamp": datetime.now().isoformat()
        }
    except Exception as e:
        return {"status": "error", "message": str(e), "note": "Install google-api-python-client: pip install google-api-python-client"}


def get_file_context(section: str = "summary") -> Dict[str, Any]:
    """Get current file context from global _file_context."""
    try:
        # This will be called from main.py with access to global _file_context
        return {
            "status": "success",
            "section": section,
            "note": "Requires integration with main.py's _file_context"
        }
    except Exception as e:
        return {"status": "error", "message": str(e)}


# --- Tool Handler Registry ---

TOOL_HANDLERS: Dict[str, Callable] = {
    "search_knowledge_base": search_knowledge_base,
    "search_pdf_documents": search_pdf_documents,
    "get_company_faq": get_company_faq,
    "get_today_updates": get_today_updates,
    "web_search": web_search,
    "get_file_context": get_file_context,
}


def handle_tool_call(tool_name: str, tool_input: Dict[str, Any], file_context: Optional[Dict] = None) -> Dict[str, Any]:
    """
    Execute a tool call and return results.
    
    Args:
        tool_name: Name of the tool to call
        tool_input: Input parameters for the tool
        file_context: Optional global file context from main.py
    
    Returns:
        Tool execution result
    """
    if tool_name not in TOOL_HANDLERS:
        return {"status": "error", "message": f"Unknown tool: {tool_name}"}
    
    try:
        handler = TOOL_HANDLERS[tool_name]
        result = handler(**tool_input)
        result["tool_name"] = tool_name
        return result
    except TypeError as e:
        return {"status": "error", "message": f"Invalid parameters: {str(e)}"}
    except Exception as e:
        return {"status": "error", "message": f"Tool execution failed: {str(e)}"}
