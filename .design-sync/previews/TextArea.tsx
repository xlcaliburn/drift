import { TextArea } from "@drift/ui";

/** The action composer at the foot of the play screen. */
export const Composer = () => (
  <div className="max-w-xl">
    <TextArea rows={2} placeholder="What does Silas Corr do?" />
  </div>
);

export const Feedback = () => (
  <div className="max-w-xl">
    <TextArea
      rows={4}
      defaultValue="The dock fees feel too punishing early on — I'm losing more to the harbormaster than to the Hollow Crown."
    />
  </div>
);
