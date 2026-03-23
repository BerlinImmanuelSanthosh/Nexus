import { useState, useCallback } from 'react';
import { Message, Conversation, UploadedFile } from '@/types/chat';

const generateId = () => Math.random().toString(36).substring(2, 15);

export function useChat() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [isTyping, setIsTyping] = useState(false);
  const [isUploadingFile, setIsUploadingFile] = useState(false);

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

  // ── File Upload Handler ────────────────────────────────────────────────
  const uploadFile = useCallback(async (file: File, conversationId?: string) => {
    let targetConversationId = conversationId || activeConversationId;

    if (!targetConversationId) {
      const newConversation: Conversation = {
        id: generateId(),
        title: `Chat with ${file.name}`,
        messages: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      setConversations(prev => [newConversation, ...prev]);
      setActiveConversationId(newConversation.id);
      targetConversationId = newConversation.id;
    }

    setIsUploadingFile(true);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch('http://localhost:8000/api/upload-file', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`Upload failed: ${response.statusText}`);
      }

      const data = await response.json();

      if (data.success) {
        const uploadedFile: UploadedFile = {
          filename: data.filename,
          file_type: data.file_type,
          chars_extracted: data.chars_extracted || 0,
          processing: data.processing || false,
          ready: !data.processing,
          preview: data.preview,
        };

        setConversations(prev => prev.map(c =>
          c.id === targetConversationId
            ? { ...c, uploadedFile, updatedAt: new Date() }
            : c
        ));

        console.log(`✅ File uploaded: ${file.name}`);
        return uploadedFile;
      } else {
        throw new Error(data.message || 'Upload failed');
      }
    } catch (error) {
      console.error('File upload error:', error);
      const uploadedFile: UploadedFile = {
        filename: file.name,
        file_type: 'pdf',
        chars_extracted: 0,
        processing: false,
        ready: false,
        error: String(error),
      };
      setConversations(prev => prev.map(c =>
        c.id === targetConversationId
          ? { ...c, uploadedFile, updatedAt: new Date() }
          : c
      ));
      throw error;
    } finally {
      setIsUploadingFile(false);
    }
  }, [activeConversationId]);

  // ── Check Upload Status ────────────────────────────────────────────────
  const checkUploadStatus = useCallback(async (conversationId?: string) => {
    const targetConversationId = conversationId || activeConversationId;
    if (!targetConversationId) return null;

    try {
      const response = await fetch('http://localhost:8000/api/upload-status');
      if (!response.ok) throw new Error('Failed to check status');

      const data = await response.json();
      const uploadedFile: UploadedFile = {
        filename: data.filename || '',
        file_type: data.file_type || 'pdf',
        chars_extracted: data.chars_extracted || 0,
        processing: data.processing || false,
        ready: data.ready || false,
        error: data.error,
      };

      setConversations(prev => prev.map(c =>
        c.id === targetConversationId
          ? { ...c, uploadedFile, updatedAt: new Date() }
          : c
      ));

      return uploadedFile;
    } catch (error) {
      console.error('Status check error:', error);
      return null;
    }
  }, [activeConversationId]);

  // ── Clear Uploaded File ────────────────────────────────────────────────
  const clearFile = useCallback(async (conversationId?: string) => {
    const targetConversationId = conversationId || activeConversationId;
    if (!targetConversationId) return;

    try {
      const response = await fetch('http://localhost:8000/api/clear-file', {
        method: 'POST',
      });

      if (!response.ok) throw new Error('Failed to clear file');

      setConversations(prev => prev.map(c =>
        c.id === targetConversationId
          ? { ...c, uploadedFile: undefined, updatedAt: new Date() }
          : c
      ));

      console.log('✅ File cleared');
    } catch (error) {
      console.error('Clear file error:', error);
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
    isUploadingFile,
    setActiveConversationId,
    createNewConversation,
    sendMessage,
    explainLikeChild,
    deleteConversation,
    uploadFile,
    checkUploadStatus,
    clearFile,
  };
}