// Folder import is a browser capability (webkitdirectory). On native there's no
// portable "pick a folder and read every file" API, so this is a no-op stub and
// the Library hides the option. (Native users multi-select files instead.)
export interface PickedFile {
  name: string;
  bytes: Uint8Array;
  mime?: string;
  relPath: string; // path within the chosen folder, e.g. "trip/sub/img.jpg"
}

export const folderImportSupported = false;

export async function pickFolder(): Promise<PickedFile[]> {
  return [];
}
