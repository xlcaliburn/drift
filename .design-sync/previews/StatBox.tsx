import { StatBox } from "@drift/ui";

/** The vitals strip from the character sheet. */
export const Vitals = () => (
  <div className="grid max-w-md grid-cols-4 gap-2 text-center">
    <StatBox label="HP" value="12/14" />
    <StatBox label="AC" value={15} />
    <StatBox label="Credits" value="¢220" />
    <StatBox label="Stims" value={2} />
  </div>
);

export const Attributes = () => (
  <div className="grid max-w-md grid-cols-3 gap-2 sm:grid-cols-6">
    <StatBox label="MIG" value="+1" />
    <StatBox label="REF" value="+3" />
    <StatBox label="VIT" value="+0" />
    <StatBox label="INT" value="+2" />
    <StatBox label="PER" value="+1" />
    <StatBox label="PRE" value="-1" />
  </div>
);
