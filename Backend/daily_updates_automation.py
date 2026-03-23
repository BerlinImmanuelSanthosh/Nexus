#!/usr/bin/env python
"""
Daily Updates Automation Script
Run this once per day to feed fresh data to your AI.
Can be automated with cron (Linux/Mac) or Task Scheduler (Windows).

Usage:
    python daily_updates_automation.py [--test]

Scheduling:
    Linux/Mac (crontab):
        0 0 * * * cd /path/to/Backend && python daily_updates_automation.py
    
    Windows (Task Scheduler):
        Program: python.exe
        Arguments: daily_updates_automation.py
        Start in: C:\path\to\Backend
"""

import json
import os
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Any


class DailyUpdatesManager:
    """Manages daily updates for NexusAI."""
    
    def __init__(self, backend_dir: str = "."):
        self.backend_dir = Path(backend_dir)
        self.today = datetime.now()
        self.date_str = self.today.strftime("%Y_%m_%d")
        self.updates_file = self.backend_dir / f"daily_updates_{self.date_str}.txt"
        
    def get_today_updates(self) -> Dict[str, Any]:
        """
        Fetch today's updates from various sources.
        Customize this to pull from your actual data sources.
        """
        updates = {
            "announcements": self._fetch_announcements(),
            "schedule": self._fetch_schedule(),
            "new_documents": self._fetch_new_documents(),
            "team_notes": self._fetch_team_notes(),
        }
        return updates
    
    def _fetch_announcements(self) -> List[str]:
        """Fetch announcements - customize with your data source."""
        return [
            "Check team Slack for daily standup notes",
            "Team meeting at 2 PM today",
        ]
    
    def _fetch_schedule(self) -> Dict[str, str]:
        """Fetch today's schedule - customize with your data source."""
        return {
            "9:00 AM": "Daily standup",
            "2:00 PM": "Team meeting",
            "6:00 PM": "End of day",
        }
    
    def _fetch_new_documents(self) -> List[str]:
        """Fetch newly added documents - customize with your data source."""
        # Example: Check if new files were added to a shared folder
        # Example: Query your document management system
        return [
            "Updated team handbook",
            "Q1 planning document",
        ]
    
    def _fetch_team_notes(self) -> List[str]:
        """Fetch team notes - customize with your data source."""
        return [
            "Remote work deadline extended",
            "New project requirements posted",
        ]
    
    def create_updates_file(self) -> bool:
        """Create the daily updates file."""
        try:
            updates = self.get_today_updates()
            
            content = f"""=== {self.today.strftime('%B %d, %Y')} Updates ===
Last updated: {self.today.strftime('%I:%M %p')}

ANNOUNCEMENTS:
"""
            for announcement in updates.get("announcements", []):
                content += f"  • {announcement}\n"
            
            content += "\nSCHEDULE:\n"
            for time, event in updates.get("schedule", {}).items():
                content += f"  {time}: {event}\n"
            
            content += "\nNEW DOCUMENTS:\n"
            for doc in updates.get("new_documents", []):
                content += f"  • {doc}\n"
            
            content += "\nTEAM NOTES:\n"
            for note in updates.get("team_notes", []):
                content += f"  • {note}\n"
            
            # Write file
            self.updates_file.write_text(content)
            print(f"✅ Created {self.updates_file.name}")
            return True
            
        except Exception as e:
            print(f"❌ Failed to create updates file: {e}")
            return False
    
    def update_knowledge_base(self) -> bool:
        """Update knowledge base with new information."""
        try:
            kb_file = self.backend_dir / "knowledge_base.json"
            
            # Load existing KB
            if kb_file.exists():
                with open(kb_file) as f:
                    kb = json.load(f)
            else:
                kb = {"documents": []}
            
            # Add today's update as a document
            kb["documents"].append({
                "title": f"Daily Update - {self.today.strftime('%B %d, %Y')}",
                "content": self.updates_file.read_text() if self.updates_file.exists() else "",
                "date": self.today.isoformat(),
                "source": "daily_updates"
            })
            
            # Keep only last 30 days
            cutoff = datetime(year=self.today.year, month=self.today.month, day=1)
            if cutoff.day > 1:
                cutoff = cutoff.replace(day=1)
            
            documents = kb.get("documents", [])
            kb["documents"] = [
                doc for doc in documents
                if doc.get("source") != "daily_updates" or 
                   datetime.fromisoformat(doc.get("date", "2000-01-01")) > cutoff
            ]
            
            # Update timestamp
            kb["last_updated"] = self.today.isoformat()
            
            # Save KB
            with open(kb_file, 'w') as f:
                json.dump(kb, f, indent=2)
            
            print(f"✅ Updated knowledge_base.json")
            return True
            
        except Exception as e:
            print(f"⚠️ Failed to update knowledge base: {e}")
            return False
    
    def run(self, test: bool = False) -> bool:
        """Run the daily updates process."""
        print(f"""
╔════════════════════════════════════════════╗
║       NexusAI Daily Updates Manager        ║
╚════════════════════════════════════════════╝

Date: {self.today.strftime('%B %d, %Y at %I:%M %p')}
Backend dir: {self.backend_dir.absolute()}
""")
        
        if test:
            print("[TEST MODE - No file modifications]")
        
        # Create updates file
        print("\n📝 Creating daily updates file...")
        if not self.create_updates_file():
            return False
        
        # Show what was created
        if self.updates_file.exists():
            print(f"\n{'='*50}")
            print(self.updates_file.read_text())
            print('='*50)
        
        # Update knowledge base
        if not test:
            print("\n📚 Updating knowledge base...")
            self.update_knowledge_base()
        
        print(f"\n✅ Daily updates completed successfully!")
        print(f"\nNext: The AI will automatically find and use:")
        print(f"  • {self.updates_file.name}")
        print(f"  • Updated knowledge_base.json")
        
        return True


