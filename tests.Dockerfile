# Test runner image: Node + Playwright browsers + every test dependency.
# Used by `docker compose --profile test run --rm tests`, locally and in CI, so the suite needs
# nothing on the host except Docker.
FROM mcr.microsoft.com/playwright:v1.49.1-noble
WORKDIR /repo
COPY apps/api/package.json apps/api/
RUN cd apps/api && npm install --no-audit --no-fund
COPY e2e/package.json e2e/
RUN cd e2e && npm install --no-audit --no-fund
COPY . .
CMD ["bash", "scripts/test-all.sh"]
