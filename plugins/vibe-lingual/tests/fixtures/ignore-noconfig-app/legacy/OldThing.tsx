// No .gitignore, no eslint config in this app — but the BUILT-IN DEFAULT exclude
// list still keeps legacy/ out of the inventory (the documented fallback).

export default function OldThing() {
  return <div>Legacy headline that must still be excluded by the default list</div>;
}
