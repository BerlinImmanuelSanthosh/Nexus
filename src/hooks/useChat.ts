import { useState, useCallback } from 'react';
import { Message, Conversation } from '@/types/chat';

const generateId = () => Math.random().toString(36).substring(2, 15);

export function useChat() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [isTyping, setIsTyping] = useState(false);

  const activeConversation = conversations.find(c => c.id === activeConversationId);
  const messages = activeConversation?.messages || [];

  const createNewConversation = useCallback(() => {
    const newConversation: Conversation = {
      id: generateId(),
      title: 'New Chat',
      messages: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    setConversations(prev => [newConversation, ...prev]);
    setActiveConversationId(newConversation.id);
  }, []);

  const deleteConversation = useCallback((id: string) => {
    setConversations(prev => prev.filter(c => c.id !== id));
    if (activeConversationId === id) {
      setActiveConversationId(null);
    }
  }, [activeConversationId]);

  // ── Upload file to backend ──────────────────────────────────────────────
  const uploadFile = useCallback(async (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    try {
      const response = await fetch('http://localhost:8000/api/upload-file', {
        method: 'POST',
        body: formData,
      });
      const data = await response.json();
      if (data.success) {
        return true;
      } else {
        return false;
      }
    } catch (error) {
      console.error('File upload error:', error);
      return false;
    }
  }, []);

  // ── Clear file from backend memory ─────────────────────────────────────
  const clearFile = useCallback(async () => {
    try {
      await fetch('http://localhost:8000/api/clear-file', { method: 'POST' });
    } catch (error) {
      console.error('Clear file error:', error);
    }
  }, []);

  const sendMessage = useCallback(async (content: string) => {
    let conversationId = activeConversationId;

    if (!conversationId) {
      const newConversation: Conversation = {
        id: generateId(),
        title: content.slice(0, 30) + (content.length > 30 ? '...' : ''),
        messages: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      setConversations(prev => [newConversation, ...prev]);
      setActiveConversationId(newConversation.id);
      conversationId = newConversation.id;
    }

    const userMessage: Message = {
      id: generateId(),
      content,
      role: 'user',
      timestamp: new Date(),
    };

    setConversations(prev => prev.map(c =>
      c.id === conversationId
        ? { ...c, messages: [...c.messages, userMessage], updatedAt: new Date() }
        : c
    ));

    setIsTyping(true);

    const aiMessageId = generateId();

    const aiMessage: Message = {
      id: aiMessageId,
      content: '',
      role: 'assistant',
      timestamp: new Date(),
    };

    setConversations(prev => prev.map(c =>
      c.id === conversationId
        ? { ...c, messages: [...c.messages, aiMessage], updatedAt: new Date() }
        : c
    ));

    try {
      const currentConversation = conversations.find(c => c.id === conversationId);
      const isReExplain = content.toLowerCase().includes('reexplain');

      let messagesForBackend;
      if (isReExplain && currentConversation) {
        const firstUserMessage = currentConversation.messages.find(m => m.role === 'user');
        messagesForBackend = firstUserMessage
          ? [{ role: 'user', content: firstUserMessage.content }]
          : [{ role: 'user', content }];
      } else {
        messagesForBackend = [...(currentConversation?.messages || []), userMessage]
          .map(msg => ({ role: msg.role, content: msg.content }));
      }

      const response = await fetch('http://localhost:8000/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: messagesForBackend,
          mode: 'simple_english'
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      if (response.body) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let fullText = '';
        let done = false;

        while (!done) {
          const { value, done: readerDone } = await reader.read();
          done = readerDone;
          if (value) {
            const chunk = decoder.decode(value, { stream: true });

            try {
              const parsed = JSON.parse(fullText + chunk);
              if (parsed.response) {
                fullText = parsed.response;
                setConversations(prev => prev.map(c =>
                  c.id === conversationId
                    ? {
                        ...c,
                        messages: c.messages.map(m =>
                          m.id === aiMessageId ? { ...m, content: fullText } : m
                        ),
                        updatedAt: new Date(),
                      }
                    : c
                ));
                break;
              }
            } catch {
              fullText += chunk;

              if (chunk.includes('data: ')) {
                const lines = chunk.split('\n');
                for (const line of lines) {
                  if (line.startsWith('data: ')) {
                    const jsonStr = line.slice(6).trim();
                    if (jsonStr === '[DONE]') { done = true; break; }
                    try {
                      const parsed = JSON.parse(jsonStr);
                      const delta = parsed.choices?.[0]?.delta?.content;
                      if (delta) {
                        fullText = (fullText.replace(chunk, '')) + delta;
                      }
                    } catch { /* partial */ }
                  }
                }
              }

              const displayText = fullText.replace(/^data: .*$/gm, '').replace(/\[DONE\]/g, '').trim();
              if (displayText) {
                setConversations(prev => prev.map(c =>
                  c.id === conversationId
                    ? {
                        ...c,
                        messages: c.messages.map(m =>
                          m.id === aiMessageId ? { ...m, content: displayText } : m
                        ),
                        updatedAt: new Date(),
                      }
                    : c
                ));
              }
            }
          }
        }

        const keywords = content.split(/\s+/).filter(w => w.length > 2).slice(0, 3).join('+');
        const imageUrl = `https://loremflickr.com/800/400/${encodeURIComponent(keywords)}`;
        setConversations(prev => prev.map(c =>
          c.id === conversationId
            ? {
                ...c,
                messages: c.messages.map(m =>
                  m.id === aiMessageId ? { ...m, imageUrl } : m
                ),
                updatedAt: new Date(),
              }
            : c
        ));
      } else {
        const data = await response.json();
        const keywords = content.split(/\s+/).filter(w => w.length > 2).slice(0, 3).join('+');
        const imageUrl = `https://loremflickr.com/800/400/${encodeURIComponent(keywords)}`;
        setConversations(prev => prev.map(c =>
          c.id === conversationId
            ? {
                ...c,
                messages: c.messages.map(m =>
                  m.id === aiMessageId
                    ? { ...m, content: data.response, imageUrl }
                    : m
                ),
                updatedAt: new Date(),
              }
            : c
        ));
      }
    } catch (error) {
      console.error('Chat error:', error);
      setConversations(prev => prev.map(c =>
        c.id === conversationId
          ? {
              ...c,
              messages: c.messages.map(m =>
                m.id === aiMessageId
                  ? { ...m, content: 'Failed to get a response. Is the backend running?' }
                  : m
              ),
              updatedAt: new Date(),
            }
          : c
      ));
    } finally {
      setIsTyping(false);
    }
  }, [activeConversationId, conversations]);

  return {
    conversations,
    activeConversationId,
    messages,
    isTyping,
    setActiveConversationId,
    createNewConversation,
    sendMessage,
    uploadFile,
    clearFile,
    deleteConversation,
  };
}