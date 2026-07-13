-- Store the round-by-round tool-loop exchange for a turn (assistant text +
-- tool_use calls + tool_result payloads across every round) so the admin AI-calls
-- audit can show what happened each round, not just the final narration.
-- Only populated for multi-round turns; single-round turns leave it null.
alter table ai_calls add column if not exists exchange_dump text;
