export interface AssetBucket {
  list(path: string, options: {
    limit: number;
    offset: number;
    sortBy: { column: string; order: string };
  }): Promise<
    { data: { name: string; id?: string | null }[] | null; error: unknown }
  >;
  remove(paths: string[]): Promise<{ error: unknown }>;
}

export class AccountDeletionError extends Error {
  constructor(public readonly phase: "billing" | "storage" | "auth", cause: unknown) {
    super(`Account deletion ${phase} phase failed; retry required`, { cause });
    this.name = "AccountDeletionError";
  }
}

// Limits bound API work even with stale listings, no-op removals or active uploads.
export const ASSET_PAGE_SIZE = 100;
export const ASSET_MAX_CALLS = 200;

/** Drain only the authenticated UUID's coach-assets subtree via the Storage API.
 * Always re-read offset zero: successful removals shift later pages forward.
 * Storage is NONTRANSACTIONAL: removed blobs cannot roll back with Auth/public SQL.
 * A retry safely resumes from remaining objects, including obsolete extensions.
 * Residual: uploads can race the final empty list / Auth delete. A durable deletion
 * job plus server-owned pending state and Storage write fencing is still needed.
 * This does not claim to clean other buckets or repair ownership outside this prefix.
 */
export async function deleteOwnedCoachAssets(
  bucket: AssetBucket,
  userId: string,
) {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      userId,
    )
  ) {
    throw new Error("Invalid authenticated user ID");
  }
  const root = `${userId}/`;
  let calls = 0;
  const spend = () => {
    if (++calls > ASSET_MAX_CALLS) {
      throw new Error("Storage cleanup call limit reached");
    }
  };
  const drain = async (prefix: string): Promise<void> => {
    while (true) {
      spend();
      const { data, error } = await bucket.list(prefix, {
        limit: ASSET_PAGE_SIZE,
        offset: 0,
        sortBy: { column: "name", order: "asc" },
      });
      if (error) throw error;
      if (!Array.isArray(data) || data.length > ASSET_PAGE_SIZE) {
        throw new Error("Invalid Storage listing");
      }
      if (data.length === 0) return;
      // Validate the ENTIRE batch before deleting anything from this batch.
      const entries = data.map((entry) => {
        if (
          !entry || typeof entry.name !== "string" || !entry.name ||
          entry.name === "." || entry.name === ".." ||
          (/[/\\%]/.test(entry.name) ||
            [...entry.name].some((char) =>
              char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127
            ))
        ) {
          throw new Error("Unsafe Storage entry name");
        }
        const path = `${prefix}${entry.name}`;
        if (!path.startsWith(root)) {
          throw new Error("Storage path outside owner prefix");
        }
        if (entry.id !== null && (typeof entry.id !== "string" || !entry.id)) {
          throw new Error("Invalid Storage entry identity");
        }
        return { path, folder: entry.id === null };
      });
      const paths = entries.filter((entry) => !entry.folder).map((entry) =>
        entry.path
      );
      if (paths.length) {
        spend();
        const { error: removeError } = await bucket.remove(paths);
        if (removeError) throw removeError;
      }
      for (const entry of entries) {
        if (entry.folder) await drain(`${entry.path}/`);
      }
      // Even a short batch must be followed by a checked empty listing.
    }
  };
  await drain(root);
}

/** The callback is never reached on failed or incomplete Storage cleanup. */
export async function deleteAccountWithAssets(
  bucket: AssetBucket,
  authenticatedUserId: string,
  deleteAuthUser: (
    userId: string,
    softDelete: false,
  ) => Promise<{ error: unknown }>,
): Promise<void> {
  try {
    await deleteOwnedCoachAssets(bucket, authenticatedUserId);
  } catch (error) {
    throw new AccountDeletionError("storage", error);
  }
  try {
    // Only Auth/public cleanup is transactional through the existing SQL trigger.
    const { error } = await deleteAuthUser(authenticatedUserId, false);
    if (error) throw error;
  } catch (error) {
    throw new AccountDeletionError("auth", error);
  }
}
