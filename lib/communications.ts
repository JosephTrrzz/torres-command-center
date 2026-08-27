export const COMMUNICATION_CHANNELS = ["internal", "email", "sms", "voice"] as const;
export const CONVERSATION_STATUSES = ["open", "pending", "closed"] as const;
export const CONVERSATION_PRIORITIES = ["normal", "high", "urgent"] as const;
export const MESSAGE_STATUSES = ["draft", "queued", "sent", "delivered", "failed", "received"] as const;

export type CommunicationChannel = typeof COMMUNICATION_CHANNELS[number];
export type ConversationStatus = typeof CONVERSATION_STATUSES[number];
export type ConversationPriority = typeof CONVERSATION_PRIORITIES[number];
export type MessageStatus = typeof MESSAGE_STATUSES[number];

export interface CommunicationMessage {
  id: string;
  conversation_id: string;
  direction: "inbound" | "outbound" | "system";
  channel: CommunicationChannel;
  status: MessageStatus;
  sender_name: string;
  sender_address: string;
  recipients: string[];
  subject: string;
  body: string;
  client_visible: boolean;
  sent_at: string | null;
  created_at: string;
}

export interface Conversation {
  id: string;
  subject: string;
  channel: CommunicationChannel;
  status: ConversationStatus;
  priority: ConversationPriority;
  client_visible: boolean;
  last_message_at: string;
  created_at: string;
  messages: CommunicationMessage[];
}

export interface CommunicationsSnapshot {
  client: { id: string; name: string; industry: string; location: string };
  canManage: boolean;
  isClient: boolean;
  delivery: {
    internal: "ready";
    email: "draft_only";
    sms: "not_configured";
    voice: "not_configured";
  };
  conversations: Conversation[];
  summary: CommunicationsSummary;
}

export interface CommunicationsSummary {
  openConversations: number;
  pendingConversations: number;
  sharedMessages: number;
  emailDrafts: number;
}

export function labelCommunicationValue(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function buildCommunicationsSummary(conversations: Conversation[]): CommunicationsSummary {
  const messages = conversations.flatMap((conversation) => conversation.messages);
  return {
    openConversations: conversations.filter((conversation) => conversation.status === "open").length,
    pendingConversations: conversations.filter((conversation) => conversation.status === "pending").length,
    sharedMessages: messages.filter((message) => message.client_visible && message.status !== "draft").length,
    emailDrafts: messages.filter((message) => message.channel === "email" && message.status === "draft").length,
  };
}

export function communicationDeliveryLabel(channel: CommunicationChannel) {
  if (channel === "internal") return "Shared securely";
  if (channel === "email") return "Email draft";
  return `${labelCommunicationValue(channel)} not configured`;
}
