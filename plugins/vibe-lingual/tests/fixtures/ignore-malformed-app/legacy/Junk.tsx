// Even with an unparseable eslint config, the built-in default exclude list keeps
// legacy/ out of the inventory.

export default function Junk() {
  return <div>Legacy junk that the default fallback still excludes</div>;
}
