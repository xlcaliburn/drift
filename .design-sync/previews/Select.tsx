import { Select } from "@drift/ui";

export const SkillPicker = () => (
  <div className="max-w-xs">
    <Select defaultValue="piloting">
      <option value="piloting">piloting</option>
      <option value="gunnery">gunnery</option>
      <option value="smallArms">smallArms</option>
      <option value="stealth">stealth</option>
      <option value="negotiation">negotiation</option>
    </Select>
  </div>
);

export const Amount = () => (
  <div className="max-w-xs">
    <Select defaultValue="2">
      <option value="1">+1</option>
      <option value="2">+2</option>
    </Select>
  </div>
);
