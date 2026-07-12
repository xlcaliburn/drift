/**
 * DRIFT theme tokens as a Tailwind preset.
 * The app's tailwind.config.ts can adopt this via `presets: [driftPreset]`
 * so the game and the design system share one source of truth.
 */
declare const driftPreset: {
    theme: {
        extend: {
            colors: {
                /** Page background — near-black blue. */
                ink: string;
                /** Raised surface — cards, bubbles, modals. */
                panel: string;
                /** Hairline borders and dividers. */
                edge: string;
                /** Brand amber — primary actions, active states, warnings. */
                accent: string;
                /** Positive — health, success, approvals. */
                good: string;
                /** Negative — damage, errors, threat clocks. */
                bad: string;
            };
            fontFamily: {
                mono: [string, string, string, string];
            };
        };
    };
};

export { driftPreset as default };
