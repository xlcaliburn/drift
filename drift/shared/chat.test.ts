import { describe, it, expect } from "vitest";
import { appendTranscript, TRANSCRIPT_CAP, type ChatEntry } from "./chat";

const entry = (n: number): ChatEntry => ({ role: "player", text: `turn ${n}` });
const many = (n: number): ChatEntry[] => Array.from({ length: n }, (_, i) => entry(i));

describe("appendTranscript — the trim-drift fix (CHECKS.md §1)", () => {
  it("under cap: appends without touching startTranscriptIdx", () => {
    const sceneCard = { startTranscriptIdx: 12 };
    const transcript = many(50);
    const result = appendTranscript(transcript, [entry(50), entry(51)], sceneCard);
    expect(result).toHaveLength(52);
    expect(sceneCard.startTranscriptIdx).toBe(12); // unchanged — no trim happened
  });

  it("at cap: dropping N entries decrements startTranscriptIdx by N", () => {
    const sceneCard = { startTranscriptIdx: 380 };
    const transcript = many(TRANSCRIPT_CAP); // already at the cap
    const result = appendTranscript(transcript, [entry(1000), entry(1001), entry(1002)], sceneCard);
    expect(result).toHaveLength(TRANSCRIPT_CAP);
    // 3 new entries pushed the combined length to 403 -> 3 dropped off the front.
    expect(sceneCard.startTranscriptIdx).toBe(377);
  });

  it("clamps the rebased index at 0 rather than going negative", () => {
    const sceneCard = { startTranscriptIdx: 2 };
    const transcript = many(TRANSCRIPT_CAP);
    appendTranscript(transcript, many(10), sceneCard);
    expect(sceneCard.startTranscriptIdx).toBe(0);
  });

  it("realistic sequence: a scene opened just under the cap survives 12 turns of trimming, slicing to EXACTLY its own entries (the Lyra scenario)", () => {
    // carryScene sets startTranscriptIdx = transcript.length AT THE MOMENT the
    // scene opens — here, 380 pre-scene entries already exist.
    const sceneCard = { startTranscriptIdx: 380 };
    let transcript = many(380);
    // 12 turns * 3 entries/turn = 36 new entries — the scene grows PAST the cap
    // partway through, exactly the live Lyra shape (a busy scene at a busy point
    // in a long campaign). One appendTranscript call per turn, as the route does.
    const sceneEntries: ChatEntry[] = [];
    for (let turn = 0; turn < 12; turn++) {
      const adds = [
        { role: "player" as const, text: `player ${turn}` },
        { role: "system" as const, text: `engine ${turn}` },
        { role: "dm" as const, text: `dm ${turn}` },
      ];
      sceneEntries.push(...adds);
      transcript = appendTranscript(transcript, adds, sceneCard);
    }
    // The scene's own entries are always the NEWEST — trimming only ever removes
    // PRE-scene entries — so all 36 survive; only the drift on the older content
    // needs correcting, and the corrected index recovers the scene exactly.
    expect(transcript).toHaveLength(TRANSCRIPT_CAP);
    expect(transcript.slice(sceneCard.startTranscriptIdx)).toEqual(sceneEntries);
  });

  it("a scene opened well before the cap is never touched until trimming actually starts", () => {
    const sceneCard = { startTranscriptIdx: 10 };
    let transcript = many(50); // nowhere near the cap
    for (let i = 0; i < 5; i++) {
      transcript = appendTranscript(transcript, [entry(1000 + i)], sceneCard);
    }
    expect(sceneCard.startTranscriptIdx).toBe(10);
    expect(transcript).toHaveLength(55);
  });
});
