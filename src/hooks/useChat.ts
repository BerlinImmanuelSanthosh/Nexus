// src/hooks/useChat.ts
import { useState, useCallback } from 'react';
import { Message } from '@/types/chat';

export function useChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const sendMessage = useCallback(async (content: string) => {
    const userMessage: Message = { id: Date.now(), content, role: 'user' };
    setMessages(prev => [...prev, userMessage]);
    setIsLoading(true);

    try {
      // Send FULL conversation history (with proper role format)
      const messagesForBackend = messages
        .concat(userMessage)
        .map(msg => ({ 
          role: msg.role, 
          content: msg.content 
        }));

      const response = await fetch('http://localhost:8000/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        // Send full history instead of just { message: content }
        body: JSON.stringify({ messages: messagesForBackend }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      const aiMessage: Message = {
        id: Date.now() + 1,
        content: data.response,
        role: 'assistant',
      };
      setMessages(prev => [...prev, aiMessage]);
    } catch (error) {
      console.error('Chat error:', error);
      const errorMessage: Message = {
        id: Date.now() + 1,
        content: 'Failed to get a response. Is the backend running?',
        role: 'assistant',
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  }, [messages]); // Critical: Add messages as dependency

  return { messages, sendMessage, isLoading };
}