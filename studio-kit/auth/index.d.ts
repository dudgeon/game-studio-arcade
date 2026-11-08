import Anthropic, { type ClientOptions } from "@anthropic-ai/sdk";

export declare const DEFAULT_PROFILE: "game-studio-arcade";
export declare const SETUP_HINT: string;

export declare class AuthSetupError extends Error {
  constructor(message: string, options?: { cause?: unknown });
}

export type CreateClientOptions = Omit<ClientOptions, "apiKey" | "authToken" | "credentials" | "config" | "profile"> & {
  /** Profile name; defaults to $GSA_PROFILE, then "game-studio-arcade". */
  profile?: string;
};

export declare function profileName(options?: { profile?: string }): string;
export declare function createClient(options?: CreateClientOptions): Anthropic;
export declare function checkAuth(client?: Anthropic): Promise<{ ok: true; profile: string; firstModel: string | null }>;
