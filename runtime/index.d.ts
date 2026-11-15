// Module entry for code that imports the runtime (playtest harness, players,
// tools). Carts don't import anything; they use the global `Arcade` types
// from cart.d.ts and test-hook.d.ts.

/// <reference path="./cart.d.ts" />
/// <reference path="./test-hook.d.ts" />

export type G = Arcade.G;
export type Cart<S = any> = Arcade.Cart<S>;
export type Button = Arcade.Button;
export type Player = Arcade.Player;
export type Color = Arcade.Color;
export type Sprite = Arcade.Sprite;
export type TestHandle = Arcade.TestHandle;
export type InputScript = Arcade.InputScript;
export type Frame = Arcade.Frame;
export type Checks = Arcade.Checks;

export const W: 256;
export const H: 192;
export const BUTTONS: readonly Arcade.Button[];
/** Most controllers a console can have (D110): `Arcade.Player` is 1..MAX_PLAYERS. */
export const MAX_PLAYERS: 8;
/** The 32-color house palette as "#rrggbb", index 0..31 (D3). */
export const PALETTE: readonly string[];
/** Palette names to indices. */
export const COLORS: Readonly<Arcade.Colors>;

export interface HeadlessOptions {
  /** RNG seed. Default 1. */
  seed?: number;
  /** Initial g.load() data. Default null. */
  save?: unknown;
  /** Controllers for this run (D110), 1..8. Default 1, like the cabinet. */
  players?: number;
  /** Also draw a gliding cart's glide picture (D476), at this many display pixels per game pixel (2..8; the cabinet's is 4). Default none. */
  fine?: number;
}

/**
 * Load a cart module in Node and return a test handle with no browser
 * (runtime/headless.js). `cart` is a game.js path or file URL, or a Cart object.
 */
export function headless(cart: string | URL | Arcade.Cart, opts?: HeadlessOptions): Promise<Arcade.TestHandle & { warnings(): Promise<Arcade.Warning[]> }>;
