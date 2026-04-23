export function createHealthRepository(db) {
  return {
    check() {
      return db.prepare('SELECT 1').get();
    },
  };
}
