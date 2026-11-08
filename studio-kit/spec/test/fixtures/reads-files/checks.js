// Fixture: tries to reach outside the cart folder without an import.
const fs = process.getBuiltinModule('node:fs');
fs.readFileSync('/etc/hosts', 'utf8');
export default { R1: async () => {} };
