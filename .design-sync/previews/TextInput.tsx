import { TextInput } from "@drift/ui";

export const Placeholder = () => (
  <div className="max-w-md">
    <TextInput placeholder="e.g. Deadhand, Ghost Sense, The Closer" />
  </div>
);

export const Filled = () => (
  <div className="max-w-md">
    <TextInput defaultValue="Vale Okonkwo" />
  </div>
);
