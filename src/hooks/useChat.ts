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

  // ── Explain Like a Child ────────────────────────────────────────────────
  const explainLikeChild = useCallback(async (topic: string, language: string = 'en') => {
    let conversationId = activeConversationId;

    if (!conversationId) {
      const newConversation: Conversation = {
        id: generateId(),
        title: topic.slice(0, 30) + (topic.length > 30 ? '...' : ''),
        messages: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      setConversations(prev => [newConversation, ...prev]);
      setActiveConversationId(newConversation.id);
      conversationId = newConversation.id;
    }

    setIsTyping(true);

    const aiMessageId = generateId();
    const aiMessage: Message = {
      id: aiMessageId,
      content: '',
      role: 'assistant',
      timestamp: new Date(),
      isChildExplain: true,
    };

    setConversations(prev => prev.map(c =>
      c.id === conversationId
        ? { ...c, messages: [...c.messages, aiMessage], updatedAt: new Date() }
        : c
    ));

    try {
      const response = await fetch('http://localhost:8000/api/explain-like-child', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic, language }),
      });

      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

      const data = await response.json();

      setConversations(prev => prev.map(c =>
        c.id === conversationId
          ? {
              ...c,
              messages: c.messages.map(m =>
                m.id === aiMessageId
                  ? { ...m, content: data.response, isChildExplain: true }
                  : m
              ),
              updatedAt: new Date(),
            }
          : c
      ));
    } catch (error) {
      console.error('Explain like child error:', error);
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
  }, [activeConversationId]);

  // ── Main sendMessage (streaming) ────────────────────────────────────────
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

      const response = await fetch('http://localhost:8000/api/chat/stream', {
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
        let streamedText = '';
        let buffer = '';
        let done = false;

        while (!done) {
          const { value, done: readerDone } = await reader.read();
          done = readerDone;

          if (value) {
            buffer += decoder.decode(value, { stream: true });

            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed.startsWith('data: ')) continue;

              const jsonStr = trimmed.slice(6).trim();
              if (!jsonStr || jsonStr === '[DONE]') { done = true; break; }

              try {
                const parsed = JSON.parse(jsonStr);

                if (parsed.type === 'token' && parsed.content) {
                  streamedText += parsed.content;
                  const snapshot = streamedText;
                  setConversations(prev => prev.map(c =>
                    c.id === conversationId
                      ? {
                          ...c,
                          messages: c.messages.map(m =>
                            m.id === aiMessageId ? { ...m, content: snapshot } : m
                          ),
                          updatedAt: new Date(),
                        }
                      : c
                  ));
                }

                if (parsed.type === 'prefix' && parsed.content) {
                  const prefixContent = parsed.content;
                  setConversations(prev => prev.map(c =>
                    c.id === conversationId
                      ? {
                          ...c,
                          messages: c.messages.map(m =>
                            m.id === aiMessageId
                              ? { ...m, content: prefixContent + (m.content || '') }
                              : m
                          ),
                          updatedAt: new Date(),
                        }
                      : c
                  ));
                  streamedText = prefixContent + streamedText;
                }

                if (parsed.type === 'image' && parsed.url) {
                  const imageUrl = parsed.url;
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
                }

                if (parsed.type === 'done') { done = true; break; }

                if (parsed.type === 'error') {
                  throw new Error(parsed.message || 'Stream error');
                }
              } catch {
                // partial / non-JSON line — skip
              }
            }
          }
        }
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
    explainLikeChild,
    deleteConversation,
  };
}