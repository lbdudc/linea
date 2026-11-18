#!/bin/sh
#
# Server test command for this product.
#
# Default is a no-op (exit 0) so generated products with no tests yield a
# green pipeline. Replace the echo+exit below with the real test command,
# e.g.:
#
#   cd server && ./gradlew test
#   cd server && mvn test
#
# Any non-zero exit will fail the test_server job in .gitlab-ci.yml.

echo "[test-server] No server tests defined for this product."
echo "[test-server] Edit ci/test-server.sh to wire in real tests."
exit 0
