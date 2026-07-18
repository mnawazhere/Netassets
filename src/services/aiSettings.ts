/** The cloud-AI toggle lives in ordinary (audited) settings — it's a
 *  preference, not a secret. The API KEY does not: see secureKeys.ts. */
export const SETTING_KEYS_AI = {
  aiFallbackEnabled: 'ai_fallback_enabled',
} as const;
