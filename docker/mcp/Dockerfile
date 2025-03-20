FROM node:18-slim

WORKDIR /app

# Install required dependencies
RUN apt-get update && apt-get install -y \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package.json package-lock.json ./

# Install dependencies
RUN npm install --production

# Copy the MCP server source code
COPY src/mcp-server/ ./src/mcp-server/

# Expose the MCP server port
EXPOSE 3003

# Start the MCP server
CMD ["node", "src/mcp-server/index.js"]