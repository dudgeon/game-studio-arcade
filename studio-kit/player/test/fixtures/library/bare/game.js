// A cart with no cart.json or spec.md: the player still lists and plays it.
export default {
  init() {
    return { t: 0 };
  },
  update(g, s) {
    s.t++;
  },
  draw(g, s) {
    g.cls(g.colors.night);
    g.text(`BARE ${s.t}`, 4, 4, g.colors.white);
  },
};
