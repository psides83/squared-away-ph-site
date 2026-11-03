type Candidate = {
  id: string;
  horse_id: string;
  path: string;
  content_type: string;
};
export async function cleanupAbandonedVideos(worker: {
  claim: () => Promise<Candidate[]>;
  remove: (path: string) => Promise<boolean>;
  record: (id: string, success: boolean) => Promise<void>;
}) {
  const rows = await worker.claim();
  if (!Array.isArray(rows) || rows.length > 5)
    throw Error("Invalid cleanup batch");
  let deleted = 0,
    failed = 0;
  for (const row of rows) {
    const uuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const extension = (
      {
        "video/mp4": "mp4",
        "video/quicktime": "mov",
        "video/webm": "webm",
      } as Record<string, string>
    )[row.content_type];
    if (
      !uuid.test(row.id) ||
      !uuid.test(row.horse_id) ||
      !extension ||
      row.path !== `${row.horse_id}/${row.id}.${extension}`
    )
      throw Error("Invalid cleanup path");
    let success = false;
    try {
      success = await worker.remove(row.path);
    } catch {
      /* Retry on the next run; never record completion on an uncertain response. */
    }
    await worker.record(row.id, success);
    if (success) deleted++;
    else failed++;
  }
  return { deleted, failed };
}
