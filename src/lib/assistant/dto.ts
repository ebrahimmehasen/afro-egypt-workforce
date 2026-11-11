export interface AssistantMessageDTO {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

export const toDTO = (m: { id: string; role: string; content: string; createdAt: Date }): AssistantMessageDTO => ({
  id: m.id,
  role: m.role === "assistant" ? "assistant" : "user",
  content: m.content,
  createdAt: m.createdAt.toISOString(),
});
