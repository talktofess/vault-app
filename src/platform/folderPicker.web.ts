// Web folder import via a hidden <input webkitdirectory>. Reads every file in
// the chosen folder (recursively, including subfolders) into memory so the
// Library can encrypt + store them, preserving the folder layout as albums.
export interface PickedFile {
  name: string;
  bytes: Uint8Array;
  mime?: string;
  relPath: string; // webkitRelativePath, e.g. "trip/sub/img.jpg"
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

    let settled = false;
    const cleanup = () => {
      window.removeEventListener("focus", onFocus);
      input.remove();
    };

    input.onchange = async () => {
      if (settled) return;
      settled = true;
      try {
        const files = Array.from(input.files ?? []);
        const out: PickedFile[] = [];
        for (const f of files) {
          const bytes = new Uint8Array(await f.arrayBuffer());
          out.push({
            name: f.name,
            bytes,
            mime: f.type || undefined,
            relPath: (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name,
          });
        }
        resolve(out);
      } catch (e) {
        reject(e instanceof Error ? e : new Error("Folder read failed"));
      } finally {
        cleanup();
      }
    };

    // Cancel handling so the caller's spinner never hangs: modern browsers fire
    // a 'cancel' event; older ones only return window focus with no files.
    input.addEventListener("cancel", () => {
      if (!settled) {
        settled = true;
        cleanup();
        resolve([]);
      }
    });
    const onFocus = () => {
      setTimeout(() => {
        if (!settled && (!input.files || input.files.length === 0)) {
          settled = true;
          cleanup();
          resolve([]);
        }
      }, 800);
    };
    window.addEventListener("focus", onFocus);

    document.body.appendChild(input);
    input.click();
  });
}
