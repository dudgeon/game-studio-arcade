// Fixture stand-in for an agent-built cart (D21 shape). Not a real game: the
// CLI tests only move it around and check its rule coverage.
export default {
  init() {
    return { lives: 3 };
  },
  update() {},
  draw() {},
  probe(_g, s) {
    return { lives: s.lives };
  },
};
