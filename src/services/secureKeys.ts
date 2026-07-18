/**
 * API-key storage — iOS Keychain via expo-secure-store, and NOTHING else
 * (spec §6 v10 security note). The key must never touch the settings
 * table or the audited change_log path: settings changes are logged in
 * plaintext to an on-disk audit table by design, which is exactly where a
 * credential must not live. This module is the ONLY place the key is
 * read or written.
 */
import * as SecureStore from 'expo-secure-store';

const ANTHROPIC_KEY = 'anthropic_api_key';

export async function getAnthropicKey(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(ANTHROPIC_KEY);
  } catch {
    return null;
  }
}

export async function setAnthropicKey(key: string): Promise<void> {
  if (key.trim() === '') {
    await SecureStore.deleteItemAsync(ANTHROPIC_KEY);
    return;
  }
  await SecureStore.setItemAsync(ANTHROPIC_KEY, key.trim(), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

export async function hasAnthropicKey(): Promise<boolean> {
  return (await getAnthropicKey()) !== null;
}
