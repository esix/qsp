import { unzipSync } from 'fflate';
import { parseQsp } from 'qsp-core/parser/qsp-parser.js';

/** Collect all files from a drop event (directory or zip/qsp file) */
export async function collectDroppedFiles(e: DragEvent): Promise<Map<string, Blob>> {
  const dt = e.dataTransfer;
  if (!dt) throw new Error('No files');

  // Try directory via webkitGetAsEntry
  if (dt.items && dt.items.length > 0) {
    const entries: FileSystemEntry[] = [];
    for (let i = 0; i < dt.items.length; i++) {
      const entry = dt.items[i].webkitGetAsEntry?.();
      if (entry) entries.push(entry);
    }
    if (entries.length > 0 && entries[0].isDirectory) {
      return readDirectoryEntry(entries[0] as FileSystemDirectoryEntry);
    }
  }

  // Fall back to files list
  const fileList = dt.files;
  if (!fileList || fileList.length === 0) throw new Error('No files');

  if (fileList.length === 1) {
    return collectFromFile(fileList[0]);
  }

  // Multiple files dropped
  const map = new Map<string, Blob>();
  for (let i = 0; i < fileList.length; i++) {
    map.set(fileList[i].name.toLowerCase(), fileList[i]);
  }
  return map;
}

export async function collectFromFile(file: File): Promise<Map<string, Blob>> {
  if (/\.zip$/i.test(file.name)) return extractZip(file);
  if (/\.qsp$/i.test(file.name)) return new Map([[file.name.toLowerCase(), file]]);
  throw new Error('Expected a folder, .zip archive, or .qsp file');
}

/** Recursively read files from a FileSystemDirectoryEntry */
export async function readDirectoryEntry(dir: FileSystemDirectoryEntry, prefix = ''): Promise<Map<string, Blob>> {
  const files = new Map<string, Blob>();
  const entries = await new Promise<FileSystemEntry[]>((resolve) => {
    const reader = dir.createReader();
    const all: FileSystemEntry[] = [];
    const readBatch = () => {
      reader.readEntries((batch) => {
        if (batch.length === 0) { resolve(all); return; }
        all.push(...batch);
        readBatch();
      });
    };
    readBatch();
  });

  for (const entry of entries) {
    const path = prefix ? prefix + '/' + entry.name : entry.name;
    if (entry.isFile) {
      const file = await new Promise<File>((resolve) =>
        (entry as FileSystemFileEntry).file(resolve)
      );
      files.set(path.toLowerCase(), file);
    } else if (entry.isDirectory) {
      const sub = await readDirectoryEntry(entry as FileSystemDirectoryEntry, path);
      for (const [k, v] of sub) files.set(k, v);
    }
  }
  return files;
}

/** Extract files from a ZIP archive */
export async function extractZip(file: File): Promise<Map<string, Blob>> {
  const buffer = new Uint8Array(await file.arrayBuffer());
  const entries = unzipSync(buffer);
  const files = new Map<string, Blob>();
  for (const [path, data] of Object.entries(entries)) {
    if (path.endsWith('/')) continue;
    files.set(path.toLowerCase(), new Blob([data]));
  }
  return files;
}

/**
 * Given a file map, find the .qsp file and build a local asset map.
 * Returns { qspData, title, assets } where assets maps game-relative paths → blob URLs.
 */
export async function prepareLocalGame(files: Map<string, Blob>): Promise<{
  qspData: Uint8Array;
  title: string;
  assets: Map<string, string>;
}> {
  // Collect all .qsp files
  const qspFiles: { path: string; blob: Blob }[] = [];
  for (const [path, blob] of files) {
    if (path.endsWith('.qsp')) {
      qspFiles.push({ path, blob });
    }
  }
  if (qspFiles.length === 0) throw new Error('.qsp file not found');

  // When multiple .qsp files exist, find the main game.
  // Library files are typically referenced by name in other .qsp files via ADDQST/INCLIB.
  // The file that ISN'T referenced by others is the main game.
  let mainIdx = 0;
  if (qspFiles.length > 1) {
    // Read raw bytes of all .qsp files to check for cross-references
    const fileData = await Promise.all(qspFiles.map(async f => ({
      path: f.path,
      name: f.path.replace(/.*\//, '').toLowerCase(),
      bytes: new Uint8Array(await f.blob.arrayBuffer()),
    })));

    // For each .qsp file, check if its filename appears in any other .qsp file's raw data
    const referenced = new Set<number>();
    for (let i = 0; i < fileData.length; i++) {
      const needle = fileData[i].name;
      for (let j = 0; j < fileData.length; j++) {
        if (i === j) continue;
        // Search for the filename as a string in the raw bytes
        const haystack = new TextDecoder('utf-16le', { fatal: false }).decode(fileData[j].bytes);
        if (haystack.toLowerCase().includes(needle)) {
          referenced.add(i);
          break;
        }
      }
    }

    // Pick the first file that isn't referenced by another (= not a library)
    for (let i = 0; i < qspFiles.length; i++) {
      if (!referenced.has(i)) { mainIdx = i; break; }
    }
  }

  const qspPath = qspFiles[mainIdx].path;
  const qspBlob = qspFiles[mainIdx].blob;
  const qspDir = qspPath.includes('/') ? qspPath.slice(0, qspPath.lastIndexOf('/') + 1) : '';

  const assets = new Map<string, string>();
  for (const [path, blob] of files) {
    if (path === qspPath) continue;
    const relative = path.startsWith(qspDir) ? path.slice(qspDir.length) : path;
    assets.set(relative.toLowerCase(), URL.createObjectURL(blob));
  }

  const title = qspPath.replace(/.*\//, '').replace(/\.qsp$/i, '');
  const qspData = new Uint8Array(await qspBlob.arrayBuffer());
  return { qspData, title, assets };
}

/** Revoke all blob URLs in an asset map */
export function revokeAssets(assets: Map<string, string>): void {
  for (const url of assets.values()) URL.revokeObjectURL(url);
}
