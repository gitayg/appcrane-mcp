# appcrane-mcp — standalone MCP connector for AppCrane.
#
# Builds the TypeScript server and runs it over stdio. The image starts and
# answers `tools/list` introspection with NO environment variables (it serves
# the bundled catalog.json), which is what registries such as Glama require.
#
# To actually call tools, run with:
#   docker run -i --rm \
#     -e APPCRANE_URL=https://crane.example.com \
#     -e APPCRANE_KEY=your_api_key \
#     appcrane-mcp
FROM node:20-slim AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY tsconfig.json ./
COPY src ./src
COPY catalog.json ./
RUN npm run build

FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json* ./
RUN npm install --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY catalog.json ./
COPY README.md LICENSE ./
# stdio transport — the MCP client talks to this process over stdin/stdout.
CMD ["node", "dist/index.js"]
