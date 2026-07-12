import { Field, TextInput, Select } from "@drift/ui";

/** Standard labeled text field. */
export const WithInput = () => (
  <div className="max-w-md">
    <Field label="Name">
      <TextInput placeholder="A name the lanes would use — e.g. Silas Corr" />
    </Field>
  </div>
);

export const WithHint = () => (
  <div className="max-w-md">
    <Field label="The scenario (be specific — the GM decides when it applies)" hint="The narrower the scenario, the more the GM will let it hit.">
      <TextInput defaultValue="when piloting through a debris field" />
    </Field>
  </div>
);

export const WithSelect = () => (
  <div className="max-w-md">
    <Field label="Which skill">
      <Select defaultValue="piloting">
        <option value="piloting">piloting</option>
        <option value="gunnery">gunnery</option>
        <option value="stealth">stealth</option>
      </Select>
    </Field>
  </div>
);
