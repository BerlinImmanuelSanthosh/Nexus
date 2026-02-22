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

    try {
      const currentConversation = conversations.find(c => c.id === conversationId);

      // 🔥 KEY FIX: Detect click re-explain trigger
      const isReExplain = content.toLowerCase().includes('reexplain');

      let messagesForBackend;

      if (isReExplain && currentConversation) {
        const firstUserMessage = currentConversation.messages.find(m => m.role === 'user');
        messagesForBackend = firstUserMessage
          ? [{ role: 'user', content: firstUserMessage.content }]
          : [{ role: 'user', content }];
      } else {
        messagesForBackend = [...(currentConversation?.messages || []), userMessage]
          .map(msg => ({
            role: msg.role,
            content: msg.content
          }));
      }

      const response = await fetch('http://localhost:8000/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messages: messagesForBackend,
          mode: 'simple_english'
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();

      // Generate a related image from query keywords
      const keywords = content
        .split(/\s+/)
        .filter(w => w.length > 2)
        .slice(0, 3)
        .join('+');

      const imageUrl = `https://loremflickr.com/800/400/${encodeURIComponent(keywords)}`;

      const aiMessage: Message = {
        id: generateId(),
        content: data.response,
        role: 'assistant',
        timestamp: new Date(),
        imageUrl,
      };

      setConversations(prev => prev.map(c =>
        c.id === conversationId
          ? { ...c, messages: [...c.messages, aiMessage], updatedAt: new Date() }
          : c
      ));

    } catch (error) {
      console.error('Chat error:', error);

      const errorMessage: Message = {
        id: generateId(),
        content: 'Failed to get a response. Is the backend running?',
        role: 'assistant',
        timestamp: new Date(),
      };

      setConversations(prev => prev.map(c =>
        c.id === conversationId
          ? { ...c, messages: [...c.messages, errorMessage], updatedAt: new Date() }
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
    deleteConversation,
  };
}