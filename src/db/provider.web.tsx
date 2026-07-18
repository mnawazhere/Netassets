/** Web build: no sqlite — render straight through. The app is iOS-first
 *  (spec §10); web exists only as a bundling smoke test. */
import * as React from 'react';

export function DatabaseProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
