const TOLERANCE_MS = 60_000;

export const createdAtOf = (project) => (project.createdAt ? { createdAt: project.createdAt } : {});

const correctDates = async ({ records, projects, repoIdOf, path, repository }) => {
  const created = new Map(projects.filter((project) => project.createdAt).map((project) => [project.id, new Date(project.createdAt)]));
  await Promise.all(records.map(async (record) => {
    const at = created.get(repoIdOf(record));
    if (!at) return;
    const recorded = record.get(path);
    if (recorded && Math.abs(at - recorded) <= TOLERANCE_MS) return;
    record.set(path, at);
    await repository.save(record).catch((error) => console.error(`[hostDates] could not correct the date of ${record._id}:`, error?.message ?? error));
  }));
};

/** What LINEA found on the host was dated the day it found it: the date of its repository is the one that counts. */
export const correctLineDates = ({ lines, projects, repository }) => correctDates({
  records: lines, projects, repository, repoIdOf: (line) => line.repoId, path: 'createdAt',
});

export const correctProductDates = ({ products, projects, repository }) => correctDates({
  records: products, projects, repository, repoIdOf: (product) => product.repo?.id, path: 'spec.basicData.createdAt',
});
