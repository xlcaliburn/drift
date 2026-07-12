/** A single displayed line in the play transcript. Shared by server + client. */
export interface ChatEntry {
  /** `recap` = deterministic, free opening context (not LLM-generated). */
  role: "player" | "dm" | "system" | "recap";
  text: string;
}
