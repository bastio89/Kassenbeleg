import type { AiMode, AiProvider } from "../config";

export interface ChatRequest {
  system: string;
  user: string;
  images?: Buffer[];
  /** JSON-Schema, das die Antwort erfüllen muss (Structured Output) */
  schema: Record<string, unknown>;
  schemaName: string;
  mode: AiMode;
}

export interface ChatResult {
  content: string;
  model: string;
}

export interface LlmClient {
  provider: AiProvider;
  isConfigured(): boolean;
  chat(req: ChatRequest): Promise<ChatResult>;
}

export interface ExtractedItem {
  name: string;
  quantity: number;
  unitPrice: number | null;
  totalPrice: number;
}

export interface Extraction {
  merchant: string | null;
  merchantAddress: string | null;
  date: string | null;
  time: string | null;
  total: number | null;
  currency: string;
  paymentMethod: string | null;
  items: ExtractedItem[];
}

export interface CategoryAssignment {
  index: number;
  category: string;
}