def setup_automation():
    """Print instructions for setting up automation."""
    print("""
╔════════════════════════════════════════════╗
║         Setup Automation Instructions     ║
╚════════════════════════════════════════════╝

Option 1: Linux/Mac (Cron)
─────────────────────────
1. Open crontab editor:
   crontab -e

2. Add this line (runs daily at midnight):
   0 0 * * * cd /path/to/Backend && python daily_updates_automation.py

3. Test it:
   python daily_updates_automation.py --test


Option 2: Windows (Task Scheduler)
──────────────────────────────────
1. Open Task Scheduler
2. Create new task:
   - Name: NexusAI Daily Updates
   - Trigger: Daily at 12:00 AM
   - Action: Run program
     • Program: C:\\path\\to\\python.exe
     • Arguments: daily_updates_automation.py
     • Start in: C:\\path\\to\\Backend

3. Test it:
   python daily_updates_automation.py --test


Customization
─────────────
Edit these functions to integrate with your data sources:
  • _fetch_announcements()  - Slack API, RSS feeds, etc.
  • _fetch_schedule()       - Google Calendar, etc.
  • _fetch_new_documents()  - File system, SharePoint, etc.
  • _fetch_team_notes()     - Confluence, Wiki, etc.

Example: Fetch from Slack
─────────────────────────
from slack_sdk import WebClient

def _fetch_announcements(self):
    client = WebClient(token=os.getenv("SLACK_TOKEN"))
    channel = "#announcements"
    messages = client.conversations_history(channel=channel, limit=5)
    return [msg['text'] for msg in messages['messages']]
""")


if __name__ == "__main__":
    import sys
    
    test_mode = "--test" in sys.argv
    setup_mode = "--setup" in sys.argv
    
    if setup_mode:
        setup_automation()
    else:
        manager = DailyUpdatesManager()
        success = manager.run(test=test_mode)
        
        if not success and not test_mode:
            sys.exit(1)
