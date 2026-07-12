import { Stepper } from "@drift/ui";

const CREATION_STEPS = ["The world", "Your faction", "Who you are", "Your signature", "Review", "Meet"];

/** Mid-flow — two steps done (green), current bold amber. */
export const MidFlow = () => <Stepper steps={CREATION_STEPS} current={2} />;

export const Start = () => <Stepper steps={CREATION_STEPS} current={0} />;

export const LastStep = () => <Stepper steps={CREATION_STEPS} current={5} />;
