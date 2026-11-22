"use client";

export type PromptDraft = { prompt: string; file: File | null; style: string; aspect: string };
const DB = "unfold-drafts";

function openDrafts(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("drafts");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("Couldn't keep your clip. Please try again."));
  });
}

/** Keep an attached clip across navigation or an email sign-in redirect. */
export async function savePromptDraft(draft: PromptDraft): Promise<string> {
  const db = await openDrafts();
  const id = crypto.randomUUID();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("drafts", "readwrite");
      tx.objectStore("drafts").put({ ...draft, createdAt: Date.now() }, id);
      tx.oncomplete = () => resolve();
      tx.onerror = tx.onabort = () => reject(new Error("Couldn't keep your clip. Please try again."));
    });
    return id;
  } finally {
    db.close();
  }
}

export async function readPromptDraft(id: string): Promise<PromptDraft | null> {
  const db = await openDrafts();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction("drafts").objectStore("drafts").get(id);
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(new Error("Couldn't recover your clip. Please attach it again."));
    });
  } finally {
    db.close();
  }
}

export async function removePromptDraft(id: string): Promise<void> {
  const db = await openDrafts();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("drafts", "readwrite");
      tx.objectStore("drafts").delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = tx.onabort = () => reject(new Error("Couldn't clear the draft."));
    });
  } finally {
    db.close();
  }
}
