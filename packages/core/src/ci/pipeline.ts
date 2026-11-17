const JOB_NAME_UNSAFE = /[^A-Za-z0-9_.-]/g

/**
 * The child pipeline of an SPL merge request: one job per selected product that derives it from the head of the SPL, rejects annotations
 * left in it, derives it again to see that the result is the same, and runs the tests the product brings (`ci/test-server.sh`, `ci/test-client.sh`). `tooling` is the shell line that makes
 * `linea-ci` available in the job.
 */
export const renderChildPipeline = ({
  products,
  specsDir,
  image = 'node:22',
  tooling = `git config --global url."https://gitlab-ci-token:\${CI_JOB_TOKEN}@\${CI_SERVER_HOST}/".insteadOf "https://\${CI_SERVER_HOST}/" && npm install --global "$LINEA_CI_PACKAGE"`,
  parentJob = 'select',
  repositories = {},
  tags = []
}: {
  products: readonly string[]
  /** Where the specs of the products are, relative to the root of the SPL repository (`fetch-specs` writes them there). */
  specsDir: string
  image?: string
  tooling?: string
  /** The job of the parent pipeline whose artifacts hold the specs and the SPL checkout. */
  parentJob?: string
  /** Product name -> where its repository is: those listed also get `check-drift` (what is committed is what the line generates). */
  repositories?: Readonly<Record<string, string>>
  /** The runner tags the jobs ask for (a runner that takes no untagged jobs runs nothing otherwise). */
  tags?: readonly string[]
}): string => {
  const tagLines = tags.length === 0 ? [] : [`  tags: ${JSON.stringify(tags)}`]
  if (products.length === 0) {
    return [
      'stages: [products]',
      'no-products-affected:',
      '  stage: products',
      `  image: ${image}`,
      ...tagLines,
      '  script:',
      '    - echo "No product is affected by this change."'
    ].join('\n') + '\n'
  }
  const lines = ['stages: [products]', '']
  for (const name of products) {
    lines.push(
      `product:${name.replace(JOB_NAME_UNSAFE, '_')}:`,
      '  stage: products',
      `  image: ${image}`,
      ...tagLines,
      '  interruptible: true',
      '  needs:',
      '    - pipeline: $PARENT_PIPELINE_ID',
      `      job: ${parentJob}`,
      '  script:',
      `    - ${tooling}`,
      `    - linea-ci derive --line . --spec ${specsDir}/${name}.json --out "$CI_PROJECT_DIR/derived/${name}"`,
      `    - linea-ci check-leftovers "$CI_PROJECT_DIR/derived/${name}" --line .`,
      `    - linea-ci check-determinism --line . --spec ${specsDir}/${name}.json`,
      ...(repositories[name] === undefined ? [] : [`    - linea-ci check-drift --line . --spec ${specsDir}/${name}.json --repository ${JSON.stringify(repositories[name])}`]),
      `    - cd "derived/${name}" && for t in ci/test-server.sh ci/test-client.sh; do if [ -f "$t" ]; then sh "$t" || exit 1; fi; done`,
      '  artifacts:',
      '    when: always',
      '    expire_in: 1 week',
      '    paths:',
      `      - derived/${name}/`,
      ''
    )
  }
  return lines.join('\n')
}
