/** Web stub — no keychain on the web smoke-test bundle; AI stays dormant. */
export async function getAnthropicKey(): Promise<string | null> {
  return null;
}

export async function setAnthropicKey(_key: string): Promise<void> {}

export async function hasAnthropicKey(): Promise<boolean> {
  return false;
}
