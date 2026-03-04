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
# Configure via environment variables or mount .env file.
#
# Required volume mounts for each backend:
#   Claude:  -v ~/.claude:/root/.claude
#   Codex:   -v ~/.codex:/root/.codex
#   Gemini:  -v ~/.gemini:/root/.gemini
#
# Example:
#   docker run -d --name tg-ai-bridge \
#     --env-file .env \
#     -v ~/.claude:/root/.claude \
#     -v ~/.codex:/root/.codex \
#     -v ~/.gemini:/root/.gemini \
#     telegram-ai-bridge

CMD ["bun", "bridge.js"]
