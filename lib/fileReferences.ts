interface FileReferenceIdentity {
  id?: number | string;
  path?: string | null;
  filename?: string;
}

/** One file chip per identity, preserving first-seen order and all segment citations. */
export function uniqueFileReferences<T extends FileReferenceIdentity>(
  references: readonly T[]
): T[] {
  const seen = new Set<string>();
  return references.filter((reference) => {
    const key =
      reference.id != null
        ? `id:${reference.id}`
        : reference.path
          ? `path:${reference.path}`
          : reference.filename
            ? `filename:${reference.filename}`
            : null;
    // A display name alone does not identify a file: different uploads may share it.
    if (key === null) return true;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
