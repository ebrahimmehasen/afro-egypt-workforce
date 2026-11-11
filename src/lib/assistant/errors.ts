export type AssistantErrorCode = "not_configured" | "auth" | "rate_limited" | "unavailable" | "timeout" | "bad_response" | "busy";

export class AssistantError extends Error {
  constructor(
    public readonly code: AssistantErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AssistantError";
  }
}
