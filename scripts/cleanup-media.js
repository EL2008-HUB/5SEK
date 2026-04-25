const db = require("../src/db/knex");
const {
  cleanupHiddenMedia,
  cleanupOrphanedSignedUploads,
} = require("../src/services/cleanupService");

async function run() {
  const hiddenMedia = await cleanupHiddenMedia(db);
  const orphanedUploads = await cleanupOrphanedSignedUploads(db);

  console.log(
    `Cleanup complete: hidden_media=${hiddenMedia.cleaned}/${hiddenMedia.scanned}, orphaned_uploads=${orphanedUploads.deleted || 0}/${orphanedUploads.scanned || 0}`
  );
  await db.destroy();
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
