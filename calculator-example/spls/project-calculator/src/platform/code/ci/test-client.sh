#!/bin/sh
#
# Client test command for this product.
#
# Default is a no-op (exit 0) so generated products with no tests yield a
# green pipeline. Replace the echo+exit below with the real test command,
# e.g.:
#
#   cd client && npm ci && npm test
#   cd client && yarn install --frozen-lockfile && yarn test
#
# Any non-zero exit will fail the test_client job in .gitlab-ci.yml.

echo "[test-client] No client tests defined for this product."
echo "[test-client] Edit ci/test-client.sh to wire in real tests."
exit 0
