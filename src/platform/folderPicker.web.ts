// Web folder import via a hidden <input webkitdirectory>. Reads every file in
// the chosen folder (recursively, including subfolders) into memory so the
// Library can encrypt + store them, preserving the folder layout as albums.
//
// Resolution is driven only by the input's own `change` (files chosen) and
// `cancel` (dismissed) events. We deliberately do NOT use a window-focus +
// timeout heuristic to detect cancel: Chrome shows an "Upload N files to this
// site?" confirmation AFTER focus returns, so any short timeout fires while the
// user is still confirming, resolves empty, and the real selection is then
// dropped — which is exactly why "whole folder" appeared to do nothing.
export interface PickedFile {
  name: string;
  mime?: string;
  relPath: string; // webkitRelativePath, e.g. "trip/sub/img.jpg"
  // Read this one file's bytes on demand. Reading lazily (one at a time, as the
  // importer stores each file) keeps a big folder from loading entirely into
  // memory at once.
  read: () => Promise<Uint8Array>;
}

export const folderImportSupported = true;

export async function pickFolder(): Promise<PickedFile[]> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    // non-standard but supported by all evergreen browsers
    (input as unknown as { webkitdirectory: boolean }).webkitdirectory = true;
    input.multiple = true;
    input.style.display = "none";

    let done = false;
    const finish = (run: () => void) => {
      if (done) return;
      done = true;
      input.remove();
      run();
    };

    input.addEventListener("change", () => {
      try {
        const out: PickedFile[] = Array.from(input.files ?? []).map((f) => ({
          name: f.name,
          mime: f.type || undefined,
          relPath: (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name,
          read: async () => new Uint8Array(await f.arrayBuffer()),
        }));
        finish(() => resolve(out));
      } catch (e) {
        finish(() => reject(e instanceof Error ? e : new Error("Folder read failed")));
      }
    });

    // Modern browsers fire 'cancel' when the dialog is dismissed with no choice.
    input.addEventListener("cancel", () => finish(() => resolve([])));

    document.body.appendChild(input);
    input.click();
  });
}
