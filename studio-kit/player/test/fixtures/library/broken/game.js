// A cart whose init throws: the player shows the error and a way back.
export default {
  init() {
    throw new Error("broken on purpose");
  },
  update() {},
  draw() {},
};
