// Video poster frames. The real implementation is poster.web.ts (canvas frame
// grab). Native builds don't generate posters yet, so callers fall back to the
// video icon.
export const posterSupported = false;

export async function makeVideoPoster(_uri: string): Promise<Uint8Array | null> {
  return null;
}
