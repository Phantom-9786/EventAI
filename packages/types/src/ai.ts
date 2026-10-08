// ── AI types ───────────────────────────────────────

/** Supported AI providers */
export enum AIProvider {
  GROK = 'grok',
  OPENAI = 'openai',
  GEMINI = 'gemini',
  ANTHROPIC = 'anthropic',
}

/** Chat message */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCallId?: string;
  toolCalls?: ToolCall[];
}

/** Tool call from LLM */
export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string; // JSON string
  };
}

/** Tool definition for LLM */
export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>; // JSON Schema
  };
}

/** LLM completion request */
export interface LLMCompletionRequest {
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
}

/** LLM completion response */
export interface LLMCompletionResponse {
  message: ChatMessage;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  finishReason: 'stop' | 'tool_calls' | 'length';
}

/** AI assistant conversation */
export interface AIConversation {
  id: string;
  userId: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
}

/** AI assistant request */
export interface AIAssistantRequest {
  message: string;
  conversationId?: string;
}

/** AI assistant response */
export interface AIAssistantResponse {
  reply: string;
  conversationId: string;
  toolsUsed?: string[];
  sources?: RAGSource[];
}

/** RAG source reference */
export interface RAGSource {
  documentId: string;
  documentType: string;
  score: number;
  content: string;
  metadata?: Record<string, unknown>;
}

/** Embedding request */
export interface EmbeddingRequest {
  text: string | string[];
  model?: string;
}

/** Embedding response */
export interface EmbeddingResponse {
  embeddings: number[][];
  model: string;
  usage: { totalTokens: number };
}

/** Event recommendation */
export interface EventRecommendation {
  eventId: string;
  score: number;
  reasons: string[];
}
