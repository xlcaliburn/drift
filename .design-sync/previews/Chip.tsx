import { Chip } from "@drift/ui";

/** Skill chips with their level as the accent value. */
export const Skills = () => (
  <div className="flex max-w-md flex-wrap gap-1.5">
    <Chip value={3}>piloting</Chip>
    <Chip value={2}>gunnery</Chip>
    <Chip value={1}>streetwise</Chip>
    <Chip value={1}>zeroG</Chip>
  </div>
);

export const Gear = () => (
  <div className="flex max-w-md flex-wrap gap-1.5">
    <Chip>Mag-pistol (1d6)</Chip>
    <Chip>Patched vac-suit</Chip>
    <Chip>Forged dock papers</Chip>
  </div>
);

/** Clickable suggestion chips — tap to fill a field. */
export const Suggestions = () => (
  <div className="flex max-w-md flex-wrap gap-1.5">
    <Chip onClick={() => {}}>people aren't cargo</Chip>
    <Chip onClick={() => {}}>never fire first</Chip>
    <Chip onClick={() => {}}>debts get paid</Chip>
  </div>
);
