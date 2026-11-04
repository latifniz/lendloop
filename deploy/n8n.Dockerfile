# Production n8n image for LendLoop: workflows and the entrypoint are baked in, so a
# deploy (Coolify, any Docker host) needs no bind mounts and no manual import step.
FROM n8nio/n8n:1.123.92

COPY --chown=node:node n8n/workflows /workflows
COPY --chown=node:node deploy/n8n-entrypoint.sh /deploy/n8n-entrypoint.sh

ENTRYPOINT ["tini", "--", "/bin/sh", "/deploy/n8n-entrypoint.sh"]
