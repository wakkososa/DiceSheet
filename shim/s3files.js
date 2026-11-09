// Stand-in for DiceCloud's S3 file storage (only the archive schema is needed in the harness)
export const createS3FilesCollection = () => ({ insert() {}, findOne() {}, remove() {} });
