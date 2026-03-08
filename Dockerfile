FROM oven/bun:latest

WORKDIR /app

# Install dependencies
COPY package.json bun.lock* ./
RUN bun install --production

# Copy source
COPY . .

# Create directories for file downloads
RUN mkdir -p files

# The bot uses Telegram polling — no ports to expose.
# Configure via environment variables or mount config.json at runtime.
#
# Required volume mounts for each backend:
#   Claude:  -v ~/.claude:/root/.claude
#   Codex:   -v ~/.codex:/root/.codex
#   Gemini:  -v ~/.gemini:/root/.gemini
#
# Example:
#   docker run -d --name tg-ai-bridge \
#     -v $(pwd)/config.json:/app/config.json:ro \
#     -v ~/.claude:/root/.claude \
#     telegram-ai-bridge --backend claude

ENTRYPOINT ["bun", "start.js", "start"]
CMD ["--backend", "claude"]
