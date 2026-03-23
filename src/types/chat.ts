export interface UploadedFile {
  filename: string;
  file_type: 'pdf' | 'image' | 'text';
  chars_extracted: number;
  processing: boolean;
  ready: boolean;
  error?: string;
  preview?: string;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  imageUrl?: string;
  isChildExplain?: boolean;
}

export interface Conversation {
  id: string;
  title: string;
  messages: Message[];
  createdAt: Date;
  updatedAt: Date;
  uploadedFile?: UploadedFile;
}
